// index.mjs (ESM)

import mysql from "mysql2/promise";
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Pool tuned for Lambda, where the process is frozen between invocations and
// MySQL / the network quietly drops connections that sat idle while frozen.
//
// - connectionLimit 2: a Lambda instance serves ONE request at a time, so more
//   than a couple of connections per instance only multiplies the total held
//   open across instances. A burst of cold starts at 5 each could exhaust a
//   small RDS instance's max_connections and 500 every page at once.
// - enableKeepAlive: TCP keep-alive so half-dead sockets are detected sooner.
// - maxIdle / idleTimeout: drop idle connections rather than keep them for the
//   next thaw. Timers do not run while frozen, so this alone is NOT enough —
//   withConn() also pings every connection before handing it out.
// - connectTimeout: fail fast instead of eating the whole Lambda timeout when
//   the database is unreachable.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT) || 2,
  maxIdle: Number(process.env.DB_POOL_LIMIT) || 2,
  idleTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 5000,
});

const AWS_REGION = process.env.AWS_REGION || "ap-southeast-1";
const s3 = new S3Client({ region: AWS_REGION });

const S3_BUCKET = process.env.S3_BUCKET;
if (!S3_BUCKET) throw new Error("Missing S3_BUCKET env var");

// ===================== ENTRY =====================
export const handler = async (event) => {
  console.log("[DB cfg]", {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    db: process.env.DB_NAME,
    hasPassword: !!process.env.DB_PASSWORD,
  });

  // Scheduled invocations arrive from EventBridge, not API Gateway, so they
  // have no requestContext and — importantly — no JWT claims. This branch must
  // never call getAuthFromClaims or requireRole. `event.task` is keyed on as
  // well as `source` because EventBridge Scheduler delivers the configured
  // payload verbatim with no `source` field, while classic rules set it. The
  // requestContext guard makes the branch unreachable over HTTP.
  if (!event?.requestContext && (event?.task || event?.source === "aws.events")) {
    // Never re-run a scheduled task or a queued push on a lost connection —
    // it could double-send. The flag otherwise lingers from the last request.
    currentRequestRetryable = false;
    return await withConn((c) => runScheduledTask(c, event));
  }

  const method = event?.requestContext?.http?.method ?? "GET";

  const stage = event?.requestContext?.stage;
  const rawPath =
    (event?.requestContext?.http?.path || event?.rawPath || "/").toString();

  let path = normalisePath(rawPath);

  if (stage) {
    const prefix = `/${stage}`;
    if (path === prefix) path = "/";
    else if (path.startsWith(prefix + "/")) path = path.slice(prefix.length);
  }

  console.log("[REQ]", { method, rawPath, stage, path });

  // GETs are read-only, so withConn may safely re-run one whose connection
  // died mid-request. Writes are never re-run: the first attempt may already
  // have committed. A Lambda instance handles one event at a time, so a
  // module-level flag is safe here.
  currentRequestRetryable = method === "GET";

  const params = event?.pathParameters || {};
  const qs = event?.queryStringParameters || {};

  try {
    if (method === "OPTIONS") return noContent();

    if (method === "GET" && path === "/health") {
      return json(200, { status: "ok" });
    }

    const claims = event?.requestContext?.authorizer?.jwt?.claims;
    if (!claims) return json(401, { message: "Unauthorised" });

    const auth = getAuthFromClaims(claims);

    // GET /me
    if (method === "GET" && path === "/me") {
      return await withConn((c) => getMe(c, auth));
    }

    // GET /me/projects
    if (method === "GET" && path === "/me/projects") {
      return await withConn((c) => listMyProjects(c, auth));
    }

    if (method === "POST" && path === "/me/push-token") {
      return await withConn((c) => registerPushToken(c, auth, mustJson(event)));
    }

    if (method === "DELETE" && path === "/me/push-token") {
      return await withConn((c) => unregisterPushToken(c, auth, mustJson(event)));
    }

    // GET /projects  (admin: all projects)
    if (method === "GET" && path === "/projects") {
      return await withConn((c) => listAllProjects(c, auth));
    }

    // ===== BUSES =====
    if (method === "GET" && path === "/buses") {
      return await withConn((c) => getBuses(c, auth, qs));
    }

    if (method === "POST" && path === "/buses") {
      return await withConn((c) => createBus(c, auth, mustJson(event)));
    }

    if (method === "PATCH" && isBusIdPath(path)) {
      const busId = getBusIdFromPath(params.bus_id, path);
      return await withConn((c) => updateBus(c, auth, busId, mustJson(event)));
    }

    if (method === "DELETE" && isBusIdPath(path)) {
      const busId = getBusIdFromPath(params.bus_id, path);
      return await withConn((c) => deleteBus(c, auth, busId));
    }

    // ===== PARTS =====
    if (method === "GET" && path === "/parts") {
      return await withConn((c) => getParts(c, auth, qs));
    }

    if (method === "POST" && path === "/parts") {
      return await withConn((c) => createPart(c, auth, mustJson(event)));
    }

    if (method === "PATCH" && isPartIdPath(path)) {
      const partId = getIdFromParamsOrPath(params.part_id, path, /^\/parts\/(\d+)$/);
      return await withConn((c) => updatePart(c, auth, partId, mustJson(event)));
    }

    // ===== REPORTS =====
    if (method === "GET" && path === "/reports") {
      return await withConn((c) => listReports(c, auth, qs));
    }

    if (method === "GET" && isReportIdPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)$/);
      return await withConn((c) => getReport(c, auth, reportId));
    }

    if (method === "PATCH" && isReportIdPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)$/);
      return await withConn((c) => patchReport(c, auth, reportId, mustJson(event)));
    }

    if (method === "POST" && path === "/reports") {
      return await withConn((c) => createReport(c, auth, mustJson(event)));
    }

    if (method === "POST" && isReportsSubmitPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)\/submit$/);
      return await withConn((c) => submitReport(c, auth, reportId));
    }

    if (method === "PATCH" && isReportsStatusPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)\/status$/);
      return await withConn((c) => updateReportStatus(c, auth, reportId, mustJson(event)));
    }

    if (method === "POST" && isReportsJobPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)\/job$/);
      return await withConn((c) => createJobForReport(c, auth, reportId, mustJson(event)));
    }

    if (method === "GET" && isReportsMediaListPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)\/media$/);
      return await withConn((c) => listReportMedia(c, auth, reportId));
    }

    if (method === "GET" && isReportsMediaPresignPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)\/media\/presign$/);
      return await withConn((c) => presignReportMedia(c, auth, reportId, qs));
    }

    if (method === "POST" && isReportsMediaConfirmPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)\/media\/confirm$/);
      return await withConn((c) => confirmReportMedia(c, auth, reportId, mustJson(event)));
    }

    if (method === "GET" && isReportsSelfiePresignPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)\/selfie\/presign$/);
      return await withConn((c) => presignReportSelfie(c, auth, reportId, qs));
    }

    if (method === "POST" && isReportsSelfieConfirmPath(path)) {
      const reportId = getIdFromParamsOrPath(params.report_id, path, /^\/reports\/(\d+)\/selfie\/confirm$/);
      return await withConn((c) => confirmReportSelfie(c, auth, reportId, mustJson(event)));
    }

    // Selfie upload for the approve (R&M) and accept (technician) sign-offs.
    // The key comes back to the client, which hands it to the approve/accept
    // call itself, so the sign-off is stored in the same write as the action.
    if (method === "GET" && path === "/verification/selfie/presign") {
      return await withConn((c) => presignVerificationSelfie(c, auth, qs));
    }

    // ===== JOB ORDERS =====
    if (method === "POST" && path === "/job-orders") {
      return await withConn((c) => createJobOrder(c, auth, mustJson(event)));
    }

    // ===== PERFORMANCE & KPIs =====
    if (method === "GET" && path === "/kpis/overview") {
      return await withConn((c) => getKpiOverview(c, auth, qs));
    }

    if (method === "GET" && path === "/kpis/buses") {
      return await withConn((c) => getKpiBuses(c, auth, qs));
    }

    if (method === "GET" && /^\/kpis\/buses\/[^/]+$/.test(path)) {
      const busId = decodeURIComponent(params.bus_id ?? path.split("/").pop());
      return await withConn((c) => getKpiBus(c, auth, busId, qs));
    }

    // ===== PDF EXPORTS =====
    if (method === "POST" && path === "/exports") {
      return await withConn((c) => createExport(c, auth, mustJson(event)));
    }

    if (method === "GET" && /^\/exports\/[^/]+$/.test(path)) {
      const exportId = params.export_id ?? path.split("/").pop();
      return await withConn((c) => getExport(c, auth, exportId, qs));
    }

    if (method === "GET" && /^\/jobs\/\d+\/report-pdf$/.test(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/report-pdf$/);
      return await withConn((c) => getJobReportPdf(c, auth, jobId));
    }

    // ===== JOBS =====

    if (method === "PATCH" && isJobIdPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)$/);
      return await withConn((c) => patchJob(c, auth, jobId, mustJson(event)));
    }

    if (method === "GET" && path === "/jobs") {
      return await withConn((c) => listJobs(c, auth, qs));
    }

    if (method === "GET" && isJobIdPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)$/);
      return await withConn((c) => getJob(c, auth, jobId));
    }

    if (method === "PATCH" && isJobsAssignPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/assign$/);
      return await withConn((c) => assignJobToMe(c, auth, jobId, mustJson(event)));
    }

    if (method === "GET" && isJobsPartsPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/parts$/);
      return await withConn((c) => listJobParts(c, auth, jobId));
    }

    if (method === "POST" && isJobsPartsPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/parts$/);
      return await withConn((c) => addJobPart(c, auth, jobId, mustJson(event)));
    }

    if (method === "PATCH" && isJobsStatusPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/status$/);
      return await withConn((c) => updateJobStatus(c, auth, jobId, mustJson(event)));
    }

    if (method === "GET" && isJobsHistoryPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/history$/);
      return await withConn((c) => listJobHistory(c, auth, jobId));
    }

    if (method === "POST" && isJobsHistoryPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/history$/);
      return await withConn((c) => addJobHistory(c, auth, jobId, mustJson(event)));
    }

    if (method === "GET" && isJobsMediaListPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/media$/);
      return await withConn((c) => listJobMedia(c, auth, jobId, qs));
    }

    if (method === "GET" && isJobsMediaPresignPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/media\/presign$/);
      return await withConn((c) => presignJobMedia(c, auth, jobId, qs));
    }

    if (method === "POST" && isJobsMediaConfirmPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/media\/confirm$/);
      return await withConn((c) => confirmJobMedia(c, auth, jobId, mustJson(event)));
    }

    if (method === "GET" && isJobsSelfiePresignPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/selfie\/presign$/);
      return await withConn((c) => presignJobSelfie(c, auth, jobId, qs));
    }

    if (method === "POST" && isJobsSelfieConfirmPath(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/selfie\/confirm$/);
      return await withConn((c) => confirmJobSelfie(c, auth, jobId, mustJson(event)));
    }

    // ===== JOB TASKS =====

    if (method === "GET" && /^\/jobs\/\d+\/tasks$/.test(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/tasks$/);
      return await withConn((c) => listJobTasks(c, auth, jobId));
    }

    if (method === "POST" && /^\/jobs\/\d+\/tasks$/.test(path)) {
      const jobId = getIdFromParamsOrPath(params.job_id, path, /^\/jobs\/(\d+)\/tasks$/);
      return await withConn((c) => createJobTask(c, auth, jobId, mustJson(event)));
    }

    if (method === "PATCH" && /^\/tasks\/\d+$/.test(path)) {
      const taskId = getIdFromParamsOrPath(params.task_id, path, /^\/tasks\/(\d+)$/);
      return await withConn((c) => updateJobTask(c, auth, taskId, mustJson(event)));
    }

    if (method === "GET" && /^\/tasks\/\d+\/parts$/.test(path)) {
      const taskId = getIdFromParamsOrPath(params.task_id, path, /^\/tasks\/(\d+)\/parts$/);
      return await withConn((c) => listTaskParts(c, auth, taskId));
    }

    if (method === "POST" && /^\/tasks\/\d+\/parts$/.test(path)) {
      const taskId = getIdFromParamsOrPath(params.task_id, path, /^\/tasks\/(\d+)\/parts$/);
      return await withConn((c) => addTaskPart(c, auth, taskId, mustJson(event)));
    }

    // ===== TYRES =====

    if (method === "GET" && path === "/tyres/overdue") {
      return await withConn((c) => getOverdueTyreInspections(c, auth, qs));
    }

    if (method === "GET" && path === "/tyres/low-tread") {
      return await withConn((c) => getLowTreadTyres(c, auth, qs));
    }

    if (method === "GET" && path === "/tyres/settings") {
      return await withConn((c) => getTyreSettings(c, auth));
    }

    if (method === "PATCH" && path === "/tyres/settings") {
      return await withConn((c) => updateTyreSettings(c, auth, mustJson(event)));
    }

    // The /tyres/swap/... path is kept alive because app builds already in the
    // field call it; /tyres/photo/presign is the canonical name now that the
    // handler also serves inspection photos.
    if (method === "GET" && (path === "/tyres/photo/presign" || path === "/tyres/swap/photo/presign")) {
      return await withConn((c) => presignTyrePhoto(c, auth, qs));
    }

    if (method === "GET" && path === "/tyres/summary") {
      return await withConn((c) => getTyreSummary(c, auth, qs));
    }

    if (method === "POST" && path === "/tyres/swap") {
      return await withConn((c) => swapTyre(c, auth, mustJson(event)));
    }

    if (method === "GET" && path === "/tyres") {
      return await withConn((c) => listTyres(c, auth, qs));
    }

    if (method === "POST" && path === "/tyres") {
      return await withConn((c) => createTyre(c, auth, mustJson(event)));
    }

    if (method === "GET" && /^\/tyres\/\d+$/.test(path)) {
      const tyreId = getIdFromParamsOrPath(params.tyre_id, path, /^\/tyres\/(\d+)$/);
      return await withConn((c) => getTyre(c, auth, tyreId));
    }

    if (method === "PATCH" && /^\/tyres\/\d+$/.test(path)) {
      const tyreId = getIdFromParamsOrPath(params.tyre_id, path, /^\/tyres\/(\d+)$/);
      return await withConn((c) => updateTyre(c, auth, tyreId, mustJson(event)));
    }

    if (method === "POST" && /^\/tyres\/\d+\/unmount$/.test(path)) {
      const tyreId = getIdFromParamsOrPath(params.tyre_id, path, /^\/tyres\/(\d+)\/unmount$/);
      return await withConn((c) => unmountTyre(c, auth, tyreId, mustJson(event)));
    }

    if (method === "GET" && /^\/buses\/[^/]+\/tyres$/.test(path)) {
      const busId = getBusIdFromPath(params.bus_id, path.replace(/\/tyres$/, ""));
      return await withConn((c) => listBusTyres(c, auth, busId));
    }

    if (method === "GET" && /^\/buses\/[^/]+\/tyre-swaps$/.test(path)) {
      const busId = getBusIdFromPath(params.bus_id, path.replace(/\/tyre-swaps$/, ""));
      return await withConn((c) => listBusTyreSwaps(c, auth, busId));
    }

    if (method === "POST" && /^\/buses\/[^/]+\/tyre-inspections$/.test(path)) {
      const busId = getBusIdFromPath(params.bus_id, path.replace(/\/tyre-inspections$/, ""));
      return await withConn((c) => createTyreInspectionSession(c, auth, busId, mustJson(event)));
    }

    if (method === "GET" && /^\/buses\/[^/]+\/tyre-inspections$/.test(path)) {
      const busId = getBusIdFromPath(params.bus_id, path.replace(/\/tyre-inspections$/, ""));
      return await withConn((c) => listBusTyreInspections(c, auth, busId));
    }

    if (method === "GET" && /^\/tyre-inspections\/\d+$/.test(path)) {
      const sessionId = getIdFromParamsOrPath(params.session_id, path, /^\/tyre-inspections\/(\d+)$/);
      return await withConn((c) => getTyreInspectionSession(c, auth, sessionId));
    }

    // ===== NOTIFICATIONS =====

    if (method === "GET" && path === "/notifications") {
      return await withConn((c) => listNotifications(c, auth, qs));
    }

    if (method === "GET" && path === "/notifications/unread-count") {
      return await withConn((c) => getUnreadNotificationCount(c, auth));
    }

    if (method === "PATCH" && isNotificationReadPath(path)) {
      const notificationId = getIdFromParamsOrPath(
        params.notification_id,
        path,
        /^\/notifications\/(\d+)\/read$/
      );
      return await withConn((c) => markNotificationRead(c, auth, notificationId));
    }

    if (method === "POST" && path === "/notifications/read-all") {
      return await withConn((c) => markAllNotificationsRead(c, auth));
    }

    // ===== PUSPAKOM =====
    if (path.startsWith("/puspakom/")) {
      if (method === "GET" && path === "/puspakom/schedule") return await withConn((c) => pspGetSchedule(c, auth, qs));
      if (method === "GET" && path === "/puspakom/counts") return await withConn((c) => pspGetCounts(c, auth, qs));
      if (method === "GET" && path === "/puspakom/check-defs") return await withConn((c) => pspGetCheckDefs(c, auth, qs));
      if (method === "GET" && path === "/puspakom/prechecks") return await withConn((c) => pspListPrechecks(c, auth, qs));
      if (method === "GET" && path === "/puspakom/media/presign") return await withConn((c) => pspPresignMedia(c, auth, qs));
      if (method === "GET" && /^\/puspakom\/buses\/[^/]+$/.test(path)) {
        const busId = decodeURIComponent(params.bus_id ?? path.split("/")[3]);
        return await withConn((c) => pspGetBus(c, auth, busId));
      }
      if (method === "POST" && path === "/puspakom/inspections") {
        return await withConn((c) => pspRegister(c, auth, mustJson(event)));
      }
      if (isPspInspectionPath(path)) {
        const id = pspInspectionIdFromPath(params, path);
        if (method === "GET") return await withConn((c) => pspGetInspection(c, auth, id));
        if (method === "PATCH") return await withConn((c) => pspUpdateBooking(c, auth, id, mustJson(event)));
      }
      if (method === "GET" && path === "/puspakom/reports") return await withConn((c) => pspListReports(c, auth, qs));
      if (method === "GET" && path === "/puspakom/kpis") return await withConn((c) => pspGetKpis(c, auth, qs));
      if (method === "GET" && pspInspectionSubPath(path, "report-pdf")) {
        const id = pspInspectionIdFromPath(params, path);
        return await withConn((c) => pspGetReportPdf(c, auth, id));
      }
      if (method === "POST" && pspInspectionSubPath(path, "result")) {
        const id = pspInspectionIdFromPath(params, path);
        return await withConn((c) => pspRecordResult(c, auth, id, mustJson(event)));
      }
      if (method === "POST" && pspInspectionSubPath(path, "answers")) {
        const id = pspInspectionIdFromPath(params, path);
        return await withConn((c) => pspSaveAnswers(c, auth, id, mustJson(event)));
      }
      if (method === "POST" && pspInspectionSubPath(path, "precheck/submit")) {
        const id = pspInspectionIdFromPath(params, path);
        return await withConn((c) => pspSubmitPrecheck(c, auth, id, mustJson(event)));
      }
      if (method === "POST" && pspInspectionSubPath(path, "recheck")) {
        const id = pspInspectionIdFromPath(params, path);
        return await withConn((c) => pspSaveRecheck(c, auth, id, mustJson(event)));
      }
      if (method === "POST" && pspInspectionSubPath(path, "recheck/submit")) {
        const id = pspInspectionIdFromPath(params, path);
        return await withConn((c) => pspSubmitRecheck(c, auth, id, mustJson(event)));
      }
    }

    return json(404, { message: `Not found: ${method} ${path}` });
  } catch (e) {
    console.error("Lambda error:", { code: e?.code, message: e?.message }, e);

    // The database dropped out from under us (stale socket, restart, too many
    // connections). Answer 503 with a plain message so the app can tell the
    // user to retry, instead of a bare 500 that looks like a bug.
    if (isDbUnavailableError(e)) {
      return json(503, {
        code: "DB_UNAVAILABLE",
        message: "The server is busy. Please try again in a moment.",
      });
    }

    const msg = e?.message || "Server error";

    if (
      msg.includes("required") ||
      msg.includes("Invalid JSON") ||
      msg.includes("Invalid") ||
      msg.includes("Missing")
    ) {
      return json(400, { message: msg });
    }

    return json(500, { message: msg });
  }
};

// ===================== HELPERS =====================

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  };
}

function json(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

function noContent() {
  return { statusCode: 204, headers: corsHeaders(), body: "" };
}

function normalisePath(p) {
  let path = p.trim();
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return path;
}

function mustJson(event) {
  const b = event?.body;
  if (!b) return {};

  const raw = event?.isBase64Encoded
    ? Buffer.from(b, "base64").toString("utf8")
    : b;

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

// Error codes meaning the CONNECTION is dead, not that the query was wrong.
const CONNECTION_LOST_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_SERVER_SHUTDOWN",
  "ER_CON_COUNT_ERROR", // Too many connections
]);

function isConnectionLostError(e) {
  if (!e) return false;
  if (e.fatal === true) return true;
  if (CONNECTION_LOST_CODES.has(e.code)) return true;
  const msg = String(e.message || "");
  return /Connection lost|closed state|Can't add new command when connection is in closed state/i.test(msg);
}

function isDbUnavailableError(e) {
  return isConnectionLostError(e) || e?.code === "ER_CON_COUNT_ERROR";
}

let currentRequestRetryable = false;

/**
 * Check a connection out of the pool and prove it is alive before use.
 *
 * Lambda freezes the process between invocations; a pooled connection that
 * looked fine before the freeze may be dead after it. Pinging costs one round
 * trip and turns a failed request into a silent reconnect. A dead connection
 * is destroyed, not released, so it never goes back into the pool.
 */
async function getLiveConnection() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const c = await pool.getConnection();
    try {
      await c.ping();
      return c;
    } catch (e) {
      console.warn("[DB] stale connection discarded", { attempt, code: e?.code, message: e?.message });
      c.destroy();
      if (attempt === 2) throw e;
    }
  }
}

async function withConn(fn) {
  const maxAttempts = currentRequestRetryable ? 2 : 1;

  for (let attempt = 1; ; attempt++) {
    const c = await getLiveConnection();
    let dead = false;
    try {
      return await fn(c);
    } catch (e) {
      dead = isConnectionLostError(e);
      if (dead && attempt < maxAttempts) {
        console.warn("[DB] connection lost mid-request, retrying read", { code: e?.code });
        continue;
      }
      throw e;
    } finally {
      if (dead) c.destroy();
      else c.release();
    }
  }
}

function requireRole(auth, allowed) {
  if (!allowed.includes(auth.role)) return json(403, { message: "Forbidden" });
  return null;
}

function toId(v, name = "id") {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid ${name}`);
  return n;
}

function getIdFromParamsOrPath(paramVal, path, regex) {
  if (paramVal != null) return toId(paramVal);
  const m = path.match(regex);
  if (!m?.[1]) throw new Error("Missing path id");
  return toId(m[1]);
}

// route matchers
const isReportIdPath = (p) => /^\/reports\/\d+$/.test(p);
const isReportsJobPath = (p) => /^\/reports\/\d+\/job$/.test(p);
const isReportsStatusPath = (p) => /^\/reports\/\d+\/status$/.test(p);
const isReportsSubmitPath = (p) => /^\/reports\/\d+\/submit$/.test(p);
const isReportsMediaListPath = (p) => /^\/reports\/\d+\/media$/.test(p);
const isReportsMediaPresignPath = (p) => /^\/reports\/\d+\/media\/presign$/.test(p);
const isReportsMediaConfirmPath = (p) => /^\/reports\/\d+\/media\/confirm$/.test(p);
const isReportsSelfiePresignPath = (p) => /^\/reports\/\d+\/selfie\/presign$/.test(p);
const isReportsSelfieConfirmPath = (p) => /^\/reports\/\d+\/selfie\/confirm$/.test(p);

const isJobIdPath = (p) => /^\/jobs\/\d+$/.test(p);
const isJobsAssignPath = (p) => /^\/jobs\/\d+\/assign$/.test(p);
const isJobsPartsPath = (p) => /^\/jobs\/\d+\/parts$/.test(p);
const isJobsStatusPath = (p) => /^\/jobs\/\d+\/status$/.test(p);
const isJobsHistoryPath = (p) => /^\/jobs\/\d+\/history$/.test(p);
const isJobsMediaListPath = (p) => /^\/jobs\/\d+\/media$/.test(p);
const isJobsMediaPresignPath = (p) => /^\/jobs\/\d+\/media\/presign$/.test(p);
const isJobsMediaConfirmPath = (p) => /^\/jobs\/\d+\/media\/confirm$/.test(p);
const isJobsSelfiePresignPath = (p) => /^\/jobs\/\d+\/selfie\/presign$/.test(p);
const isJobsSelfieConfirmPath = (p) => /^\/jobs\/\d+\/selfie\/confirm$/.test(p);

const isPartIdPath = (p) => /^\/parts\/\d+$/.test(p);

const isNotificationReadPath = (p) => /^\/notifications\/\d+\/read$/.test(p);

// Matches /buses/<anything> — bus_id can be string or numeric
const isBusIdPath = (p) => /^\/buses\/[^/]+$/.test(p);

function getBusIdFromPath(paramVal, path) {
  if (paramVal != null) return String(paramVal);
  const m = path.match(/^\/buses\/([^/]+)$/);
  if (!m?.[1]) throw new Error("Missing bus id");
  return decodeURIComponent(m[1]);
}

// ===================== AUTH / ROLE =====================

function parseGroupsFromClaims(claims) {
  const raw = claims?.["cognito:groups"];
  if (!raw) return [];

  if (Array.isArray(raw)) return raw.map(String);

  if (typeof raw === "string") {
    const s = raw.trim();

    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.map(String);
      } catch {
        const inner = s.slice(1, -1).trim();
        if (!inner) return [];
        return inner
          .split(",")
          .map((x) => x.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
      }
    }

    return [s];
  }

  return [String(raw)];
}

function normaliseRole(raw) {
  const r = (raw ?? "driver").toString().trim();
  const MAP = {
    admin: "admin",
    driver: "driver",
    technician: "technician",
    "fleet-manager": "fleet_manager",
    fleet_manager: "fleet_manager",
    "rm-manager": "rm_manager",
    rm_manager: "rm_manager",
    "inventory-manager": "inventory_manager",
    inventory_manager: "inventory_manager",
  };
  return MAP[r] || "driver";
}

function pickRoleFromGroups(groups) {
  const g = groups.map((x) => (x ?? "").toString().trim());

  const PRIORITY = [
    "admin",
    "rm-manager",
    "rm_manager",
    "fleet-manager",
    "fleet_manager",
    "inventory-manager",
    "inventory_manager",
    "technician",
    "driver",
  ];

  for (const want of PRIORITY) {
    if (g.includes(want)) return normaliseRole(want);
  }
  return "driver";
}

function getAuthFromClaims(claims) {
  const groups = parseGroupsFromClaims(claims);
  const role = pickRoleFromGroups(groups);

  return {
    sub: claims.sub,
    // NULL, not "", when the Cognito user has no email: USER.user_email is
    // UNIQUE, and MySQL allows any number of NULLs but only one "". With ""
    // the second email-less account failed to be created, so every request
    // it made was a 500.
    email: claims.email ? String(claims.email) : null,
    name:
      claims.name ??
      claims["cognito:username"] ??
      claims.email ??
      "Unknown",
    role,
    groups,
  };
}

// ===================== NOTIFICATIONS (helper) =====================

const EXPO_PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[.+\]$/;

// Expo rejects unauthenticated sends when "Enhanced Security for Push
// Notifications" is enabled on the project. Optional so an unset variable
// changes nothing; `hasAuth` is logged so you can see which mode is live.
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN || null;
const EXPO_PUSH_TIMEOUT_MS = 8000;

/**
 * One structured line per stage of a push, under a single tag.
 *
 * Push used to fail completely silently: three separate early returns logged
 * nothing, the catch blocks discarded the stack, and Expo signals per-message
 * failure as HTTP 200 with an error inside the body — which nothing read. A
 * total fleet-wide outage produced zero log lines. Filter with:
 *   fields @timestamp, @message | filter @message like /"tag":"PUSH"/
 */
function plog(stage, fields = {}) {
  console.log(JSON.stringify({ tag: "PUSH", stage, ...fields }));
}

function maskToken(t) {
  return typeof t === "string" && t.length > 12 ? `${t.slice(0, 18)}…${t.slice(-7)}` : String(t);
}

function errFields(e) {
  return { errName: e?.name, errMessage: e?.message, errStack: e?.stack };
}

// The users' registered devices, as valid Expo tokens. Logs what it found;
// returns [] (after logging why) when there is nothing to send to.
async function lookupPushTokens(conn, userIds, title) {
  if (!userIds?.length) {
    plog("push.skip", { reason: "no_users", title });
    return [];
  }

  const placeholders = userIds.map(() => "?").join(",");
  const [rows] = await conn.execute(
    `SELECT DISTINCT expo_push_token FROM PUSH_TOKEN WHERE user_id IN (${placeholders})`,
    userIds
  );

  const all = (rows || []).map((r) => r.expo_push_token);
  const tokens = all.filter((t) => EXPO_PUSH_TOKEN_RE.test(t));
  plog("push.lookup", {
    userIds: userIds.length,
    rowsFound: all.length,
    tokensValid: tokens.length,
    tokensRejected: all.length - tokens.length,
  });

  if (!tokens.length) {
    // The single most common failure: nobody has ever successfully
    // registered a device. Previously indistinguishable from a good send.
    plog("push.skip", {
      reason: all.length ? "no_valid_tokens" : "no_tokens",
      userIds: userIds.length,
      title,
    });
  }
  return tokens;
}

function buildPushMessages(tokens, { title, body, data }) {
  return tokens.map((to) => ({
    to,
    title,
    body: body ?? undefined,
    data: data ?? {},
    sound: "default",
    priority: "high",
  }));
}

async function sendExpoPushNotifications(conn, { userIds, title, body, data, timeoutMs = EXPO_PUSH_TIMEOUT_MS }) {
  const startedAt = Date.now();
  try {
    const tokens = await lookupPushTokens(conn, userIds, title);
    if (!tokens.length) return;

    const messages = buildPushMessages(tokens, { title, body, data });

    let ticketsOk = 0;
    let ticketsError = 0;
    const deadTokens = [];

    // Expo's push API caps each request at 100 messages.
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const chunkNo = i / 100 + 1;

      try {
        plog("push.request", { chunk: chunkNo, size: chunk.length, hasAuth: !!EXPO_ACCESS_TOKEN });

        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Content-Type": "application/json",
            ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
          },
          body: JSON.stringify(chunk),
          // Without this a stalled connection hangs the whole request until the
          // Lambda times out — a best-effort side effect taking down the
          // operation it was attached to.
          signal: AbortSignal.timeout(timeoutMs),
        });

        const text = await res.text().catch(() => "");
        if (!res.ok) {
          ticketsError += chunk.length;
          plog("push.response", { chunk: chunkNo, httpStatus: res.status, ok: false, body: text.slice(0, 500) });
          continue;
        }

        // A 200 does NOT mean delivered. Expo returns a ticket per message,
        // index-aligned with the request, and failures live in there.
        let tickets = [];
        try {
          tickets = JSON.parse(text)?.data ?? [];
        } catch (e) {
          plog("push.response", { chunk: chunkNo, httpStatus: res.status, ok: true, parseFailed: true, ...errFields(e) });
          continue;
        }

        const errors = [];
        tickets.forEach((ticket, idx) => {
          if (ticket?.status === "ok") {
            ticketsOk += 1;
            return;
          }
          ticketsError += 1;
          const to = chunk[idx]?.to;
          const detail = ticket?.details?.error;
          errors.push({ token: maskToken(to), status: ticket?.status, message: ticket?.message, detail });
          // Only DeviceNotRegistered means the token is genuinely dead.
          // InvalidCredentials / MismatchSenderId are project-level faults —
          // pruning on those would wipe the table over one bad build.
          if (detail === "DeviceNotRegistered" && to) deadTokens.push(to);
        });

        plog("push.response", {
          chunk: chunkNo,
          httpStatus: res.status,
          ok: true,
          ticketsOk: tickets.filter((x) => x?.status === "ok").length,
          errors,
        });
      } catch (e) {
        ticketsError += chunk.length;
        plog("push.chunk.fail", { chunk: chunkNo, ...errFields(e) });
      }
    }

    let pruned = 0;
    if (deadTokens.length) {
      try {
        const ph = deadTokens.map(() => "?").join(",");
        const [res] = await conn.execute(
          `DELETE FROM PUSH_TOKEN WHERE expo_push_token IN (${ph})`,
          deadTokens
        );
        pruned = res?.affectedRows ?? 0;
      } catch (e) {
        plog("push.prune.fail", errFields(e));
      }
    }

    plog("push.summary", {
      title,
      tokensAttempted: tokens.length,
      ticketsOk,
      ticketsError,
      pruned,
      ms: Date.now() - startedAt,
    });
  } catch (e) {
    plog("push.fail", { title, ms: Date.now() - startedAt, ...errFields(e) });
  }
}

// Project scoping for notifications is env-gated because it is the only
// change here that can REDUCE who gets notified: if non-admins have no
// USER_PROJECT rows they would stop receiving anything. Set to "0" to revert
// to fleet-wide without a redeploy.
const NOTIFY_PROJECT_SCOPE = process.env.NOTIFY_PROJECT_SCOPE !== "0";

/**
 * Who should hear about an event, by role and project.
 *
 * Mirrors getBuses: admins see the whole fleet, everyone else only their own
 * projects. This was the one place in the API that ignored USER_PROJECT, so a
 * manager on one project got pushes for every other project and then hit a 403
 * tapping through. Roles are compared case/whitespace-insensitively, matching
 * how statuses are handled elsewhere.
 *
 * A null projectId falls back to fleet-wide rather than dropping the
 * notification — silence is the worse failure.
 */
// Jobs carry no project of their own — they inherit it from the report that
// spawned them. A job created outside a report has none, which falls back to
// fleet-wide rather than notifying nobody.
async function projectIdForJob(conn, jobId) {
  try {
    const [rows] = await conn.execute(
      "SELECT project_id FROM REPORT WHERE job_id=? LIMIT 1",
      [jobId]
    );
    return rows?.[0]?.project_id ?? null;
  } catch {
    return null;
  }
}

async function resolveRecipientsByRole(conn, { roles, projectId = null, excludeUserId = null }) {
  if (!roles?.length) return { userIds: [], scope: "none" };

  const rolePlaceholders = roles.map(() => "?").join(",");
  const scoped = NOTIFY_PROJECT_SCOPE && projectId != null;

  const sql = `
    SELECT DISTINCT u.user_id
    FROM \`USER\` u
    WHERE LOWER(TRIM(u.user_role)) IN (${rolePlaceholders})
      ${scoped ? `AND (LOWER(TRIM(u.user_role)) = 'admin'
                       OR EXISTS (SELECT 1 FROM USER_PROJECT up
                                  WHERE up.user_id = u.user_id AND up.project_id = ?))` : ""}
      ${excludeUserId != null ? "AND u.user_id <> ?" : ""}`;

  const vals = [
    ...roles.map((r) => String(r).trim().toLowerCase()),
    ...(scoped ? [projectId] : []),
    ...(excludeUserId != null ? [excludeUserId] : []),
  ];

  const [users] = await conn.execute(sql, vals);
  return {
    userIds: users.map((u) => Number(u.user_id)),
    scope: scoped ? "project" : projectId == null ? "fleet_fallback" : "fleet",
  };
}

/**
 * Write the in-app rows, then push. Best-effort by design — a notification
 * failure must never break the operation it is attached to — but the two steps
 * are guarded separately: they used to share one try, so an FK violation on
 * report_id/job_id silently took the push down with it.
 */
async function notifyUsers(conn, { userIds, type, title, body = null, reportId = null, jobId = null, puspakomInspectionId = null }) {
  if (!userIds?.length) {
    plog("notify.recipients", { type, title, count: 0, reason: "none" });
    return;
  }
  plog("notify.recipients", { type, title, count: userIds.length, userIds });

  try {
    const rowPlaceholders = [];
    const values = [];
    for (const userId of userIds) {
      rowPlaceholders.push(puspakomInspectionId != null ? "(?,?,?,?,?,?,?)" : "(?,?,?,?,?,?)");
      values.push(userId, type, title, body, reportId, jobId);
      if (puspakomInspectionId != null) values.push(puspakomInspectionId);
    }
    // The PUSPAKOM column is only named when it is used, so every other
    // notification keeps working on a database that hasn't run 024 yet.
    await conn.execute(
      `INSERT INTO NOTIFICATION (user_id, notification_type, notification_title, notification_body, report_id, job_id${
        puspakomInspectionId != null ? ", puspakom_inspection_id" : ""
      })
       VALUES ${rowPlaceholders.join(",")}`,
      values
    );
    plog("notify.insert.ok", { type, rows: userIds.length });
  } catch (e) {
    plog("notify.insert.fail", { type, title, ...errFields(e) });
  }

  await dispatchPush(conn, {
    userIds,
    title,
    body,
    data: { type, reportId, jobId, puspakomInspectionId },
  });
}

// ===== Push dispatch (off the request path) =====
//
// Sending to Expo used to happen inline, so a slow exp.host held the user's
// request open for up to 8s per chunk — long enough to time the Lambda out and
// turn a successful report submission into an "Internal Server Error".
//
// Now the push is handed to a separate, asynchronous invocation of THIS
// function (InvocationType "Event"): AWS queues it and returns immediately,
// and the queued run sends the push on its own clock. Plain fire-and-forget
// would not work — Lambda freezes the process as soon as the response is
// returned, so an un-awaited fetch may never run.
//
// Needs the function's execution role to allow lambda:InvokeFunction on
// itself. If that permission is missing (or the Lambda API is unreachable),
// it falls back to sending inline under a short timeout, so pushes keep
// working either way. Set PUSH_ASYNC=0 to force the inline path.

const PUSH_ASYNC = process.env.PUSH_ASYNC !== "0";
const PUSH_INLINE_TIMEOUT_MS = 3000;
const SELF_FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME || null;

// Loaded lazily, not imported at the top: a static import of a package the
// runtime lacks would crash EVERY request at module load. Here a missing
// package only disables the async path, and pushes fall back to inline.
let _lambda = null;
async function lambdaApi() {
  if (!_lambda) {
    const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
    let requestHandler;
    try {
      const { NodeHttpHandler } = await import("@smithy/node-http-handler");
      // Short timeouts so an unreachable Lambda API (e.g. VPC with no NAT and
      // no endpoint) costs ~2s, not the SDK's default minutes.
      requestHandler = new NodeHttpHandler({ connectionTimeout: 1000, requestTimeout: 2000 });
    } catch {
      requestHandler = { connectionTimeout: 1000, requestTimeout: 2000 };
    }
    _lambda = {
      client: new LambdaClient({ region: AWS_REGION, maxAttempts: 1, requestHandler }),
      InvokeCommand,
    };
  }
  return _lambda;
}

// ===== Push via the S3 queue (the path that works from inside the VPC) =====
//
// This function runs in a VPC with no NAT gateway, so it cannot reach
// exp.host (or the Lambda API) at all — both paths below simply time out.
// S3, though, is reachable through a free S3 gateway endpoint. So the push is
// written as a file under push-queue/, and the S3 event triggers the separate
// sksbus-push-sender Lambda, which runs outside the VPC and sends it. See
// lambda/push-sender/index.mjs and lambda/scripts/setup_push_sender.sh.
//
// Tokens are resolved HERE, where the database is, so the sender never needs
// database access. Set PUSH_QUEUE=0 to skip straight to the older paths.

const PUSH_QUEUE = process.env.PUSH_QUEUE !== "0";
const PUSH_QUEUE_BUCKET = process.env.PUSH_QUEUE_BUCKET || S3_BUCKET;
const PUSH_QUEUE_PREFIX = "push-queue/";

// Its own client with short timeouts: without the gateway endpoint a PutObject
// from inside the VPC would otherwise hang for the whole Lambda timeout.
let _s3Queue = null;
async function s3QueueClient() {
  if (!_s3Queue) {
    let requestHandler;
    try {
      const { NodeHttpHandler } = await import("@smithy/node-http-handler");
      requestHandler = new NodeHttpHandler({ connectionTimeout: 1500, requestTimeout: 3000 });
    } catch {
      requestHandler = { connectionTimeout: 1500, requestTimeout: 3000 };
    }
    _s3Queue = new S3Client({ region: AWS_REGION, maxAttempts: 2, requestHandler });
  }
  return _s3Queue;
}

async function queuePush(conn, payload) {
  const tokens = await lookupPushTokens(conn, payload.userIds, payload.title);
  if (!tokens.length) return;

  const Key = `${PUSH_QUEUE_PREFIX}${Date.now()}-${crypto.randomUUID()}.json`;
  const client = await s3QueueClient();
  await client.send(
    new PutObjectCommand({
      Bucket: PUSH_QUEUE_BUCKET,
      Key,
      ContentType: "application/json",
      Body: JSON.stringify({ title: payload.title, messages: buildPushMessages(tokens, payload) }),
    })
  );
  plog("push.queued", { key: Key, messages: tokens.length, title: payload.title });
}

async function dispatchPush(conn, payload) {
  if (!payload?.userIds?.length) return;

  if (PUSH_QUEUE) {
    try {
      await queuePush(conn, payload);
      return;
    } catch (e) {
      plog("push.queue_fail", { fallback: "async_or_inline", ...errFields(e) });
    }
  }

  if (PUSH_ASYNC && SELF_FUNCTION_NAME) {
    try {
      const { client, InvokeCommand } = await lambdaApi();
      await client.send(
        new InvokeCommand({
          FunctionName: SELF_FUNCTION_NAME,
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({ task: "push", push: payload })),
        })
      );
      plog("push.dispatch.async", { userIds: payload.userIds.length, title: payload.title });
      return;
    } catch (e) {
      plog("push.dispatch.async_fail", { fallback: "inline", ...errFields(e) });
    }
  }

  try {
    await sendExpoPushNotifications(conn, { ...payload, timeoutMs: PUSH_INLINE_TIMEOUT_MS });
  } catch (e) {
    plog("push.fail", { title: payload.title, ...errFields(e) });
  }
}

async function notifyUsersByRole(conn, opts) {
  const { roles, type, title, projectId = null, excludeUserId = null } = opts;
  plog("notify.start", { type, title, roles, projectId, excludeUserId });
  try {
    const { userIds, scope } = await resolveRecipientsByRole(conn, { roles, projectId, excludeUserId });
    plog("notify.scope", { type, scope, count: userIds.length });
    await notifyUsers(conn, { ...opts, userIds });
  } catch (e) {
    plog("notify.fail", { type, title, ...errFields(e) });
  }
}

// ===================== USERS =====================

async function getOrCreateUserId(conn, auth) {
  const [rows] = await conn.execute(
    "SELECT user_id FROM `USER` WHERE cognito_sub=?",
    [auth.sub]
  );
  if (rows?.length) return Number(rows[0].user_id);

  const [res] = await conn.execute(
    "INSERT INTO `USER` (user_name, user_email, cognito_sub, user_role) VALUES (?,?,?,?)",
    [auth.name, auth.email, auth.sub, auth.role]
  );
  return Number(res.insertId);
}

// The Cognito ID token's `name`/`email` claims aren't always populated (falls
// back to "Unknown" in getAuthFromClaims), but the USER table's own name is
// reliably correct — it's what the rest of the app already displays
// everywhere (report cards, job assignments, etc). Notifications should read
// the same source of truth instead of the raw JWT claim.
async function getDisplayName(conn, auth) {
  const userId = await getOrCreateUserId(conn, auth);
  const [rows] = await conn.execute(
    "SELECT user_name FROM `USER` WHERE user_id=? LIMIT 1",
    [userId]
  );
  return rows?.[0]?.user_name || auth.name || "Someone";
}

async function registerPushToken(conn, auth, b) {
  const deny = requireRole(auth, ALL_ROLES);
  if (deny) return deny;

  const token = (b.expo_push_token || "").toString().trim();
  if (!token) throw new Error("expo_push_token is required");
  // Validated here, not only at send time. A malformed token used to be stored
  // with a 200 and then silently dropped when sending, so the table looked
  // healthy while nothing was deliverable. The length check matters because
  // the column is VARCHAR(255) — an over-long value would surface as a 500.
  if (!EXPO_PUSH_TOKEN_RE.test(token) || token.length > 255) {
    plog("register.invalid", { token: maskToken(token), length: token.length });
    return json(400, { message: "Invalid expo_push_token" });
  }

  const userId = await getOrCreateUserId(conn, auth);
  // A device's token is unique — if it's re-registered under a different
  // signed-in user (e.g. shared device, logout/login), reassign it rather
  // than erroring on the unique constraint.
  await conn.execute(
    `INSERT INTO PUSH_TOKEN (user_id, expo_push_token) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), updated_at = NOW()`,
    [userId, token]
  );
  plog("register.ok", { userId, token: maskToken(token) });
  return json(200, { success: true });
}

async function unregisterPushToken(conn, auth, b) {
  const deny = requireRole(auth, ALL_ROLES);
  if (deny) return deny;

  const token = (b.expo_push_token || "").toString().trim();
  if (!token) throw new Error("expo_push_token is required");

  const userId = await getOrCreateUserId(conn, auth);
  await conn.execute(
    `DELETE FROM PUSH_TOKEN WHERE expo_push_token=? AND user_id=?`,
    [token, userId]
  );
  return json(200, { success: true });
}

async function getMe(conn, auth) {
  const [rows] = await conn.execute(
    "SELECT user_id, user_role, user_name, user_email FROM `USER` WHERE cognito_sub=?",
    [auth.sub]
  );

  if (!rows.length) {
    const [res] = await conn.execute(
      "INSERT INTO `USER` (user_name, user_email, cognito_sub, user_role) VALUES (?,?,?,?)",
      [auth.name, auth.email, auth.sub, auth.role]
    );
    return json(200, {
      user_id: res.insertId,
      user_role: auth.role,
      user_name: auth.name,
      user_email: auth.email,
    });
  }

  const u = rows[0];
  const updates = [];
  const values = [];

  if (u.user_role !== auth.role) { updates.push("user_role=?"); values.push(auth.role); u.user_role = auth.role; }
  if (auth.name && auth.name !== "Unknown" && u.user_name !== auth.name) { updates.push("user_name=?"); values.push(auth.name); u.user_name = auth.name; }
  if (auth.email && u.user_email !== auth.email) { updates.push("user_email=?"); values.push(auth.email); u.user_email = auth.email; }

  if (updates.length) {
    values.push(u.user_id);
    await conn.execute(`UPDATE \`USER\` SET ${updates.join(", ")} WHERE user_id=?`, values);
  }

  return json(200, u);
}

// ===================== PROJECTS =====================

// Per-project pending/open report counts, for the project picker's badge.
// "Pending" mirrors the same normalisation listReports() uses for its own
// pending filter (NULL/blank/submitted/pending all count as pending).
const REPORT_COUNTS_BY_PROJECT_SQL = `
  SELECT project_id,
         SUM(CASE WHEN report_status IS NULL OR TRIM(report_status)='' OR LOWER(TRIM(report_status)) IN ('submitted','pending') THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN LOWER(TRIM(report_status))='open' THEN 1 ELSE 0 END) AS open_count
  FROM REPORT
  WHERE LOWER(TRIM(COALESCE(report_status,''))) <> 'draft'
  GROUP BY project_id
`;

async function listMyProjects(conn, auth) {
  const deny = requireRole(auth, [
    "admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver",
  ]);
  if (deny) return deny;

  const userId = await getOrCreateUserId(conn, auth);

  const [rows] = await conn.execute(
    `SELECT p.project_id, p.project_name, p.project_desc,
            COALESCE(rc.pending_count, 0) AS pending_count,
            COALESCE(rc.open_count, 0) AS open_count
     FROM USER_PROJECT up
     JOIN PROJECT p ON p.project_id = up.project_id
     LEFT JOIN (${REPORT_COUNTS_BY_PROJECT_SQL}) rc ON rc.project_id = p.project_id
     WHERE up.user_id = ?
     ORDER BY p.project_name ASC, p.project_id ASC`,
    [userId]
  );

  return json(200, rows);
}

async function listAllProjects(conn, auth) {
  const deny = requireRole(auth, ["admin"]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT p.project_id, p.project_name, p.project_desc,
            COALESCE(rc.pending_count, 0) AS pending_count,
            COALESCE(rc.open_count, 0) AS open_count
     FROM PROJECT p
     LEFT JOIN (${REPORT_COUNTS_BY_PROJECT_SQL}) rc ON rc.project_id = p.project_id
     ORDER BY p.project_name ASC, p.project_id ASC`
  );

  return json(200, rows);
}

// ===================== BUSES =====================

async function getBuses(conn, auth, qs) {
  const deny = requireRole(auth, [
    "admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver",
  ]);
  if (deny) return deny;

  const projectId = qs?.project_id ? String(qs.project_id).trim() : null;

  if (projectId) {
    const userId = await getOrCreateUserId(conn, auth);

    if (auth.role !== "admin") {
      const [chk] = await conn.execute(
        `SELECT 1 FROM USER_PROJECT WHERE user_id=? AND project_id=? LIMIT 1`,
        [userId, projectId]
      );
      if (!chk.length) return json(403, { message: "Forbidden" });
    }

    const [rows] = await conn.execute(
      `SELECT bus_id, bus_route, bus_route_colour, bus_route_number, bus_ev_no, bus_model, project_id
       FROM BUS WHERE project_id=? ORDER BY bus_id ASC`,
      [projectId]
    );
    return json(200, rows);
  }

  if (auth.role === "admin") {
    const [rows] = await conn.execute(
      "SELECT bus_id, bus_route, bus_route_colour, bus_route_number, bus_ev_no, bus_model, project_id FROM BUS ORDER BY bus_id ASC"
    );
    return json(200, rows);
  }

  const userId = await getOrCreateUserId(conn, auth);

  const [rows] = await conn.execute(
    `SELECT b.bus_id, b.bus_route, b.bus_route_colour, b.bus_route_number, b.bus_ev_no, b.bus_model, b.project_id
     FROM BUS b
     JOIN USER_PROJECT up ON up.project_id = b.project_id
     WHERE up.user_id = ?
     ORDER BY b.bus_id ASC`,
    [userId]
  );

  return json(200, rows);
}

async function createBus(conn, auth, b) {
  const deny = requireRole(auth, ["admin"]);
  if (deny) return deny;

  if (!b.bus_id) throw new Error("bus_id is required");

  const [res] = await conn.execute(
    `INSERT INTO BUS (bus_id, bus_route, bus_route_colour, bus_route_number, bus_ev_no, bus_model, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      String(b.bus_id).trim(),
      b.bus_route ? String(b.bus_route).trim() : null,
      b.bus_route_colour ? String(b.bus_route_colour).trim() : null,
      b.bus_route_number ? String(b.bus_route_number).trim() : null,
      // The fleet's own sequential number for the vehicle (EV006). Distinct
      // from bus_route_number, which is the route it runs and is shared by
      // every bus on that route.
      b.bus_ev_no ? String(b.bus_ev_no).trim() : null,
      b.bus_model ? String(b.bus_model).trim() : null,
      b.project_id ? String(b.project_id).trim() : null,
    ]
  );

  return json(200, { bus_id: res.insertId || b.bus_id });
}

async function updateBus(conn, auth, busId, b) {
  const deny = requireRole(auth, ["admin"]);
  if (deny) return deny;

  const updates = [];
  const vals = [];

  if (b.bus_id != null)               { updates.push("bus_id=?");            vals.push(String(b.bus_id).trim()); }
  if (b.bus_route !== undefined)       { updates.push("bus_route=?");         vals.push(b.bus_route ? String(b.bus_route).trim() : null); }
  if (b.bus_route_colour !== undefined) { updates.push("bus_route_colour=?"); vals.push(b.bus_route_colour ? String(b.bus_route_colour).trim() : null); }
  if (b.bus_route_number !== undefined) { updates.push("bus_route_number=?"); vals.push(b.bus_route_number ? String(b.bus_route_number).trim() : null); }
  if (b.bus_ev_no !== undefined)       { updates.push("bus_ev_no=?");          vals.push(b.bus_ev_no ? String(b.bus_ev_no).trim() : null); }
  if (b.bus_model !== undefined)       { updates.push("bus_model=?");         vals.push(b.bus_model ? String(b.bus_model).trim() : null); }
  if (b.project_id !== undefined)      { updates.push("project_id=?");        vals.push(b.project_id ? String(b.project_id).trim() : null); }

  if (!updates.length) return json(200, { success: true });

  vals.push(busId);
  await conn.execute(`UPDATE BUS SET ${updates.join(", ")} WHERE bus_id=?`, vals);

  return json(200, { success: true });
}

async function deleteBus(conn, auth, busId) {
  const deny = requireRole(auth, ["admin"]);
  if (deny) return deny;

  const [result] = await conn.execute("DELETE FROM BUS WHERE bus_id=?", [busId]);

  if (!result.affectedRows) return json(404, { message: "Bus not found" });

  return json(200, { success: true });
}

// ===================== PARTS =====================

const PARTS_MAX = 5000;

function parseStock(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function getParts(conn, auth, qs) {
  const deny = requireRole(auth, [
    "admin", "inventory_manager", "technician", "fleet_manager", "rm_manager",
  ]);
  if (deny) return deny;

  // The whole catalogue by default — the inventory list and the technician's
  // part picker both need every part, and a 200 cap silently hid the rest.
  const raw = qs?.limit;
  let limit = PARTS_MAX;
  if (raw != null) {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n > 0) limit = Math.min(n, PARTS_MAX);
  }

  const [rows] = await conn.query(
    `SELECT part_id, part_name, part_code, part_brand, part_unit, part_cost, part_stock FROM PART ORDER BY part_name ASC LIMIT ${limit}`
  );
  return json(200, rows);
}

// Parts catalogue editors. R&M managers maintain the list technicians pick
// from when adding parts to a job.
const PART_EDITOR_ROLES = ["admin", "inventory_manager", "rm_manager"];

// Units a part is counted in. "pc" parts are used in whole numbers; the rest
// (litres, kilograms, metres) may be fractional, e.g. 1.5 L of coolant.
const PART_UNITS = ["pc", "set", "L", "kg", "m"];

function normalisePartUnit(raw) {
  if (raw == null || String(raw).trim() === "") return "pc";
  const v = String(raw).trim();
  return PART_UNITS.find((u) => u.toLowerCase() === v.toLowerCase()) ?? null;
}

// A part quantity: > 0, at most 2 decimals. Whole numbers only for "pc"/"set".
function parsePartQty(raw, unit) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if ((unit === "pc" || unit === "set") && !Number.isInteger(n)) return null;
  return Math.round(n * 100) / 100;
}

async function createPart(conn, auth, b) {
  const deny = requireRole(auth, PART_EDITOR_ROLES);
  if (deny) return deny;

  const name = String(b.part_name ?? "").trim();
  const code = String(b.part_code ?? "").trim();
  if (!name) return json(400, { message: "Part name is required" });
  if (!code) return json(400, { message: "Part number is required" });
  const brand = b.part_brand != null && String(b.part_brand).trim() ? String(b.part_brand).trim() : null;

  const cost = b.part_cost == null || b.part_cost === "" ? null : Number(b.part_cost);
  if (cost != null && (!Number.isFinite(cost) || cost < 0)) return json(400, { message: "Invalid price" });

  // Stock tracking isn't wired into the app yet; the column is kept so it
  // can be, and new parts simply start at 0.
  // Quantity on hand. Recorded and shown, but not yet deducted when a
  // technician uses a part on a job.
  const stock = b.part_stock == null || b.part_stock === "" ? 0 : parseStock(b.part_stock);
  if (stock == null) return json(400, { message: "Quantity must be a whole number (0 or more)" });

  const unit = normalisePartUnit(b.part_unit);
  if (unit == null) return json(400, { message: `Unit must be one of: ${PART_UNITS.join(", ")}` });

  const [res] = await conn.execute(
    "INSERT INTO PART (part_name, part_code, part_brand, part_unit, part_cost, part_stock) VALUES (?,?,?,?,?,?)",
    [name, code, brand, unit, cost, stock]
  );

  return json(200, { success: true, part_id: Number(res.insertId) });
}

async function updatePart(conn, auth, partId, b) {
  const deny = requireRole(auth, PART_EDITOR_ROLES);
  if (deny) return deny;

  const updates = [];
  const vals = [];

  if (b.part_name != null) {
    const name = String(b.part_name).trim();
    if (!name) return json(400, { message: "Part name is required" });
    updates.push("part_name=?"); vals.push(name);
  }
  if (b.part_code != null) {
    const code = String(b.part_code).trim();
    if (!code) return json(400, { message: "Part number is required" });
    updates.push("part_code=?"); vals.push(code);
  }
  if (b.part_brand !== undefined) {
    const brand = b.part_brand != null && String(b.part_brand).trim() ? String(b.part_brand).trim() : null;
    updates.push("part_brand=?"); vals.push(brand);
  }
  if (b.part_unit !== undefined) {
    const unit = normalisePartUnit(b.part_unit);
    if (unit == null) return json(400, { message: `Unit must be one of: ${PART_UNITS.join(", ")}` });
    updates.push("part_unit=?"); vals.push(unit);
  }
  if (b.part_cost !== undefined) {
    const cost = b.part_cost == null || b.part_cost === "" ? null : Number(b.part_cost);
    if (cost != null && (!Number.isFinite(cost) || cost < 0)) return json(400, { message: "Invalid price" });
    updates.push("part_cost=?"); vals.push(cost);
  }
  if (b.part_stock != null) {
    const stock = parseStock(b.part_stock);
    if (stock == null) return json(400, { message: "Quantity must be a whole number (0 or more)" });
    updates.push("part_stock=?"); vals.push(stock);
  }

  if (!updates.length) return json(200, { success: true });

  vals.push(partId);
  await conn.execute(`UPDATE PART SET ${updates.join(", ")} WHERE part_id=?`, vals);
  return json(200, { success: true });
}

// ===================== REPORTS =====================

// The 29 EV bus system categories ("EV Bus – System Category & Description
// Master List"). A report, and every task, is filed under one. The KEY is what
// is stored, so the list can be renumbered without touching saved data.
// Mirrors src/utils/busSystems.ts in the app; keep the two lists in step.
const BUS_SYSTEMS = [
  ["axle_braking", "Axle & Braking System"],
  ["suspension", "Suspension System"],
  ["steering", "Steering System"],
  ["air_compressor", "Air Compressor System"],
  ["pneumatic", "Pneumatic System"],
  ["wheels_tyres", "Wheels & Tyres"],
  ["transmission_driveline", "Transmission & Driveline System"],
  ["chassis_frame", "Chassis & Frame System"],
  ["hv_battery", "High-Voltage Battery System"],
  ["hv_electrical", "High-Voltage Electrical System"],
  ["electric_drive", "Electric Drive & Propulsion System"],
  ["charging", "Charging System"],
  ["low_voltage_electrical", "Low-Voltage Electrical & Control System"],
  ["thermal_management", "Thermal Management System (TMS)"],
  ["auxiliary_thermal", "Auxiliary Thermal System (ATS)"],
  ["communication_telematics", "Communication & Telematics System"],
  ["body_structure", "Body & Structural System"],
  ["hvac", "Air Conditioning & HVAC System"],
  ["doors_access", "Door & Access System"],
  ["interior_seating", "Interior & Passenger Seating System"],
  ["lighting_signalling", "Lighting & Signalling System"],
  ["windscreen_glass_wipers", "Windscreen, Glass & Wiper System"],
  ["dashboard_instrumentation", "Dashboard & Instrumentation System"],
  ["fire_suppression", "Fire Detection & Suppression System"],
  ["brake_control_safety", "Brake Control & Electronic Safety System"],
  ["driver_controls", "Driver Control & Safety System"],
  ["mirrors", "Mirrors System"],
  ["cctv", "CCTV & Surveillance System"],
  ["accessibility_emergency", "Passenger Accessibility & Emergency Equipment"],
].map(([key, name], i) => ({ key, name, no: i + 1 }));
const BUS_SYSTEM_BY_KEY = new Map(BUS_SYSTEMS.map((c) => [c.key, c]));

// The seven issue types the app used before the bus-system list. Older app
// builds still send them; map them across where the meaning is clear.
const LEGACY_ISSUE_TYPES = {
  brakes: "axle_braking",
  doors: "doors_access",
  aircon: "hvac",
  tyres_wheels: "wheels_tyres",
  body_glass: "body_structure",
  battery_electrical: null,
  other: null,
};

// A category key, or null when it is missing or unknown.
function normaliseBusSystem(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (BUS_SYSTEM_BY_KEY.has(v)) return v;
  if (Object.prototype.hasOwnProperty.call(LEGACY_ISSUE_TYPES, v)) return LEGACY_ISSUE_TYPES[v];
  return null;
}

// Grouping key for counts: unset or unknown categories go under "uncategorised".
const UNCATEGORISED = "uncategorised";
const categoryOf = (raw) => normaliseBusSystem(raw) ?? UNCATEGORISED;

// { key, no, name } for the PDFs, which have no copy of the list.
function busSystemInfo(raw) {
  const c = BUS_SYSTEM_BY_KEY.get(normaliseBusSystem(raw) ?? "");
  return c ? { key: c.key, no: c.no, name: c.name } : null;
}

const TASK_JOB_TYPES = ["repair", "maintenance"];

// "VMQ6372 (EV012)", the way the depot names a bus; the plate alone when the
// bus has no EV number. Used in notification text.
function formatBusLabel(busId, evNo) {
  if (busId == null || busId === "") return "—";
  const ev = evNo == null ? "" : String(evNo).trim();
  return ev ? `${busId} (${ev})` : String(busId);
}

async function busLabel(conn, busId) {
  if (busId == null) return "—";
  try {
    const [rows] = await conn.execute("SELECT bus_ev_no FROM BUS WHERE bus_id=? LIMIT 1", [busId]);
    return formatBusLabel(busId, rows[0]?.bus_ev_no);
  } catch {
    return String(busId);
  }
}

// PATCH /reports/{id}: lets R&M correct a report's issue type (the reporter's
// pick is a best guess). Nothing else on a report is editable here.
async function patchReport(conn, auth, reportId, b) {
  const deny = requireRole(auth, ["admin", "rm_manager", "fleet_manager"]);
  if (deny) return deny;

  const issueType = normaliseBusSystem(b?.report_issue_type);
  if (!issueType) {
    return json(400, { message: "report_issue_type must be one of the 29 bus system categories" });
  }

  const [rows] = await conn.execute("SELECT project_id FROM REPORT WHERE report_id=?", [reportId]);
  if (!rows.length) return json(404, { message: "Report not found" });
  if (auth.role !== "admin") {
    const userId = await getOrCreateUserId(conn, auth);
    const [chk] = await conn.execute(
      "SELECT 1 FROM USER_PROJECT WHERE user_id=? AND project_id=? LIMIT 1",
      [userId, rows[0].project_id]
    );
    if (!chk.length) return json(403, { message: "Forbidden" });
  }

  await conn.execute("UPDATE REPORT SET report_issue_type=? WHERE report_id=?", [issueType, reportId]);
  return json(200, { success: true, report_issue_type: issueType });
}

// A report that exists only so its selfie and photos have something to attach
// to. It is not a submission yet: excluded from every list, count and
// notification until POST /reports/{id}/submit promotes it.
const REPORT_STATUS_DRAFT = "draft";

async function listReports(conn, auth, qs) {
  const deny = requireRole(auth, [
    "admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver",
  ]);
  if (deny) return deny;

  const mine = qs.mine === "1";
  const status = qs.status ? String(qs.status).trim().toLowerCase() : null;
  const type = qs.type ? String(qs.type).trim() : null;
  const projectId = qs.project_id ? String(qs.project_id).trim() : null;

  const userId = await getOrCreateUserId(conn, auth);
  const where = [];
  const vals = [];

  if (mine) { where.push("r.user_id=?"); vals.push(userId); }
  if (auth.role === "driver") { where.push("r.user_id=?"); vals.push(userId); }

  if (status) {
    if (status === "pending" || status === "submitted") {
      where.push("(r.report_status IS NULL OR TRIM(r.report_status)='' OR LOWER(TRIM(r.report_status)) IN ('submitted','pending'))");
    } else {
      where.push("LOWER(TRIM(r.report_status)) = ?"); vals.push(status);
    }
  }

  if (type) { where.push("LOWER(TRIM(r.report_type))=?"); vals.push(type.toLowerCase()); }
  if (projectId) { where.push("r.project_id=?"); vals.push(projectId); }
  // Everyone but admin sees only the projects they are assigned to.
  if (auth.role !== "admin") {
    where.push("r.project_id IN (SELECT project_id FROM USER_PROJECT WHERE user_id=?)");
    vals.push(userId);
  }

  where.push("LOWER(TRIM(COALESCE(r.report_status,''))) <> ?");
  vals.push(REPORT_STATUS_DRAFT);

  // Pending and Open reports are always returned in full — they are the
  // work queue, and a flat LIMIT 200 used to drop the oldest of them off the
  // R&M screen (and out of the red count) once a project passed 200 reports.
  // Only closed history is capped.
  const closedClause = "LOWER(TRIM(COALESCE(r.report_status,''))) = 'closed'";
  const queries =
    status === "closed"
      ? [{ extra: null, limit: CLOSED_HISTORY_LIMIT }]
      : status
        ? [{ extra: null, limit: null }]
        : [
            { extra: `NOT (${closedClause})`, limit: null },
            { extra: closedClause, limit: CLOSED_HISTORY_LIMIT },
          ];

  const rows = [];
  for (const q of queries) {
    const w = q.extra ? [...where, q.extra] : where;
    const [part] = await conn.execute(reportListSql(w, q.limit), vals);
    rows.push(...(part || []));
  }
  rows.sort(
    (a, b) =>
      new Date(b.report_uploaded_at ?? 0).getTime() - new Date(a.report_uploaded_at ?? 0).getTime() ||
      Number(b.report_id) - Number(a.report_id)
  );

  const enriched = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      report_selfie_view_url: await signS3Url(r.report_selfie_s3_bucket, r.report_selfie_s3_key),
      report_review_selfie_view_url: await signS3Url(r.report_review_selfie_s3_bucket, r.report_review_selfie_s3_key),
      job_accept_selfie_view_url: await signS3Url(r.job_accept_selfie_s3_bucket, r.job_accept_selfie_s3_key),
    }))
  );
  return json(200, enriched);
}

// Closed reports/jobs shown in history lists; open work is never capped.
const CLOSED_HISTORY_LIMIT = 200;

function reportListSql(where, limit) {
  return `
    SELECT
      r.report_id, r.report_type, r.report_issue_type, r.report_desc, r.report_location,
      r.report_lat, r.report_lng, r.report_priority, r.report_status,
      r.report_uploaded_at, r.user_id, r.bus_id, r.job_id,
      r.report_review_action, r.report_review_reason, r.report_review_by, r.report_review_at,
      r.report_verified_name, r.report_selfie_s3_bucket, r.report_selfie_s3_key,
      r.report_review_verified_name, r.report_review_selfie_s3_bucket, r.report_review_selfie_s3_key,
      u.user_name AS reporter_name, u.user_email AS reporter_email,
      b.bus_route, b.bus_model, b.bus_ev_no,
      jb.job_completed_at, jb.technician_user_id, jb.job_ref_no,
      jb.job_accept_verified_name, jb.job_accept_selfie_s3_bucket, jb.job_accept_selfie_s3_key,
      tech.user_name AS technician_name
    FROM REPORT r
    LEFT JOIN \`USER\` u ON u.user_id = r.user_id
    LEFT JOIN BUS b ON b.bus_id = r.bus_id
    LEFT JOIN JOB jb ON jb.job_id = r.job_id
    LEFT JOIN \`USER\` tech ON tech.user_id = jb.technician_user_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY r.report_uploaded_at DESC, r.report_id DESC
    ${limit ? `LIMIT ${Number(limit)}` : ""}
  `;
}

async function getReport(conn, auth, reportId) {
  const deny = requireRole(auth, [
    "admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver",
  ]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT r.*, u.user_name AS reporter_name, u.user_email AS reporter_email,
            b.bus_ev_no, b.bus_model
     FROM REPORT r LEFT JOIN \`USER\` u ON u.user_id=r.user_id
     LEFT JOIN BUS b ON b.bus_id=r.bus_id
     WHERE r.report_id=?`,
    [reportId]
  );

  if (!rows.length) return json(404, { message: "Report not found" });

  if (auth.role === "driver") {
    const userId = await getOrCreateUserId(conn, auth);
    if (Number(rows[0].user_id) !== userId) return json(403, { message: "Forbidden" });
  }

  const row = rows[0];
  const report_selfie_view_url = await signS3Url(row.report_selfie_s3_bucket, row.report_selfie_s3_key);
  const report_review_selfie_view_url = await signS3Url(row.report_review_selfie_s3_bucket, row.report_review_selfie_s3_key);

  return json(200, { ...row, report_selfie_view_url, report_review_selfie_view_url });
}

async function createReport(conn, auth, b) {
  const deny = requireRole(auth, [
    "admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver",
  ]);
  if (deny) return deny;

  const userId = await getOrCreateUserId(conn, auth);

  if (!b.project_id) throw new Error("project_id is required");
  const projectId = String(b.project_id).trim();
  if (!projectId) throw new Error("project_id is required");
  if (!b.bus_id) throw new Error("bus_id is required");
  if (!b.report_type) throw new Error("report_type is required");

  if (auth.role !== "admin") {
    const [chk] = await conn.execute(
      `SELECT 1 FROM USER_PROJECT WHERE user_id=? AND project_id=? LIMIT 1`,
      [userId, projectId]
    );
    if (!chk.length) return json(403, { message: "Forbidden" });
  }

  const [busRows] = await conn.execute(
    `SELECT 1 FROM BUS WHERE bus_id=? AND project_id=? LIMIT 1`,
    [b.bus_id, projectId]
  );
  if (!busRows.length) throw new Error("bus_id is not in the selected project");

  // Created as a draft, not 'submitted'. The row has to exist before its
  // selfie and photos can be presigned against it, but until those uploads
  // finish it isn't a real report — so it stays invisible to reviewers and
  // silent until POST /reports/{id}/submit promotes it.
  // Unknown or legacy-unmappable values are stored as NULL (uncategorised)
  // rather than refused, so an older app build can still submit.
  const issueType = normaliseBusSystem(b.report_issue_type);

  const [res] = await conn.execute(
    `INSERT INTO REPORT
     (project_id, report_type, report_issue_type, report_desc, report_location, report_lat, report_lng,
      report_priority, report_status, user_id, bus_id, report_uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      projectId, b.report_type, issueType, b.report_desc ?? null,
      b.report_location ?? null, b.report_lat ?? null, b.report_lng ?? null,
      b.report_priority ?? "medium", REPORT_STATUS_DRAFT, userId, b.bus_id,
    ]
  );

  return json(200, { report_id: res.insertId, report_status: REPORT_STATUS_DRAFT });
}

// Promotes a finished draft to 'submitted' — the point at which the report
// becomes visible to reviewers and the "new report" notification fires. Called
// by the reporter once the selfie and every photo have uploaded, so a
// submission that fails part-way leaves a draft nobody ever sees rather than a
// blank report in the pending queue.
async function submitReport(conn, auth, reportId) {
  const deny = requireRole(auth, [
    "admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver",
  ]);
  if (deny) return deny;

  const userId = await getOrCreateUserId(conn, auth);

  const [rows] = await conn.execute(
    "SELECT report_id, user_id, bus_id, report_type, report_status, project_id FROM REPORT WHERE report_id=?",
    [reportId]
  );
  if (!rows.length) return json(404, { message: "Report not found" });

  const report = rows[0];
  // Only the author finalises their own report, whatever their role.
  if (Number(report.user_id) !== userId && auth.role !== "admin") {
    return json(403, { code: "FORBIDDEN", message: "Forbidden" });
  }

  // Idempotent: a retried submit (flaky network, double tap) must not fire a
  // second notification or reopen a report a reviewer has already moved on.
  const current = (report.report_status ?? "").toString().trim().toLowerCase();
  if (current !== REPORT_STATUS_DRAFT) {
    return json(200, { success: true, already_submitted: true, report_status: report.report_status });
  }

  await conn.execute(
    "UPDATE REPORT SET report_status='submitted', report_uploaded_at=NOW() WHERE report_id=? AND LOWER(TRIM(report_status))=?",
    [reportId, REPORT_STATUS_DRAFT]
  );

  const reporterName = await getDisplayName(conn, auth);
  await notifyUsersByRole(conn, {
    roles: ["admin", "rm_manager", "fleet_manager"],
    projectId: report.project_id ?? null,
    excludeUserId: userId,
    type: "new_report",
    title: "New report submitted",
    body: `${reporterName} submitted a ${report.report_type} report for bus ${await busLabel(conn, report.bus_id)}.`,
    reportId,
  });

  return json(200, { success: true, report_status: "submitted" });
}

const REVIEW_ACTIONS = ["approved", "declined"];

// '' / NULL / 'submitted' / 'pending' all mean "awaiting review".
function normaliseReportStatus(raw) {
  const s = (raw ?? "").toString().trim().toLowerCase();
  return !s || s === "submitted" ? "pending" : s;
}

async function updateReportStatus(conn, auth, reportId, b) {
  if (!b.report_status) throw new Error("report_status is required");

  const nextStatus = String(b.report_status).trim().toLowerCase();
  const action = b.report_review_action != null ? String(b.report_review_action).trim().toLowerCase() : null;
  const isTech = auth.role === "technician";

  if (isTech) {
    // Technicians may only close the report tied to their own job. Closing
    // now also happens server-side when the job is closed (updateJobStatus);
    // this path stays for older app versions.
    if (nextStatus !== "closed" || action != null) {
      return json(403, { code: "FORBIDDEN", message: "Forbidden" });
    }
  } else {
    const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager"]);
    if (deny) return deny;
    if (action != null && !REVIEW_ACTIONS.includes(action)) {
      return json(400, { message: "Invalid report_review_action" });
    }
  }

  // Looked up before the transaction: anything that throws after COMMIT
  // would report an error for a change that was in fact saved.
  const userId = await getOrCreateUserId(conn, auth);
  const reviewerName = isTech ? null : await getDisplayName(conn, auth);

  // Approving is a sign-off: the manager types their name and takes a selfie
  // (uploaded via presignVerificationSelfie, kind=report-review).
  const reviewName = (b.review_verified_name ?? "").toString().trim() || null;
  const reviewSelfieKey = (b.review_selfie_s3_key ?? "").toString().trim() || null;
  if (action === "approved" && (!reviewName || !reviewSelfieKey)) {
    return json(400, { code: "VERIFICATION_REQUIRED", message: "Your name and a selfie are required to approve a report" });
  }
  if (reviewSelfieKey && !reviewSelfieKey.startsWith(`reports/${reportId}/review-selfie/`)) {
    return json(400, { message: "Invalid review_selfie_s3_key" });
  }

  const shouldCreateJob = !isTech && (action === "approved" || nextStatus === "open");
  let report;
  let jobId;
  let jobWasCreated = false;

  await conn.beginTransaction();
  try {
    const [rRows] = await conn.execute(
      `SELECT r.report_id, r.job_id, r.user_id, r.bus_id, r.report_type, r.project_id,
              r.report_status, r.report_review_action, r.report_review_by, j.technician_user_id
       FROM REPORT r LEFT JOIN JOB j ON j.job_id = r.job_id
       WHERE r.report_id=? FOR UPDATE`,
      [reportId]
    );
    if (!rRows.length) { await conn.rollback(); return json(404, { message: "Report not found" }); }
    report = rRows[0];
    const current = normaliseReportStatus(report.report_status);

    if (isTech) {
      if (report.technician_user_id == null || Number(report.technician_user_id) !== userId) {
        await conn.rollback();
        return json(403, { code: "FORBIDDEN", message: "Forbidden" });
      }
      // Already closed (normally by updateJobStatus) — nothing to do.
      if (current === "closed") {
        await conn.rollback();
        return json(200, { success: true, already: true, job_id: report.job_id });
      }
    } else if (auth.role !== "admin") {
      const [member] = await conn.execute(
        "SELECT 1 FROM USER_PROJECT WHERE user_id=? AND project_id=? LIMIT 1",
        [userId, report.project_id]
      );
      if (!member.length) { await conn.rollback(); return json(403, { code: "FORBIDDEN", message: "Forbidden" }); }
    }

    // Approve/decline only from Pending. Without this, a manager looking at
    // a stale list (or a second manager) could decline a report whose job a
    // technician was already working on, or approve a finished report back
    // to Open.
    if (action != null && current !== "pending") {
      await conn.rollback();
      const done = report.report_review_action || current;
      return json(409, {
        code: "REPORT_ALREADY_HANDLED",
        message: `This report was already ${done}${report.report_review_by ? ` by ${report.report_review_by}` : ""}. Pull down to refresh.`,
      });
    }

    jobId = report.job_id ? Number(report.job_id) : null;
    jobWasCreated = shouldCreateJob && !jobId;

    if (jobWasCreated) {
      const jobDesc = b.job_desc != null ? String(b.job_desc) : `Created from approved report #${reportId}`;
      const [jobRes] = await conn.execute(
        "INSERT INTO JOB (job_desc, job_status, job_created_at) VALUES (?, 'open', NOW())",
        [jobDesc]
      );
      jobId = Number(jobRes.insertId);
      await conn.execute("UPDATE REPORT SET job_id=? WHERE report_id=?", [jobId, reportId]);
    }

    const updates = ["report_status=?"];
    const values = [String(b.report_status)];

    // Review fields are written only by an approve/decline, and the reviewer
    // and time come from the server — the technician's close used to send its
    // own report_review_at and overwrite the approval time.
    if (action != null) {
      updates.push("report_review_action=?", "report_review_reason=?", "report_review_by=?", "report_review_at=NOW()");
      values.push(action, action === "declined" ? (b.report_review_reason ?? null) : null, reviewerName);
      if (reviewName && reviewSelfieKey) {
        updates.push("report_review_verified_name=?", "report_review_selfie_s3_bucket=?", "report_review_selfie_s3_key=?");
        values.push(reviewName, S3_BUCKET, reviewSelfieKey);
      }
    }

    values.push(reportId);
    await conn.execute(`UPDATE REPORT SET ${updates.join(", ")} WHERE report_id=?`, values);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }

  // Saved. Notifications are best-effort and cannot fail the request.
  if (jobWasCreated) {
    await notifyUsersByRole(conn, {
      roles: ["technician"],
      projectId: report.project_id ?? null,
      excludeUserId: userId,
      type: "new_job",
      title: "New job available",
      body: `A new job is available to accept (from report #${reportId}).`,
      reportId,
      jobId,
    });
  }

  // Tell the person who filed the report what happened to it.
  if (action === "approved" || action === "declined") {
    const authorId = Number(report.user_id);
    const reason = b.report_review_reason ? String(b.report_review_reason).trim() : "";
    const bus = await busLabel(conn, report.bus_id);
    await notifyUsers(conn, {
      userIds: authorId && authorId !== userId ? [authorId] : [],
      type: "report_reviewed",
      title: action === "approved" ? "Report approved" : "Report declined",
      body:
        action === "approved"
          ? `Your ${report.report_type} report for bus ${bus} was approved.`
          : `Your ${report.report_type} report for bus ${bus} was declined${reason ? `: ${reason}` : "."}`,
      reportId,
    });
  }

  return json(200, { success: true, job_id: jobId });
}

// ===================== JOBS =====================

async function upsertOdometerRecordedTask(conn, jobId) {
  await conn.execute(
    `INSERT INTO JOB_TASK (job_id, task_name, task_status, task_order, completed_at, created_at)
     VALUES (?, 'Recorded odometer reading', 'done', 0, NOW(), NOW())
     ON DUPLICATE KEY UPDATE task_status = 'done'`,
    [jobId]
  );
}

function toWholeNumber(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0)
    throw new Error(`${name} must be a whole number >= 0`);
  return n;
}

async function assertTechJobUnlocked(conn, auth, jobId) {
  if (auth.role !== "technician") return;

  const techUserId = await getOrCreateUserId(conn, auth);
  const [rows] = await conn.execute(
    `SELECT technician_user_id, job_odometer, job_status FROM JOB WHERE job_id=? LIMIT 1`,
    [jobId]
  );

  if (!rows.length) throw new Error("job_id not found");
  if (rows[0].technician_user_id == null) return json(409, { code: "JOB_NOT_ACCEPTED", message: "Job not accepted yet" });
  if (Number(rows[0].technician_user_id) !== techUserId) return json(403, { code: "FORBIDDEN", message: "Forbidden" });
  // A completed job is final: no more tasks, parts or photos.
  if (JOB_DONE_STATUSES.includes(rows[0].job_status)) return json(409, { code: "JOB_CLOSED", message: "This job is already completed" });
  if (rows[0].job_odometer == null) return json(409, { code: "ODOMETER_REQUIRED", message: "Initial odometer is required before updating this job" });

  return null;
}

async function assertTechTaskUnlocked(conn, auth, taskId) {
  if (auth.role !== "technician") return;

  const [rows] = await conn.execute(`SELECT job_id FROM JOB_TASK WHERE task_id=? LIMIT 1`, [taskId]);
  if (!rows.length) throw new Error("task_id not found");
  return await assertTechJobUnlocked(conn, auth, Number(rows[0].job_id));
}

async function patchJob(conn, auth, jobId, b) {
  const deny = requireRole(auth, ["admin", "technician", "fleet_manager", "rm_manager"]);
  if (deny) return deny;

  const rawOdo = b?.job_odometer ?? b?.jobOdometer ?? b?.odometer ?? b?.jobOdo ?? undefined;
  if (rawOdo === undefined) throw new Error("job_odometer is required (or send odometer/jobOdometer)");

  const odo = toWholeNumber(rawOdo, "job_odometer");

  if (auth.role === "technician") {
    const techUserId = await getOrCreateUserId(conn, auth);
    const [res] = await conn.execute(
      `UPDATE JOB SET job_odometer=?, job_arrived_at=COALESCE(job_arrived_at, NOW()), job_updated_at=NOW()
       WHERE job_id=? AND technician_user_id=? AND job_odometer IS NULL`,
      [odo, jobId, techUserId]
    );

    if (!res.affectedRows) {
      const [chk] = await conn.execute(`SELECT technician_user_id, job_odometer FROM JOB WHERE job_id=? LIMIT 1`, [jobId]);
      if (!chk.length) return json(404, { message: "Job not found" });
      if (chk[0].job_odometer != null) return json(409, { code: "ODOMETER_ALREADY_SET", message: "Odometer already recorded" });
      if (chk[0].technician_user_id == null) return json(409, { code: "JOB_NOT_ACCEPTED", message: "Job not accepted yet" });
      if (Number(chk[0].technician_user_id) !== techUserId) return json(403, { code: "FORBIDDEN", message: "Forbidden" });
      return json(409, { code: "ODOMETER_SET_FAILED", message: "Unable to set odometer" });
    }

    await upsertOdometerRecordedTask(conn, jobId);
    return json(200, { success: true, job_odometer: odo });
  }

  await conn.execute(
    `UPDATE JOB SET job_odometer=?, job_arrived_at=COALESCE(job_arrived_at, NOW()), job_updated_at=NOW() WHERE job_id=?`,
    [odo, jobId]
  );
  await upsertOdometerRecordedTask(conn, jobId);
  return json(200, { success: true, job_odometer: odo });
}

async function getOrCreateDefaultTask(conn, jobId) {
  const DEFAULT_NAME = "General / Parts Used";
  const [rows] = await conn.execute(
    `SELECT task_id FROM JOB_TASK WHERE job_id=? AND task_name=? LIMIT 1`,
    [jobId, DEFAULT_NAME]
  );
  if (rows.length) return Number(rows[0].task_id);

  const [res] = await conn.execute(
    `INSERT INTO JOB_TASK (job_id, task_name, task_status, task_order, completed_at, created_at) VALUES (?, ?, 'in_progress', 1, NOW(), NOW())`,
    [jobId, DEFAULT_NAME]
  );
  return Number(res.insertId);
}

async function createJobForReport(conn, auth, reportId, b) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager"]);
  if (deny) return deny;

  await conn.beginTransaction();
  try {
    const [jobRes] = await conn.execute(
      "INSERT INTO JOB (job_desc, job_status, job_created_at) VALUES (?, 'open', NOW())",
      [b.job_desc ?? null]
    );
    const jobId = jobRes.insertId;
    const [u] = await conn.execute(
      "UPDATE REPORT SET job_id=? WHERE report_id=? AND job_id IS NULL",
      [jobId, reportId]
    );
    if (!u.affectedRows) throw new Error("Report not found or already has a job");
    await conn.commit();
    return json(200, { job_id: jobId });
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

async function assignJobToMe(conn, auth, jobId, b = {}) {
  const deny = requireRole(auth, ["technician", "admin"]);
  if (deny) return deny;

  // Who is physically accepting: a name typed on the spot plus a selfie,
  // required from technicians (see presignVerificationSelfie).
  const verifiedName = (b.verified_name ?? "").toString().trim() || null;
  const selfieKey = (b.selfie_s3_key ?? "").toString().trim() || null;
  if (auth.role === "technician" && (!verifiedName || !selfieKey)) {
    return json(400, { code: "VERIFICATION_REQUIRED", message: "Your name and a selfie are required to accept a job" });
  }
  if (selfieKey && !selfieKey.startsWith(`jobs/${jobId}/accept-selfie/`)) {
    return json(400, { message: "Invalid selfie_s3_key" });
  }

  const techUserId = await getOrCreateUserId(conn, auth);
  const [res] = await conn.execute(
    `UPDATE JOB SET technician_user_id=?, job_accepted_at=NOW(), job_updated_at=NOW(),
       job_accept_verified_name=?, job_accept_selfie_s3_bucket=?, job_accept_selfie_s3_key=?
     WHERE job_id=? AND technician_user_id IS NULL`,
    [techUserId, verifiedName, selfieKey ? S3_BUCKET : null, selfieKey, jobId]
  );
  if (!res.affectedRows) {
    // A repeated tap (or a retry after a dropped response) arrives after the
    // first request already assigned the job to this same technician. That
    // is a success, not a conflict — reporting it as an error is what made
    // accepting look like it failed while the job moved to My Jobs anyway.
    const [chk] = await conn.execute(
      `SELECT j.technician_user_id, u.user_name
       FROM JOB j LEFT JOIN \`USER\` u ON u.user_id = j.technician_user_id
       WHERE j.job_id=? LIMIT 1`,
      [jobId]
    );
    if (!chk.length) return json(404, { message: "Job not found" });
    if (Number(chk[0].technician_user_id) === techUserId) {
      return json(200, { success: true, already: true });
    }
    return json(409, {
      code: "JOB_TAKEN",
      message: `This job was already accepted by ${chk[0].user_name || "another technician"}.`,
    });
  }

  const technicianName = await getDisplayName(conn, auth);
  await notifyUsersByRole(conn, {
    roles: ["admin", "rm_manager", "fleet_manager"],
    projectId: await projectIdForJob(conn, jobId),
    excludeUserId: techUserId,
    type: "job_progress",
    title: "Job accepted",
    body: `Job #${jobId} was accepted by ${technicianName}.`,
    jobId,
  });

  return json(200, { success: true });
}

async function listJobs(conn, auth, qs) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const status = qs.status ? String(qs.status) : null;
  const projectId = qs.project_id ? String(qs.project_id).trim() : null;
  // One job by id, for the job screens — they used to find their job by
  // scanning the 200-row list, and showed "not found" once it fell off.
  const jobId = qs.job_id != null ? toId(qs.job_id, "job_id") : null;

  const where = [];
  const vals = [];
  if (jobId) { where.push("j.job_id=?"); vals.push(jobId); }
  if (status) { where.push("j.job_status=?"); vals.push(status); }
  if (projectId) { where.push("r.project_id=?"); vals.push(projectId); }
  // Everyone but admin sees only the projects they are assigned to.
  if (auth.role !== "admin") {
    const userId = await getOrCreateUserId(conn, auth);
    where.push("r.project_id IN (SELECT project_id FROM USER_PROJECT WHERE user_id=?)");
    vals.push(userId);
  }

  // Open work is returned in full; only finished history is capped (see
  // listReports for why).
  const doneClause = `j.job_status IN ${JOB_DONE_SQL}`;
  const queries =
    jobId || status
      ? [{ extra: null, limit: JOB_DONE_STATUSES.includes(status) ? CLOSED_HISTORY_LIMIT : null }]
      : [
          { extra: `NOT (${doneClause})`, limit: null },
          { extra: doneClause, limit: CLOSED_HISTORY_LIMIT },
        ];

  const rows = [];
  for (const q of queries) {
    const w = q.extra ? [...where, q.extra] : where;
    const [part] = await conn.execute(jobListSql(w, q.limit), vals);
    rows.push(...(part || []));
  }
  rows.sort(
    (a, b) =>
      new Date(b.job_created_at ?? 0).getTime() - new Date(a.job_created_at ?? 0).getTime() ||
      Number(b.job_id) - Number(a.job_id)
  );

  const enriched = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      job_selfie_view_url: await signS3Url(r.job_selfie_s3_bucket, r.job_selfie_s3_key),
      job_accept_selfie_view_url: await signS3Url(r.job_accept_selfie_s3_bucket, r.job_accept_selfie_s3_key),
      report_selfie_view_url: await signS3Url(r.report_selfie_s3_bucket, r.report_selfie_s3_key),
      report_review_selfie_view_url: await signS3Url(r.report_review_selfie_s3_bucket, r.report_review_selfie_s3_key),
    }))
  );

  return json(200, enriched);
}

const JOB_DONE_STATUSES = ["closed", "completed", "done"];
const JOB_DONE_SQL = "('closed','completed','done')";

function jobListSql(where, limit) {
  return `
    SELECT
      j.job_id, j.job_desc, j.job_status, j.technician_user_id,
      tech.user_name AS technician_name,
      j.job_odometer, j.job_created_at, j.job_accepted_at, j.job_arrived_at, j.job_updated_at, j.job_completed_at,
      j.job_verified_name, j.job_selfie_s3_bucket, j.job_selfie_s3_key,
      j.job_accept_verified_name, j.job_accept_selfie_s3_bucket, j.job_accept_selfie_s3_key,
      j.job_ref_no,
      r.report_id, r.report_type, r.report_issue_type, r.report_priority, r.report_desc,
      r.report_location, r.report_uploaded_at, r.bus_id, r.project_id,
      r.report_verified_name, r.report_selfie_s3_bucket, r.report_selfie_s3_key,
      r.report_review_by, r.report_review_at, r.report_review_verified_name,
      r.report_review_selfie_s3_bucket, r.report_review_selfie_s3_key,
      reporter.user_name AS reporter_name,
      b.bus_ev_no, b.bus_model
    FROM JOB j
    LEFT JOIN REPORT r ON r.job_id = j.job_id
    LEFT JOIN BUS b ON b.bus_id = r.bus_id
    LEFT JOIN \`USER\` reporter ON reporter.user_id = r.user_id
    LEFT JOIN \`USER\` tech ON tech.user_id = j.technician_user_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY j.job_created_at DESC, j.job_id DESC
    ${limit ? `LIMIT ${Number(limit)}` : ""}
  `;
}

async function getJob(conn, auth, jobId) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const [rows] = await conn.execute("SELECT * FROM JOB WHERE job_id=?", [jobId]);
  if (!rows.length) return json(404, { message: "Job not found" });
  return json(200, rows[0]);
}

async function listJobParts(conn, auth, jobId) {
  const deny = requireRole(auth, ["admin", "inventory_manager", "technician", "fleet_manager", "rm_manager"]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT t.task_id, t.task_name, tp.part_id, tp.qty AS jp_qty, tp.line_cost AS jp_linecost, p.part_name, p.part_code, p.part_brand, p.part_unit, p.part_cost
     FROM JOB_TASK t JOIN JOB_TASK_PART tp ON tp.task_id = t.task_id JOIN PART p ON p.part_id = tp.part_id
     WHERE t.job_id=? ORDER BY t.task_order, p.part_name`,
    [jobId]
  );
  return json(200, rows);
}

async function addJobPart(conn, auth, jobId, b) {
  const deny = requireRole(auth, ["admin", "inventory_manager", "technician"]);
  if (deny) return deny;

  const lock = await assertTechJobUnlocked(conn, auth, jobId);
  if (lock) return lock;

  const partId = toId(b.part_id, "part_id");
  const qty = b.jp_qty == null ? 1 : Number(b.jp_qty);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("jp_qty must be a positive integer");
  const lineCost = b.jp_linecost == null ? 0 : Number(b.jp_linecost);
  if (!Number.isFinite(lineCost)) throw new Error("Invalid jp_linecost");

  const taskId = await getOrCreateDefaultTask(conn, jobId);
  await conn.execute(
    `INSERT INTO JOB_TASK_PART (task_id, part_id, qty, line_cost) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty), line_cost = line_cost + VALUES(line_cost)`,
    [taskId, partId, qty, lineCost]
  );
  return json(200, { success: true, task_id: taskId });
}

async function updateJobStatus(conn, auth, jobId, b) {
  const deny = requireRole(auth, ["admin", "technician", "fleet_manager", "rm_manager"]);
  if (deny) return deny;

  if (!b.to_status) throw new Error("to_status is required");
  const toStatus = String(b.to_status);
  const isTerminal = JOB_DONE_STATUSES.includes(toStatus);
  const userId = await getOrCreateUserId(conn, auth);

  const [jRows] = await conn.execute(
    "SELECT job_status, technician_user_id, job_selfie_s3_key FROM JOB WHERE job_id=? LIMIT 1",
    [jobId]
  );
  if (!jRows.length) return json(404, { message: "Job not found" });
  const job = jRows[0];

  // Closing twice (a retry after a lost response) is a success, and must not
  // move the completion time or send "Job completed" again.
  if (isTerminal && JOB_DONE_STATUSES.includes(job.job_status)) {
    if (auth.role === "technician" && Number(job.technician_user_id) !== userId) {
      return json(403, { code: "FORBIDDEN", message: "Forbidden" });
    }
    return json(200, { success: true, already: true });
  }

  const lock = await assertTechJobUnlocked(conn, auth, jobId);
  if (lock) return lock;

  // The completion sign-off (name + selfie) has to be on the job first —
  // the app enforced this, the server didn't.
  if (auth.role === "technician" && isTerminal && !job.job_selfie_s3_key) {
    return json(400, { code: "VERIFICATION_REQUIRED", message: "Your name and a selfie are required to complete a job" });
  }

  if (isTerminal) {
    const problem = await checkTasksComplete(conn, jobId);
    if (problem) return json(400, { code: "TASK_INCOMPLETE", message: problem });
  }

  // The job and its report close together. The app used to close the report
  // in a second request, and when that one failed the report stayed Open
  // forever with nothing the technician could do about it.
  await conn.beginTransaction();
  try {
    if (isTerminal) {
      await conn.execute(
        "UPDATE JOB SET job_status=?, job_updated_at=NOW(), job_completed_at=NOW() WHERE job_id=?",
        [toStatus, jobId]
      );
      await conn.execute(
        `UPDATE REPORT SET report_status='closed'
         WHERE job_id=? AND LOWER(TRIM(COALESCE(report_status,''))) <> 'closed'`,
        [jobId]
      );
    } else {
      await conn.execute(
        "UPDATE JOB SET job_status=?, job_updated_at=NOW() WHERE job_id=?",
        [toStatus, jobId]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }

  // The Job Completion Report: give the job its fixed reference number and
  // queue the PDF. Best-effort: a failure here never undoes the close, and
  // GET /jobs/{id}/report-pdf retries it.
  if (isTerminal) {
    try {
      await ensureJobRefNo(conn, jobId);
      await queueJobReportPdf(conn, jobId);
    } catch (e) {
      console.error("[PDF] queue after close failed", { jobId, message: e?.message });
    }
  }

  const closedReport = isTerminal ? await reportForJob(conn, jobId) : null;
  const isJobOrder = closedReport?.report_type === JOB_ORDER_TYPE;
  await notifyUsersByRole(conn, {
    roles: ["admin", "rm_manager", "fleet_manager"],
    projectId: await projectIdForJob(conn, jobId),
    excludeUserId: userId,
    type: "job_progress",
    title: isJobOrder ? "Job order logged" : isTerminal ? "Job completed" : "Job status updated",
    body: isJobOrder
      ? `${await getDisplayName(conn, auth)} logged Job Order #${jobId} for bus ${await busLabel(conn, closedReport.bus_id)}.`
      : `Job #${jobId} status changed to "${toStatus}".`,
    jobId,
  });

  return json(200, { success: true });
}

async function reportForJob(conn, jobId) {
  const [rows] = await conn.execute(
    "SELECT report_id, report_type, bus_id, project_id FROM REPORT WHERE job_id=? LIMIT 1",
    [jobId]
  );
  return rows[0] ?? null;
}

// Tasks created from this date on must carry a full record before the job
// can close: work done, parts used (or "no parts used" ticked) and at least
// one photo. Older tasks predate those fields and are immutable, so holding
// them to the rule would leave jobs that were open at release unclosable.
const TASK_RULES_SINCE = process.env.TASK_RULES_SINCE || "2026-11-11 00:00:00";
const SYSTEM_TASK_NAMES = ["Recorded odometer reading", "General / Parts Used"];

async function checkTasksComplete(conn, jobId) {
  const [tasks] = await conn.execute(
    `SELECT t.task_id, t.task_name, t.task_desc, t.task_no_parts, t.task_job_type, t.task_category,
            (SELECT COUNT(*) FROM JOB_TASK_PART tp WHERE tp.task_id = t.task_id) AS part_count,
            (SELECT COUNT(*) FROM JOB_MEDIA m WHERE m.task_id = t.task_id) AS photo_count
     FROM JOB_TASK t
     WHERE t.job_id=? AND t.created_at >= ? AND t.task_name NOT IN (?, ?)
     ORDER BY t.task_order, t.task_id`,
    [jobId, TASK_RULES_SINCE, ...SYSTEM_TASK_NAMES]
  );
  for (const t of tasks) {
    const name = t.task_name ? `"${t.task_name}"` : `#${t.task_id}`;
    if (!TASK_JOB_TYPES.includes(String(t.task_job_type ?? ""))) return `Task ${name} needs its job type (Repair or Maintenance).`;
    if (!normaliseBusSystem(t.task_category)) return `Task ${name} needs its category (bus system).`;
    if (!t.task_desc || !String(t.task_desc).trim()) return `Task ${name} needs the work done filled in.`;
    if (!Number(t.part_count) && !Number(t.task_no_parts)) {
      return `Task ${name} needs its parts used, or "No parts used" ticked.`;
    }
    if (!Number(t.photo_count)) return `Task ${name} needs at least one completion photo.`;
  }
  return null;
}

// ===================== JOB HISTORY =====================

async function listJobHistory(conn, auth, jobId) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT h.* FROM JOB_HISTORY h WHERE h.job_id=? ORDER BY h.jobhistory_changed_at DESC, h.jobhistory_id DESC`,
    [jobId]
  );
  return json(200, rows);
}

async function addJobHistory(conn, auth, jobId, b) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const lock = await assertTechJobUnlocked(conn, auth, jobId);
  if (lock) return lock;

  if (!b.jobhistory_action) throw new Error("jobhistory_action is required");
  const userId = await getOrCreateUserId(conn, auth);

  await conn.execute(
    `INSERT INTO JOB_HISTORY (job_id, jobhistory_from_status, jobhistory_to_status, jobhistory_action, jobhistory_notes, jobhistory_user_id, jobhistory_changed_at)
     VALUES (?,?,?,?,?,?,NOW())`,
    [jobId, b.jobhistory_from_status ?? null, b.jobhistory_to_status ?? null, b.jobhistory_action, b.jobhistory_notes ?? null, userId]
  );
  return json(200, { success: true });
}

// ===================== JOB TASKS =====================

async function listJobTasks(conn, auth, jobId) {
  const deny = requireRole(auth, ["admin", "technician", "fleet_manager", "rm_manager"]);
  if (deny) return deny;

  const [rows] = await conn.execute(`SELECT * FROM JOB_TASK WHERE job_id=? ORDER BY task_order`, [jobId]);
  return json(200, rows);
}

async function createJobTask(conn, auth, jobId, b) {
  const deny = requireRole(auth, ["admin", "technician"]);
  if (deny) return deny;

  const lock = await assertTechJobUnlocked(conn, auth, jobId);
  if (lock) return lock;

  // Job type and category (bus system) are required: they group the job in
  // Performance & KPIs and head the task on the Job Completion Report.
  const jobType = String(b.task_job_type ?? "").trim().toLowerCase();
  if (!TASK_JOB_TYPES.includes(jobType)) {
    return json(400, { code: "JOB_TYPE_REQUIRED", message: "Please choose the job type (Repair or Maintenance)" });
  }
  const category = normaliseBusSystem(b.task_category);
  if (!category) {
    return json(400, { code: "CATEGORY_REQUIRED", message: "Please choose the category (bus system)" });
  }

  // A repair names the issue found. A maintenance task has no issue, so it is
  // named after its category.
  let taskName = b.task_name != null ? String(b.task_name).trim() : "";
  if (!taskName && jobType === "maintenance") taskName = `Maintenance · ${BUS_SYSTEM_BY_KEY.get(category).name}`;
  if (!taskName) return json(400, { code: "ISSUE_REQUIRED", message: "Please describe the issue found" });

  const taskDesc = b.task_desc != null && String(b.task_desc).trim() ? String(b.task_desc).trim() : null;
  // "Work done" is part of the record every task needs (it is printed on the
  // Job Completion Report), so a task can't be saved without it.
  if (!taskDesc) {
    return json(400, { code: "WORK_DONE_REQUIRED", message: "Please describe the work done for this task" });
  }
  const taskRemark = b.task_remark != null && String(b.task_remark).trim() ? String(b.task_remark).trim() : null;
  const noParts = b.task_no_parts === true || b.task_no_parts === 1 || b.task_no_parts === "1" ? 1 : 0;

  // Two maintenance tasks on the same system get the same name, and JOB_TASK
  // may have a unique key on (job_id, task_name). Number repeats instead of
  // failing: "Maintenance · Steering System (2)".
  const [same] = await conn.execute(
    "SELECT task_name FROM JOB_TASK WHERE job_id=? AND (task_name=? OR task_name LIKE ?)",
    [jobId, taskName, `${taskName} (%)`]
  );
  if (same.length) {
    const used = new Set(same.map((r) => r.task_name));
    let n = 2;
    while (used.has(`${taskName} (${n})`)) n++;
    taskName = `${taskName} (${n})`;
  }

  const taskStatus = b.task_status ?? "pending";
  const [res] = await conn.execute(
    `INSERT INTO JOB_TASK (job_id, task_name, task_desc, task_remark, task_no_parts, task_job_type, task_category,
                           task_status, task_order, completed_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
    [jobId, taskName, taskDesc, taskRemark, noParts, jobType, category, taskStatus, b.task_order ?? 1]
  );

  if (taskStatus === "done") {
    const technicianName = await getDisplayName(conn, auth);
    await notifyUsersByRole(conn, {
      roles: ["admin", "rm_manager", "fleet_manager"],
      projectId: await projectIdForJob(conn, jobId),
      excludeUserId: await getOrCreateUserId(conn, auth),
      type: "job_progress",
      title: "Job progress update",
      body: `${technicianName} completed a task on Job #${jobId}: ${taskName}.`,
      jobId,
    });
  }

  return json(200, { task_id: res.insertId });
}

async function updateJobTask(conn, auth, taskId, b) {
  const deny = requireRole(auth, ["admin", "technician"]);
  if (deny) return deny;

  const lock = await assertTechTaskUnlocked(conn, auth, taskId);
  if (lock) return lock;

  const updates = [];
  const vals = [];

  if (b.task_status != null)    { updates.push("task_status=?"); vals.push(b.task_status); }
  if (b.task_desc !== undefined) { updates.push("task_desc=?");   vals.push(b.task_desc ?? null); }
  if (b.task_remark !== undefined) {
    updates.push("task_remark=?");
    vals.push(b.task_remark != null && String(b.task_remark).trim() ? String(b.task_remark).trim() : null);
  }
  if (b.task_no_parts !== undefined) {
    updates.push("task_no_parts=?");
    vals.push(b.task_no_parts === true || b.task_no_parts === 1 || b.task_no_parts === "1" ? 1 : 0);
  }
  if (b.task_order != null)     { updates.push("task_order=?");  vals.push(Number(b.task_order)); }

  if (!updates.length) return json(200, { success: true });

  vals.push(taskId);
  await conn.execute(`UPDATE JOB_TASK SET ${updates.join(", ")} WHERE task_id=?`, vals);
  return json(200, { success: true });
}

// ===================== TASK PARTS =====================

async function listTaskParts(conn, auth, taskId) {
  const deny = requireRole(auth, ["admin", "inventory_manager", "technician", "fleet_manager", "rm_manager"]);
  if (deny) return deny;

  // Read-only, so no assertTechTaskUnlocked: that gate is for changing a job,
  // and it refuses other technicians' jobs (the "Assigned" tab) and completed
  // ones, which left their parts lists blank.

  const [rows] = await conn.execute(
    `SELECT tp.task_id, tp.part_id, tp.qty, tp.line_cost, p.part_name, p.part_code, p.part_brand, p.part_unit, p.part_cost, p.part_stock
     FROM JOB_TASK_PART tp JOIN PART p ON p.part_id = tp.part_id
     WHERE tp.task_id=? ORDER BY p.part_name ASC, p.part_code ASC`,
    [taskId]
  );
  return json(200, rows);
}

async function addTaskPart(conn, auth, taskId, b) {
  const deny = requireRole(auth, ["admin", "inventory_manager", "technician"]);
  if (deny) return deny;

  const lock = await assertTechTaskUnlocked(conn, auth, taskId);
  if (lock) return lock;

  const partId = toId(b.part_id, "part_id");
  const [pRows] = await conn.execute(`SELECT part_cost, part_unit FROM PART WHERE part_id=? LIMIT 1`, [partId]);
  if (!pRows.length) return json(404, { message: "Part not found" });
  const partUnit = pRows[0].part_unit || "pc";
  const qty = parsePartQty(b.qty ?? b.jp_qty ?? 1, partUnit);
  if (qty == null) {
    return json(400, {
      message: partUnit === "pc" || partUnit === "set"
        ? "Quantity must be a whole number greater than 0"
        : "Quantity must be greater than 0",
    });
  }

  let lineCost = null;
  if (b.line_cost != null || b.jp_linecost != null) {
    const lc = Number(b.line_cost ?? b.jp_linecost);
    if (!Number.isFinite(lc)) throw new Error("Invalid line_cost");
    lineCost = lc;
  } else {
    const unitCost = Number(pRows[0].part_cost);
    if (pRows[0].part_cost != null && Number.isFinite(unitCost)) lineCost = Math.round(unitCost * qty * 100) / 100;
  }

  await conn.execute(
    `INSERT INTO JOB_TASK_PART (task_id, part_id, qty, line_cost) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty), line_cost = COALESCE(line_cost, 0) + COALESCE(VALUES(line_cost), 0)`,
    [taskId, partId, qty, lineCost]
  );
  return json(200, { success: true });
}

// ===================== JOB ORDERS =====================
//
// A job order is work a technician logs directly for any bus (servicing, a
// follow-up repair) with no breakdown report and no approval step. It is
// stored as a REPORT of type 'job_order' plus its JOB, so every list, the
// KPIs, the bus history and the Job Completion Report treat it like any other
// job without a second set of tables.
//
// POST /job-orders creates both rows, already approved, accepted by the caller
// and with the odometer recorded. The report starts as a draft (invisible to
// every list) and the app then adds tasks, parts and photos through the
// normal job endpoints and closes the job, which closes the report too. If the
// app dies part-way, the unfinished job order waits in the technician's My
// Jobs, where it can be finished like any other job.

const JOB_ORDER_TYPE = "job_order";

async function createJobOrder(conn, auth, b) {
  const deny = requireRole(auth, ["admin", "technician"]);
  if (deny) return deny;

  const userId = await getOrCreateUserId(conn, auth);
  const busId = b?.bus_id != null ? String(b.bus_id).trim() : "";
  if (!busId) return json(400, { message: "Please choose a bus" });

  const [busRows] = await conn.execute("SELECT bus_id, project_id FROM BUS WHERE bus_id=? LIMIT 1", [busId]);
  if (!busRows.length) return json(404, { message: "Bus not found" });
  const projectId = busRows[0].project_id;

  if (auth.role !== "admin") {
    const [chk] = await conn.execute(
      "SELECT 1 FROM USER_PROJECT WHERE user_id=? AND project_id=? LIMIT 1",
      [userId, projectId]
    );
    if (!chk.length) return json(403, { message: "This bus is not in one of your projects" });
  }

  // The job order is filed under its first task's category.
  const issueType = normaliseBusSystem(b?.category ?? b?.issue_type);
  if (!issueType) return json(400, { message: "Please choose the category (bus system)" });

  // A maintenance job order has no issue text: name it after its category.
  const desc = String(b?.description ?? "").trim() || `Maintenance · ${BUS_SYSTEM_BY_KEY.get(issueType).name}`;

  const odo = toWholeNumber(b?.odometer, "odometer");
  const reviewer = await getDisplayName(conn, auth);

  let reportId;
  let jobId;
  await conn.beginTransaction();
  try {
    const [jobRes] = await conn.execute(
      `INSERT INTO JOB (job_desc, job_status, job_created_at, technician_user_id, job_accepted_at,
                        job_arrived_at, job_odometer, job_updated_at)
       VALUES (?, 'open', NOW(), ?, NOW(), NOW(), ?, NOW())`,
      [desc, userId, odo]
    );
    jobId = Number(jobRes.insertId);

    const [repRes] = await conn.execute(
      `INSERT INTO REPORT
       (project_id, report_type, report_issue_type, report_desc, report_location, report_lat, report_lng,
        report_priority, report_status, user_id, bus_id, job_id, report_uploaded_at,
        report_review_action, report_review_by, report_review_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'low', ?, ?, ?, ?, NOW(), 'approved', ?, NOW())`,
      [
        projectId, JOB_ORDER_TYPE, issueType, desc,
        b?.location ?? null, b?.lat ?? null, b?.lng ?? null,
        REPORT_STATUS_DRAFT, userId, busId, jobId, reviewer,
      ]
    );
    reportId = Number(repRes.insertId);

    await upsertOdometerRecordedTask(conn, jobId);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }

  return json(200, { success: true, report_id: reportId, job_id: jobId });
}

// ===================== JOB COMPLETION REPORT (PDF) =====================
//
// Spec: "SKSC Job Completion Report Template Spec v1.1". The PDF itself is
// rendered by the separate sksbus-pdf-renderer Lambda (headless Chrome,
// outside the VPC; see lambda/pdf-renderer). This side does what needs the
// database: it fixes the reference number, gathers every field the template
// prints, and drops the lot into pdf-queue/ in S3, whose upload event starts
// the renderer. The finished file lands under reports-pdf/.

const PDF_QUEUE_PREFIX = "pdf-queue/";
const PDF_OUT_PREFIX = "reports-pdf/";
// Malaysia time, which every date on the report is printed in.
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
// A queued PDF that hasn't appeared after this long is queued again.
const PDF_REQUEUE_AFTER_MS = 2 * 60 * 1000;

function mytDateParts(d) {
  const t = new Date(new Date(d).getTime() + MYT_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return { y, m, day, startUtc: new Date(Date.UTC(y, t.getUTCMonth(), t.getUTCDate()) - MYT_OFFSET_MS) };
}

// SKSC-JCR-YYYY-MM-DD-XX: the MYT date the problem was first reported, then
// this report's place among the reports submitted that day (01, 02 ...).
// Fixed once given, so a reprint carries the same number.
async function ensureJobRefNo(conn, jobId) {
  const [rows] = await conn.execute(
    `SELECT j.job_ref_no, j.job_created_at, r.report_id, r.report_uploaded_at
     FROM JOB j LEFT JOIN REPORT r ON r.job_id = j.job_id
     WHERE j.job_id=? LIMIT 1`,
    [jobId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  if (row.job_ref_no) return row.job_ref_no;

  const reportedAt = row.report_uploaded_at ?? row.job_created_at ?? new Date();
  const { y, m, day, startUtc } = mytDateParts(reportedAt);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  let position = 1;
  if (row.report_id != null) {
    const [cnt] = await conn.execute(
      `SELECT COUNT(*) AS n FROM REPORT
       WHERE report_uploaded_at >= ? AND report_uploaded_at < ?
         AND LOWER(TRIM(COALESCE(report_status,''))) <> ?
         AND (report_uploaded_at < ? OR (report_uploaded_at = ? AND report_id <= ?))`,
      [startUtc, endUtc, REPORT_STATUS_DRAFT, reportedAt, reportedAt, row.report_id]
    );
    position = Math.max(1, Number(cnt[0]?.n ?? 1));
  }

  // The position is unique per report, but a number already handed out (a
  // report later reverted to draft, say) must never be reused, so step on to
  // the next free one rather than fail.
  for (let n = position; n < position + 99; n++) {
    const ref = `SKSC-JCR-${y}-${m}-${day}-${String(n).padStart(2, "0")}`;
    try {
      const [res] = await conn.execute(
        "UPDATE JOB SET job_ref_no=? WHERE job_id=? AND job_ref_no IS NULL",
        [ref, jobId]
      );
      if (res.affectedRows) return ref;
      const [again] = await conn.execute("SELECT job_ref_no FROM JOB WHERE job_id=?", [jobId]);
      return again[0]?.job_ref_no ?? null;
    } catch (e) {
      if (e?.code !== "ER_DUP_ENTRY") throw e;
    }
  }
  throw new Error("Could not assign a reference number");
}

function safeFilePart(s) {
  return String(s ?? "").replace(/[^A-Za-z0-9_-]+/g, "");
}

function jobPdfKey(refNo, plate) {
  return `${PDF_OUT_PREFIX}jobs/${refNo}_${safeFilePart(plate) || "BUS"}.pdf`;
}

async function putQueueFile(key, body) {
  const client = await s3QueueClient();
  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: "application/json",
      Body: JSON.stringify(body),
    })
  );
}

async function s3ObjectExists(key) {
  try {
    const client = await s3QueueClient();
    await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch (e) {
    const status = e?.$metadata?.httpStatusCode;
    // Without s3:ListBucket, S3 answers a missing file with 403, not 404.
    if (status === 404 || status === 403 || e?.name === "NotFound" || e?.name === "NoSuchKey") return false;
    throw e;
  }
}

function roleLabel(role) {
  const r = String(role ?? "").trim().toLowerCase();
  return {
    admin: "Admin",
    fleet_manager: "Fleet Manager",
    rm_manager: "R&M Manager",
    technician: "Technician",
    inventory_manager: "Inventory Manager",
    driver: "Driver",
  }[r] ?? null;
}

// Everything the Job Completion Report prints, in one object. The renderer
// has no database access, so nothing may be left for it to look up.
async function buildJobReportData(conn, jobId) {
  const [jRows] = await conn.execute(
    `SELECT j.*, r.report_id, r.report_type, r.report_issue_type, r.report_desc, r.report_location,
            r.report_priority, r.report_uploaded_at, r.report_verified_name, r.report_review_by,
            r.report_review_at, r.report_review_verified_name, r.bus_id, r.project_id,
            reporter.user_name AS reporter_username, reporter.user_role AS reporter_role,
            tech.user_name AS technician_username,
            b.bus_ev_no, b.bus_model
     FROM JOB j
     LEFT JOIN REPORT r ON r.job_id = j.job_id
     LEFT JOIN \`USER\` reporter ON reporter.user_id = r.user_id
     LEFT JOIN \`USER\` tech ON tech.user_id = j.technician_user_id
     LEFT JOIN BUS b ON b.bus_id = r.bus_id
     WHERE j.job_id=? LIMIT 1`,
    [jobId]
  );
  if (!jRows.length) return null;
  const j = jRows[0];
  const isJobOrder = j.report_type === JOB_ORDER_TYPE;

  const [tasks] = await conn.execute(
    `SELECT task_id, task_name, task_desc, task_remark, task_job_type, task_category,
            task_status, task_order, completed_at, created_at
     FROM JOB_TASK WHERE job_id=? AND task_name NOT IN (?, ?)
     ORDER BY task_order, task_id`,
    [jobId, ...SYSTEM_TASK_NAMES]
  );

  const [parts] = await conn.execute(
    `SELECT tp.task_id, tp.qty, p.part_code, p.part_name, p.part_unit
     FROM JOB_TASK_PART tp JOIN JOB_TASK t ON t.task_id = tp.task_id JOIN PART p ON p.part_id = tp.part_id
     WHERE t.job_id=? ORDER BY p.part_name`,
    [jobId]
  );

  const [jobMedia] = await conn.execute(
    `SELECT task_id, s3_bucket, s3_key, uploaded_at FROM JOB_MEDIA
     WHERE job_id=? AND media_type='image' ORDER BY uploaded_at, media_id`,
    [jobId]
  );

  let reportMedia = [];
  if (j.report_id != null) {
    const [rm] = await conn.execute(
      `SELECT s3_bucket, s3_key, uploaded_at FROM REPORT_MEDIA
       WHERE report_id=? AND media_type='image' ORDER BY uploaded_at, media_id`,
      [j.report_id]
    );
    reportMedia = rm;
  }

  const photo = (m) => ({ bucket: m.s3_bucket || S3_BUCKET, key: m.s3_key, at: m.uploaded_at });
  const afterPhotos = jobMedia.filter((m) => m.task_id == null).map(photo);
  const taskIds = new Set(tasks.map((t) => Number(t.task_id)));

  const technician = j.technician_username ?? null;

  // The event log, in the order the spec lists it. Who: the typed sign-off
  // name where one was captured, otherwise the username.
  const events = [];
  if (!isJobOrder) {
    events.push({ text: "Report submitted", by: j.report_verified_name || j.reporter_username, at: j.report_uploaded_at });
    events.push({ text: "Job approved & distributed", by: j.report_review_verified_name || j.report_review_by, at: j.job_created_at ?? j.report_review_at });
    if (j.job_accepted_at) events.push({ text: "Job accepted", by: j.job_accept_verified_name || technician, at: j.job_accepted_at });
  } else {
    events.push({ text: "Job order opened", by: technician, at: j.job_created_at });
  }
  if (j.job_arrived_at || j.job_odometer != null) {
    events.push({
      text: "Technician on site",
      odometer: j.job_odometer,
      by: technician,
      at: j.job_arrived_at ?? null,
    });
  }
  tasks.forEach((t, i) => {
    if (t.completed_at) events.push({ text: `Task ${i + 1} completed`, by: technician, at: t.completed_at });
  });
  if (afterPhotos.length) {
    events.push({ text: "After-repair photos taken", by: technician, at: afterPhotos[afterPhotos.length - 1].at });
  }
  if (j.job_completed_at) {
    events.push({ text: "Job completed", by: j.job_verified_name || technician, at: j.job_completed_at });
  }

  return {
    kind: "job",
    job_id: Number(jobId),
    report_id: j.report_id != null ? Number(j.report_id) : null,
    is_job_order: isJobOrder,
    ref_no: j.job_ref_no,
    issued_at: j.job_report_issued_at ?? new Date(),
    status: JOB_DONE_STATUSES.includes(j.job_status) ? "CLOSED" : String(j.job_status ?? "").toUpperCase(),
    priority: isJobOrder ? null : (j.report_priority ? String(j.report_priority).toUpperCase() : null),
    vehicle: { plate: j.bus_id, fleet_no: j.bus_ev_no, model: j.bus_model },
    odometer: j.job_odometer,
    location: j.report_location,
    reported_by: isJobOrder ? technician : j.reporter_username,
    reporter_name: isJobOrder ? technician : (j.report_verified_name || j.reporter_username),
    reporter_role: isJobOrder ? "Technician" : roleLabel(j.reporter_role),
    approved_by: isJobOrder ? null : j.report_review_by,
    technician,
    report_date: isJobOrder ? j.job_created_at : j.report_uploaded_at,
    approved_at: isJobOrder ? null : (j.job_created_at ?? j.report_review_at),
    accepted_at: isJobOrder ? null : j.job_accepted_at,
    arrived_at: j.job_arrived_at,
    completed_at: j.job_completed_at,
    issue: j.report_desc,
    issue_type: j.report_issue_type,
    category: busSystemInfo(j.report_issue_type),
    report_photos: reportMedia.map(photo),
    tasks: tasks.map((t, i) => ({
      no: i + 1,
      name: t.task_name,
      job_type: TASK_JOB_TYPES.includes(String(t.task_job_type ?? "")) ? t.task_job_type : null,
      category: busSystemInfo(t.task_category),
      work_done: t.task_desc,
      remark: t.task_remark,
      status: String(t.task_status ?? "").toLowerCase() === "done" ? "DONE" : String(t.task_status ?? "").toUpperCase(),
      completed_at: t.completed_at,
      parts: parts
        .filter((p) => Number(p.task_id) === Number(t.task_id))
        .map((p) => ({ code: p.part_code, name: p.part_name, qty: Number(p.qty), unit: p.part_unit || "pc" })),
      photos: jobMedia.filter((m) => Number(m.task_id) === Number(t.task_id)).map(photo),
    })),
    // Photos attached to a task not shown on the report (the odometer task)
    // are not lost: they go with the after-repair group.
    after_photos: [
      ...afterPhotos,
      ...jobMedia.filter((m) => m.task_id != null && !taskIds.has(Number(m.task_id))).map(photo),
    ],
    events,
  };
}

async function queueJobReportPdf(conn, jobId) {
  const data = await buildJobReportData(conn, jobId);
  if (!data || !data.ref_no) return null;
  const outKey = jobPdfKey(data.ref_no, data.vehicle.plate);
  const issuedAt = data.issued_at instanceof Date ? data.issued_at : new Date(data.issued_at);

  await putQueueFile(`${PDF_QUEUE_PREFIX}job-${jobId}-${Date.now()}.json`, {
    ...data,
    issued_at: issuedAt,
    out_bucket: S3_BUCKET,
    out_key: outKey,
  });
  await conn.execute(
    `UPDATE JOB SET job_report_pdf_s3_key=?, job_report_issued_at=COALESCE(job_report_issued_at, ?)
     WHERE job_id=?`,
    [outKey, issuedAt, jobId]
  );
  console.log("[PDF] queued", { jobId, outKey });
  return outKey;
}

async function assertCanSeeJob(conn, auth, jobId) {
  const [rows] = await conn.execute(
    `SELECT j.job_status, j.job_ref_no, j.job_report_pdf_s3_key, j.job_report_issued_at, j.job_updated_at,
            r.project_id, r.bus_id
     FROM JOB j LEFT JOIN REPORT r ON r.job_id = j.job_id WHERE j.job_id=? LIMIT 1`,
    [jobId]
  );
  if (!rows.length) return { error: json(404, { message: "Job not found" }) };
  if (auth.role !== "admin") {
    const userId = await getOrCreateUserId(conn, auth);
    const [chk] = await conn.execute(
      "SELECT 1 FROM USER_PROJECT WHERE user_id=? AND project_id=? LIMIT 1",
      [userId, rows[0].project_id]
    );
    if (!chk.length) return { error: json(403, { message: "Forbidden" }) };
  }
  return { job: rows[0] };
}

// GET /jobs/{id}/report-pdf: the Job Completion Report, once it exists.
// Returns "pending" while the renderer works; queues it if it was never made
// (jobs closed before this feature, or a queue write that failed at close).
async function getJobReportPdf(conn, auth, jobId) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const { job, error } = await assertCanSeeJob(conn, auth, jobId);
  if (error) return error;
  if (!JOB_DONE_STATUSES.includes(job.job_status)) {
    return json(409, { code: "JOB_NOT_CLOSED", message: "The report is available once the job is completed." });
  }

  const refNo = job.job_ref_no || (await ensureJobRefNo(conn, jobId));
  const key = job.job_report_pdf_s3_key || jobPdfKey(refNo, job.bus_id);
  const filename = key.split("/").pop();

  if (await s3ObjectExists(key)) {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
        ResponseContentType: "application/pdf",
      }),
      { expiresIn: VIEW_URL_TTL_S }
    );
    return json(200, { status: "ready", url, filename, ref_no: refNo });
  }

  // Not there yet. Queue it, unless this instance queued it moments ago.
  const lastQueue = _pdfQueuedAt.get(Number(jobId)) ?? 0;
  if (Date.now() - lastQueue > PDF_REQUEUE_AFTER_MS) {
    await queueJobReportPdf(conn, jobId);
    _pdfQueuedAt.set(Number(jobId), Date.now());
  }
  return json(200, { status: "pending", filename, ref_no: refNo });
}

// The app polls every couple of seconds while a PDF renders. One Lambda
// instance usually serves those polls, so a small in-memory note of when each
// job was last queued stops every poll from queuing another render.
const _pdfQueuedAt = new Map();

// ===================== PERFORMANCE & KPIs =====================

const KPI_ROLES = ["admin", "rm_manager", "fleet_manager"];
const DAY_MS = 24 * 60 * 60 * 1000;

function parseKpiRange(qs) {
  const to = qs?.to ? new Date(String(qs.to)) : new Date();
  const from = qs?.from ? new Date(String(qs.from)) : new Date(to.getTime() - 30 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new Error("Invalid from/to");
  }
  return { from, to };
}

// Project scope for the KPI queries: the asked-for project, or (for anyone
// but admin) only the projects they belong to.
async function kpiScope(conn, auth, qs, alias = "r") {
  const where = [`LOWER(TRIM(COALESCE(${alias}.report_status,''))) <> ?`];
  const vals = [REPORT_STATUS_DRAFT];
  const projectId = qs?.project_id ? String(qs.project_id).trim() : null;
  if (projectId) { where.push(`${alias}.project_id=?`); vals.push(projectId); }
  if (auth.role !== "admin") {
    const userId = await getOrCreateUserId(conn, auth);
    where.push(`${alias}.project_id IN (SELECT project_id FROM USER_PROJECT WHERE user_id=?)`);
    vals.push(userId);
  }
  return { where, vals };
}

const KPI_ROW_SQL = `
  SELECT r.report_id, r.report_type, r.report_issue_type, r.report_desc, r.report_priority,
         r.report_status, r.report_uploaded_at, r.bus_id, r.project_id, r.job_id,
         j.job_status, j.job_created_at, j.job_accepted_at, j.job_arrived_at, j.job_completed_at,
         j.job_ref_no, tech.user_name AS technician_name, b.bus_ev_no, b.bus_model
  FROM REPORT r
  LEFT JOIN JOB j ON j.job_id = r.job_id
  LEFT JOIN \`USER\` tech ON tech.user_id = j.technician_user_id
  LEFT JOIN BUS b ON b.bus_id = r.bus_id`;

const ms = (a, b) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null);
const avg = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x) && x >= 0);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
};
const isDone = (row) => JOB_DONE_STATUSES.includes(row.job_status) && row.job_completed_at;
const isJobOrderRow = (row) => row.report_type === JOB_ORDER_TYPE;

// Time-to-fix figures for one job, in ms. Job orders have no waiting stages
// (they are logged after the work), so only turnaround-free fields apply.
function jobTimes(row, now = new Date()) {
  const jo = isJobOrderRow(row);
  const end = row.job_completed_at ?? null;
  return {
    turnaround: jo ? null : ms(row.report_uploaded_at, end),
    approval: jo ? null : ms(row.report_uploaded_at, row.job_created_at),
    accept: jo ? null : ms(row.job_created_at, row.job_accepted_at),
    travel: jo ? null : ms(row.job_accepted_at, row.job_arrived_at),
    repair: jo ? null : ms(row.job_arrived_at, end),
    // Downtime: from report until fixed (or until now while still open).
    downtime: jo || !row.job_id ? null : ms(row.report_uploaded_at, end ?? now),
  };
}

function kpiSummary(rows) {
  const times = rows.filter(isDone).map((r) => jobTimes(r));
  return {
    jobs_closed: rows.filter(isDone).length,
    avg_turnaround_ms: avg(times.map((t) => t.turnaround)),
    avg_approval_ms: avg(times.map((t) => t.approval)),
    avg_accept_ms: avg(times.map((t) => t.accept)),
    avg_travel_ms: avg(times.map((t) => t.travel)),
    avg_repair_ms: avg(times.map((t) => t.repair)),
  };
}

function bucketsFor(from, to) {
  const span = to.getTime() - from.getTime();
  // Up to ~10 days: per day. Up to ~2 months: per week. Longer: per month.
  const unit = span <= 10 * DAY_MS ? "day" : span <= 62 * DAY_MS ? "week" : "month";
  const out = [];
  let cur = new Date(from);
  while (cur < to) {
    let next;
    if (unit === "day") next = new Date(cur.getTime() + DAY_MS);
    else if (unit === "week") next = new Date(cur.getTime() + 7 * DAY_MS);
    else {
      const t = new Date(cur.getTime() + MYT_OFFSET_MS);
      next = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1) - MYT_OFFSET_MS);
    }
    if (next > to) next = new Date(to);
    out.push({ start: new Date(cur), end: next, opened: 0, closed: 0 });
    cur = next;
  }
  return { unit, buckets: out };
}

function inRange(d, from, to) {
  if (!d) return false;
  const t = new Date(d).getTime();
  return t >= from.getTime() && t < to.getTime();
}

function issueCounts(rows) {
  const counts = {};
  for (const r of rows) {
    const k = categoryOf(r.report_issue_type);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([issue_type, count]) => ({ issue_type, count, label: busSystemInfo(issue_type) }))
    .sort((a, b) => b.count - a.count);
}

// Every report in [from - span, to): this period plus the one before it, so
// "vs last period" comes from the same query.
async function loadKpiRows(conn, auth, qs, from, to, extraWhere = [], extraVals = []) {
  const { where, vals } = await kpiScope(conn, auth, qs);
  const span = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span);
  where.push("(r.report_uploaded_at >= ? OR j.job_completed_at >= ?)");
  vals.push(prevFrom, prevFrom);
  where.push("r.report_uploaded_at < ?");
  vals.push(to);
  const [rows] = await conn.execute(
    `${KPI_ROW_SQL} WHERE ${[...where, ...extraWhere].join(" AND ")} ORDER BY r.report_uploaded_at DESC, r.report_id DESC LIMIT 5000`,
    [...vals, ...extraVals]
  );
  return { rows, prevFrom };
}

function overviewFromRows(rows, from, to, prevFrom) {
  const closedNow = rows.filter((r) => isDone(r) && inRange(r.job_completed_at, from, to));
  const closedPrev = rows.filter((r) => isDone(r) && inRange(r.job_completed_at, prevFrom, from));
  // Jobs opened in the period: reports that became jobs (approved), plus job
  // orders. Declined or still-pending reports are not jobs.
  const openedNow = rows.filter((r) => r.job_id != null && inRange(r.report_uploaded_at, from, to));

  const now = kpiSummary(closedNow);
  const prev = kpiSummary(closedPrev);

  const { unit, buckets } = bucketsFor(from, to);
  for (const r of openedNow) {
    const b = buckets.find((x) => inRange(r.report_uploaded_at, x.start, x.end));
    if (b) b.opened += 1;
  }
  for (const r of closedNow) {
    const b = buckets.find((x) => inRange(r.job_completed_at, x.start, x.end));
    if (b) b.closed += 1;
  }

  const byBus = new Map();
  for (const r of openedNow) {
    const k = String(r.bus_id);
    const e = byBus.get(k) ?? { bus_id: r.bus_id, bus_ev_no: r.bus_ev_no, jobs: 0 };
    e.jobs += 1;
    byBus.set(k, e);
  }

  return {
    from, to,
    ...now,
    prev_jobs_closed: prev.jobs_closed,
    prev_avg_turnaround_ms: prev.avg_turnaround_ms,
    jobs_opened: openedNow.length,
    bucket_unit: unit,
    buckets: buckets.map((b) => ({ start: b.start, end: b.end, opened: b.opened, closed: b.closed })),
    issues: issueCounts(openedNow),
    top_buses: [...byBus.values()].sort((a, b) => b.jobs - a.jobs).slice(0, 5),
  };
}

async function getKpiOverview(conn, auth, qs) {
  const deny = requireRole(auth, KPI_ROLES);
  if (deny) return deny;
  const { from, to } = parseKpiRange(qs);
  const { rows, prevFrom } = await loadKpiRows(conn, auth, qs, from, to);
  return json(200, overviewFromRows(rows, from, to, prevFrom));
}

async function getKpiBuses(conn, auth, qs) {
  const deny = requireRole(auth, KPI_ROLES);
  if (deny) return deny;
  const { from, to } = parseKpiRange(qs);
  const { rows } = await loadKpiRows(conn, auth, qs, from, to);
  // Optional: only jobs of one issue type (Overview's "Common issues" tap).
  const onlyIssue = qs?.issue_type
    ? (normaliseBusSystem(qs.issue_type) ?? (String(qs.issue_type) === UNCATEGORISED ? UNCATEGORISED : "__none__"))
    : null;

  const byBus = new Map();
  for (const r of rows) {
    if (r.job_id == null || !inRange(r.report_uploaded_at, from, to)) continue;
    if (onlyIssue && categoryOf(r.report_issue_type) !== onlyIssue) continue;
    const k = String(r.bus_id);
    const e = byBus.get(k) ?? {
      bus_id: r.bus_id, bus_ev_no: r.bus_ev_no, bus_model: r.bus_model,
      jobs: 0, downtime_ms: 0, last_issue: null, last_report_at: null,
    };
    e.jobs += 1;
    e.downtime_ms += jobTimes(r, to < new Date() ? to : new Date()).downtime ?? 0;
    if (!e.last_report_at || new Date(r.report_uploaded_at) > new Date(e.last_report_at)) {
      e.last_report_at = r.report_uploaded_at;
      e.last_issue = r.report_desc;
    }
    byBus.set(k, e);
  }
  const buses = [...byBus.values()].sort((a, b) => b.jobs - a.jobs || b.downtime_ms - a.downtime_ms);
  return json(200, { from, to, buses, total_jobs: buses.reduce((s, b) => s + b.jobs, 0) });
}

async function loadBusHistory(conn, auth, qs, busId, from, to) {
  const [busRows] = await conn.execute(
    "SELECT bus_id, bus_ev_no, bus_model, bus_route, bus_route_number, project_id FROM BUS WHERE bus_id=? LIMIT 1",
    [busId]
  );
  if (!busRows.length) return { error: json(404, { message: "Bus not found" }) };
  const bus = busRows[0];

  const { where, vals } = await kpiScope(conn, auth, { ...qs, project_id: bus.project_id });
  const [allTime] = await conn.execute(
    `SELECT COUNT(*) AS n FROM REPORT r WHERE ${where.join(" AND ")} AND r.bus_id=?`,
    [...vals, busId]
  );
  const [rows] = await conn.execute(
    `${KPI_ROW_SQL} WHERE ${where.join(" AND ")} AND r.bus_id=? AND r.report_uploaded_at >= ? AND r.report_uploaded_at < ?
     ORDER BY r.report_uploaded_at DESC, r.report_id DESC LIMIT 1000`,
    [...vals, busId, from, to]
  );
  const [odo] = await conn.execute(
    `SELECT j.job_odometer FROM JOB j JOIN REPORT r ON r.job_id = j.job_id
     WHERE r.bus_id=? AND j.job_odometer IS NOT NULL ORDER BY COALESCE(j.job_arrived_at, j.job_created_at) DESC LIMIT 1`,
    [busId]
  );
  return { bus, rows, reportsAllTime: Number(allTime[0]?.n ?? 0), latestOdometer: odo[0]?.job_odometer ?? null };
}

function busHistoryRow(r) {
  const t = jobTimes(r);
  return {
    report_id: r.report_id,
    job_id: r.job_id,
    job_ref_no: r.job_ref_no,
    report_type: r.report_type,
    issue_type: categoryOf(r.report_issue_type),
    issue_label: busSystemInfo(r.report_issue_type),
    issue: r.report_desc,
    priority: r.report_priority,
    status: String(r.report_status ?? "").toLowerCase() || "submitted",
    reported_at: r.report_uploaded_at,
    completed_at: r.job_completed_at,
    technician_name: r.technician_name,
    turnaround_ms: t.turnaround,
  };
}

async function getKpiBus(conn, auth, busId, qs) {
  const deny = requireRole(auth, KPI_ROLES);
  if (deny) return deny;
  const { from, to } = parseKpiRange(qs);
  const res = await loadBusHistory(conn, auth, qs, busId, from, to);
  if (res.error) return res.error;
  const { bus, rows, reportsAllTime, latestOdometer } = res;

  const jobs = rows.filter((r) => r.job_id != null);
  const now = new Date();
  return json(200, {
    from, to,
    bus: { ...bus, latest_odometer: latestOdometer, reports_all_time: reportsAllTime },
    jobs: jobs.length,
    downtime_ms: jobs.reduce((s, r) => s + (jobTimes(r, to < now ? to : now).downtime ?? 0), 0),
    avg_turnaround_ms: kpiSummary(jobs).avg_turnaround_ms,
    issues: issueCounts(jobs),
    reports: rows.map(busHistoryRow),
  });
}

// ===================== EXPORTS (PDF) =====================
//
// POST /exports queues a fleet report: "range" (breakdowns between two dates,
// optionally for some buses or one status) or "bus" (one bus's full history).
// The data is gathered here and rendered by the same sksbus-pdf-renderer as
// the Job Completion Report. GET /exports/{id} reports when the file is ready.

const EXPORT_MAX_ROWS = 1000;

async function tasksForJobs(conn, jobIds) {
  if (!jobIds.length) return { tasks: [], parts: [] };
  const ph = jobIds.map(() => "?").join(",");
  const [tasks] = await conn.execute(
    `SELECT task_id, job_id, task_name, task_desc, task_remark, task_job_type, task_category FROM JOB_TASK
     WHERE job_id IN (${ph}) AND task_name NOT IN (?, ?) ORDER BY job_id, task_order, task_id`,
    [...jobIds, ...SYSTEM_TASK_NAMES]
  );
  const [parts] = await conn.execute(
    `SELECT t.job_id, tp.qty, p.part_code, p.part_name, p.part_unit
     FROM JOB_TASK_PART tp JOIN JOB_TASK t ON t.task_id = tp.task_id JOIN PART p ON p.part_id = tp.part_id
     WHERE t.job_id IN (${ph})`,
    jobIds
  );
  return { tasks, parts };
}

function exportRow(r, tasks, parts) {
  const jobTasks = tasks.filter((t) => Number(t.job_id) === Number(r.job_id));
  return {
    ...busHistoryRow(r),
    bus_id: r.bus_id,
    bus_ev_no: r.bus_ev_no,
    work_done: jobTasks.map((t) => ({
      issue_found: t.task_name,
      job_type: t.task_job_type,
      category: busSystemInfo(t.task_category),
      work_done: t.task_desc,
      remark: t.task_remark,
    })),
    parts: parts
      .filter((p) => Number(p.job_id) === Number(r.job_id))
      .map((p) => ({ code: p.part_code, name: p.part_name, qty: Number(p.qty), unit: p.part_unit || "pc" })),
  };
}

async function createExport(conn, auth, b) {
  const deny = requireRole(auth, KPI_ROLES);
  if (deny) return deny;

  const kind = String(b?.kind ?? "");
  if (kind !== "range" && kind !== "bus") return json(400, { message: "kind must be 'range' or 'bus'" });

  const exportId = crypto.randomUUID();
  const generatedBy = await getDisplayName(conn, auth);
  let payload;
  let filename;

  if (kind === "range") {
    const { from, to } = parseKpiRange(b);
    const busIds = Array.isArray(b?.bus_ids) ? b.bus_ids.map((x) => String(x).trim()).filter(Boolean) : [];
    const status = ["open", "closed"].includes(String(b?.status)) ? String(b.status) : "all";

    const extra = [];
    const extraVals = [];
    if (busIds.length) { extra.push(`r.bus_id IN (${busIds.map(() => "?").join(",")})`); extraVals.push(...busIds); }
    const { rows, prevFrom } = await loadKpiRows(conn, auth, b, from, to, extra, extraVals);
    let inPeriod = rows.filter((r) => inRange(r.report_uploaded_at, from, to));
    if (status === "closed") inPeriod = inPeriod.filter(isDone);
    if (status === "open") inPeriod = inPeriod.filter((r) => !isDone(r));
    inPeriod.sort((a, x) => new Date(a.report_uploaded_at) - new Date(x.report_uploaded_at) || a.report_id - x.report_id);
    const truncated = inPeriod.length > EXPORT_MAX_ROWS;
    inPeriod = inPeriod.slice(0, EXPORT_MAX_ROWS);

    const { tasks, parts } = await tasksForJobs(conn, inPeriod.map((r) => r.job_id).filter((x) => x != null));
    const fromP = mytDateParts(from);
    const toP = mytDateParts(new Date(to.getTime() - 1));
    filename = `SKSC-Breakdowns_${fromP.y}-${fromP.m}-${fromP.day}_to_${toP.y}-${toP.m}-${toP.day}.pdf`;
    payload = {
      kind: "range",
      from, to, status,
      bus_ids: busIds,
      project_id: b?.project_id ?? null,
      overview: overviewFromRows(rows, from, to, prevFrom),
      rows: inPeriod.map((r) => exportRow(r, tasks, parts)),
      truncated,
    };
  } else {
    const busId = String(b?.bus_id ?? "").trim();
    if (!busId) return json(400, { message: "bus_id is required" });
    const to = b?.to ? new Date(String(b.to)) : new Date();
    const from = b?.from ? new Date(String(b.from)) : new Date("2000-01-01T00:00:00Z");
    const res = await loadBusHistory(conn, auth, b, busId, from, to);
    if (res.error) return res.error;
    const { bus, rows, reportsAllTime, latestOdometer } = res;
    const ordered = [...rows].sort((a, x) => new Date(a.report_uploaded_at) - new Date(x.report_uploaded_at));
    const jobs = ordered.filter((r) => r.job_id != null);
    const { tasks, parts } = await tasksForJobs(conn, jobs.map((r) => r.job_id));
    const now = new Date();
    filename = `SKSC-Bus-Report_${safeFilePart(bus.bus_id)}${bus.bus_ev_no ? `_${safeFilePart(bus.bus_ev_no)}` : ""}.pdf`;
    payload = {
      kind: "bus",
      from: b?.from ? from : null,
      to,
      bus: { ...bus, latest_odometer: latestOdometer, reports_all_time: reportsAllTime },
      jobs: jobs.length,
      downtime_ms: jobs.reduce((s, r) => s + (jobTimes(r, now).downtime ?? 0), 0),
      avg_turnaround_ms: kpiSummary(jobs).avg_turnaround_ms,
      issues: issueCounts(jobs),
      rows: ordered.slice(0, EXPORT_MAX_ROWS).map((r) => exportRow(r, tasks, parts)),
      truncated: ordered.length > EXPORT_MAX_ROWS,
    };
  }

  const outKey = `${PDF_OUT_PREFIX}exports/${exportId}.pdf`;
  await putQueueFile(`${PDF_QUEUE_PREFIX}export-${exportId}.json`, {
    ...payload,
    export_id: exportId,
    generated_by: generatedBy,
    generated_at: new Date(),
    out_bucket: S3_BUCKET,
    out_key: outKey,
    filename,
  });
  return json(200, { export_id: exportId, filename });
}

async function getExport(conn, auth, exportId, qs) {
  const deny = requireRole(auth, KPI_ROLES);
  if (deny) return deny;
  if (!/^[0-9a-f-]{36}$/i.test(String(exportId))) return json(400, { message: "Invalid export id" });

  const key = `${PDF_OUT_PREFIX}exports/${exportId}.pdf`;
  if (!(await s3ObjectExists(key))) return json(200, { status: "pending" });

  const filename = String(qs?.filename ?? "export.pdf").replace(/[^A-Za-z0-9_.-]+/g, "") || "export.pdf";
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
      ResponseContentType: "application/pdf",
    }),
    { expiresIn: VIEW_URL_TTL_S }
  );
  return json(200, { status: "ready", url, filename });
}

// ===================== TYRES =====================

const TYRE_AXLE_SIDES = ["left", "right"];
const TYRE_WHEEL_POSITIONS = ["single", "inner", "outer"];
// The verdicts deriveInspectionResult can produce, in ascending severity. No
// longer validated against a request: the technician stopped choosing this and
// the server now derives it from the readings.
const TYRE_INSPECTION_RESULTS = ["pass", "monitor", "reject"];
// Statuses a tyre may be moved to directly via PATCH/unmount — "mounted" is
// only ever set by swapTyre, so it's excluded here to keep TYRE_MOUNTING the
// single source of truth for "is this tyre currently on a bus".
const TYRE_MANUAL_STATUSES = ["spare", "rejected", "retreading", "retired"];
// 'retreading' is deliberately NOT here: a tyre sent away for retreading is
// expected to come back and go on a bus again, often in the same position it
// came off. Only scrapped tyres are permanently unmountable.
const TYRE_UNMOUNTABLE_STATUSES = ["rejected", "retired"];
// Any tyre whose most recently recorded groove reading is below this is
// surfaced by getLowTreadTyres() regardless of the technician's pass/monitor/
// reject call on that inspection — it's an independent safety threshold.
const TYRE_LOW_TREAD_THRESHOLD_MM = 5;

// One row per tyre: its most recent inspection, with that inspection's groove
// readings rolled up. Three call sites need this — the low-tread list, the
// nightly digest and the fleet summary — and the first two carried
// byte-identical copies of it.
//
// The inner pick uses the GROUP_CONCAT/SUBSTRING_INDEX argmax idiom rather than
// matching on "MAX(inspection_datetime) = inspection_datetime". The old form
// returned TWO rows for a tyre whenever two sessions shared an identical
// inspection_datetime — which the 2026-07 import can produce, since it writes
// explicit datetimes — silently double-counting that tyre in the low-tread list
// and the digest. Picking a single tyre_inspection_id cannot tie. Truncation at
// group_concat_max_len is harmless here: only the first id is ever read.
//
// Interpolated into template literals, never built from user input.
//
// REQUIRES migration 014 (uneven_wear_type, tread_spread_mm). Deploying this
// Lambda against a database that has not been migrated 500s the low-tread list,
// the nightly digest and the fleet summary alike.
const LATEST_TYRE_INSPECTION_SQL = `
  SELECT ti.tyre_id,
         ti.tyre_inspection_id,
         ti.inspection_result,
         ti.sidewall_condition,
         ti.uneven_wear_type,
         ti.tread_spread_mm,
         s.inspection_datetime,
         MIN(tt.tread_thickness_mm) AS min_tread_mm,
         MAX(tt.tread_thickness_mm) AS max_tread_mm,
         COUNT(tt.tyre_tread_id)    AS groove_count
  FROM TYRE_INSPECTION ti
  JOIN TYRE_INSPECTION_SESSION s ON s.tyre_inspection_session_id = ti.session_id
  JOIN TYRE_TREAD tt ON tt.tyre_inspection_id = ti.tyre_inspection_id
  JOIN (
    SELECT ti2.tyre_id,
           SUBSTRING_INDEX(
             GROUP_CONCAT(ti2.tyre_inspection_id
               ORDER BY s2.inspection_datetime DESC, ti2.tyre_inspection_id DESC),
             ',', 1) AS latest_inspection_id
    FROM TYRE_INSPECTION ti2
    JOIN TYRE_INSPECTION_SESSION s2 ON s2.tyre_inspection_session_id = ti2.session_id
    GROUP BY ti2.tyre_id
  ) pick ON pick.latest_inspection_id = ti.tyre_inspection_id
  GROUP BY ti.tyre_inspection_id, ti.tyre_id, ti.inspection_result,
           ti.sidewall_condition, ti.uneven_wear_type, ti.tread_spread_mm,
           s.inspection_datetime
`;
// Sidewall / tyre-condition toggle, asked for every tyre on both the
// replacement popup (outgoing and incoming) and the technician's periodic
// inspection. Distinct from TYRE_INSPECTION_RESULTS, which is the overall
// pass/monitor/reject verdict on an inspected tyre.
const TYRE_SIDEWALL_CONDITIONS = ["ok", "not_ok"];
// Groove counts a tyre may have. The fleet runs 4-groove (LM 666, GT 867,
// GITI, FR 208) and 3-groove (LM 668) tyres; TYRE.tyre_tread_count records
// which, and the thickness readings for a tyre must match it one-for-one.
const TYRE_ALLOWED_TREAD_COUNTS = [3, 4];
// Retread history is tracked in buckets 0..3. 3 is a HARD MAXIMUM, not a "3+":
// a casing retreaded three times is at the end of its life and cannot
// legitimately be recorded as retreaded again. Rows predating this scheme may
// hold a higher number; they read back as 3 and are never written downwards
// (see the GREATEST() writes at the swap and inspection call sites).
//
// Note the meaning shift from the previous scheme, where the top bucket was 2
// and meant "two or more": a stored 2 now means exactly two. 014's trailing
// comment lists the casings that may therefore under-report.
const TYRE_RETREAD_COUNTS = [0, 1, 2, 3];
const TYRE_MAX_RETREAD_BUCKET = 3;
// The same number, named for what it means rather than how it clamps, so the
// end-of-life checks read as intent instead of arithmetic.
const TYRE_RETREAD_END_OF_LIFE = TYRE_MAX_RETREAD_BUCKET;

function requireRetreadCount(value, name) {
  const n = toWholeNumber(value, name);
  if (!TYRE_RETREAD_COUNTS.includes(n)) {
    throw new Error(
      `Invalid ${name} — must be ${TYRE_RETREAD_COUNTS.join(", ")}; ${TYRE_MAX_RETREAD_BUCKET} is the maximum a casing can carry`
    );
  }
  return n;
}

// What a stored count counts as for comparison, so a legacy 5 still satisfies a
// "3" reading rather than blocking it. This is also the only thing enforcing
// the ceiling on read — nothing in the schema bounds the column.
function retreadBucket(value) {
  const n = Number(value) || 0;
  return Math.min(Math.max(n, 0), TYRE_MAX_RETREAD_BUCKET);
}

/**
 * The sticker photograph backing a retread count.
 *
 * The count is a claim about how much life a casing has left, it is written
 * with GREATEST() so it can only ever go up, and at TYRE_MAX_RETREAD_BUCKET the
 * casing is scrapped — so the number needs its evidence, and a mistake cannot be
 * walked back through the app. Every form that SETS a count must send the
 * sticker it read the count from.
 *
 * A count of 0 is a never-retreaded casing with no sticker to photograph, so
 * nothing is required, and a stray key is dropped rather than filed against a
 * tyre that has never been retreaded.
 */
function retreadStickerKeyFor(value, count, name) {
  const key = value ? String(value).trim() : null;
  if (count != null && retreadBucket(count) > 0 && !key) {
    throw new Error(`${name} is required when the retread count is 1 or more`);
  }
  return count != null && retreadBucket(count) > 0 ? key : null;
}

// ===== DERIVED INSPECTION FINDINGS =====
//
// !! MIRRORED IN src/utils/tyreWear.ts — KEEP THE TWO IN STEP !!
//
// Duplicated rather than shared because there is no shared module path between
// the two halves of this repo: the Lambda is a single plain .mjs deployed as-is
// with no bundler and no package.json, the app is TypeScript compiled by Metro.
// Standing up a build step to share sixty lines of dependency-free arithmetic
// would cost more than it saves. The client needs this to show the technician a
// live verdict as they type, offline, on a depot floor; the server needs it
// because the stored verdict must never be whatever the client felt like
// sending. The fixture table in src/utils/tyreWear.ts is the spec for both.

// The spread between the deepest and shallowest groove on one tyre that means
// it is wearing unevenly rather than just imperfectly. Inclusive: a spread of
// exactly 1.5mm counts, which is what makes the worked example 12/13.5/13.5/13.5
// classify at all.
const UNEVEN_WEAR_SPREAD_MM = 1.5;

// Verdict thresholds, applied to the tyre's SHALLOWEST groove.
const TYRE_REJECT_TREAD_MM = 5.0;
const TYRE_MONITOR_TREAD_MM = 7.0;

const INSPECTION_RESULT_RANK = { pass: 0, monitor: 1, reject: 2 };
function worstResult(a, b) {
  return INSPECTION_RESULT_RANK[a] >= INSPECTION_RESULT_RANK[b] ? a : b;
}

/**
 * Classify a tyre's groove readings by the CAUSE of any uneven wear.
 *
 * READING ORDER, and why the wheel's side is needed.
 *
 * Readings are recorded against a fixed edge of the BUS, not of the tyre:
 * tread_position 1 is always the kerb-side edge (READING_ANCHOR). One
 * instruction a technician can follow at any wheel — but it means the same array
 * means opposite things on opposite sides. On a LEFT wheel the kerb-side edge IS
 * the outboard shoulder, so the array already runs outer-to-inner; on a RIGHT
 * wheel it is the inboard shoulder and has to be reversed.
 *
 * Toe-in and toe-out are the same gradient with opposite signs, so getting this
 * wrong inverts the answer rather than blurring it: 5/5/7/8 is toe-in on the
 * left of the bus and toe-out on the right. Inflation wear is symmetric about
 * the tread centre and survives a reversal unchanged.
 *
 * Omitting axleSide treats the readings as already outer-to-inner.
 *
 * CAVEAT — camber produces the same one-sided gradient as toe: positive camber
 * mimics toe-in, negative mimics toe-out. The tell for toe is feathering, felt
 * by hand, which is not a depth. 'toe_in'/'toe_out' are the most likely cause of
 * the shape, not a certainty.
 *
 * Returns { type, spread }; type is null when the tyre is wearing evenly.
 */
// The edge of the bus tread_position 1 is always measured from. Mirrors
// READING_ANCHOR in src/utils/tyreWear.ts — the two must agree or the server
// will disagree with the screen the technician was looking at.
const READING_ANCHOR = "left";

function toOuterToInner(readings, axleSide) {
  if (!axleSide || axleSide === READING_ANCHOR) return readings;
  return [...readings].reverse();
}

function classifyUnevenWear(readings, axleSide) {
  const raw = (readings || []).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  const v = toOuterToInner(raw, axleSide);
  if (v.length < 3) return { type: null, spread: null };

  const max = Math.max(...v);
  const min = Math.min(...v);
  // Rounded to one decimal to match TYRE_TREAD.tread_thickness_mm's DECIMAL(4,1),
  // so the stored spread can't disagree with the readings it came from.
  const spread = Math.round((max - min) * 10) / 10;
  if (spread < UNEVEN_WEAR_SPREAD_MM) return { type: null, spread };

  const shoulders = [v[0], v[v.length - 1]];
  const centre = v.slice(1, -1);
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // From here the tyre HAS an issue — the spread said so. All that is left is to
  // name it, and a named cause is always more use than "irregular", so the two
  // physical signals are read off the profile and the stronger one wins.
  //
  //   inflation — where the CENTRE sits against the two SHOULDERS. Positive: the
  //               shoulders are the worn part, so the tyre has been running on
  //               its edges (under-inflated). Negative: the crown is worn
  //               (over-inflated). Symmetric about the tread centre, so it
  //               carries no direction and is safe whatever the groove order.
  //
  //   toe       — where the INNER shoulder sits against the OUTER one. Positive:
  //               the outer edge is worn (toe-in). Negative: the inner (toe-out).
  //               Purely antisymmetric — it is nothing BUT direction.
  //
  // Ties go to inflation: it is the commoner cause, and it is the claim that
  // does not depend on the readings having been taken outer-to-inner.
  //
  // This replaced four all-or-nothing shape tests — both shoulders strictly
  // below the whole centre, the centre strictly below both shoulders, and two
  // monotonic runs. They agree with this rule on every shape they DID match, but
  // anything that missed all four fell to 'irregular' however obvious its
  // profile: 6.7 / 8 / 6.5 / 6.9 has its shoulders a clear 0.45mm below its
  // centre and was reported as having no identifiable cause.
  const inflation = avg(centre) - avg(shoulders);
  const toe = v[v.length - 1] - v[0];

  if (Math.abs(inflation) >= Math.abs(toe)) {
    if (inflation > 0) return { type: "under_inflation", spread };
    if (inflation < 0) return { type: "over_inflation", spread };
  } else {
    return { type: toe > 0 ? "toe_in" : "toe_out", spread };
  }

  // Both signals are exactly zero. The tread varies — the spread said so — but
  // symmetrically AND with level shoulders, so no cause fits it better than any
  // other and naming one would be invention. e.g. 12 / 10 / 14 / 12.
  return { type: "irregular", spread };
}

/**
 * The pass/monitor/reject verdict, derived from what was measured rather than
 * chosen from a dropdown.
 *
 * NOTE: a derived 'reject' is a finding about the READING, not an instruction to
 * retire the tyre. It must never write TYRE.tyre_status — see
 * createTyreInspectionSession for why.
 */
function deriveInspectionResult({ minTread, sidewallCondition, unevenWearType }) {
  let result = "pass";
  if (minTread != null && Number.isFinite(minTread)) {
    if (minTread < TYRE_REJECT_TREAD_MM) result = "reject";
    else if (minTread < TYRE_MONITOR_TREAD_MM) result = "monitor";
  }
  if (sidewallCondition === "not_ok") result = worstResult(result, "monitor");
  if (unevenWearType) result = worstResult(result, "monitor");
  return result;
}

// How each wear type reads inside reject_reason. Spelled out rather than
// interpolating the raw enum, which produced sentences like "Uneven wear
// (toe_in)" — a column that managers actually read should not leak the schema.
// The legacy members can still be hit when an old row is re-described.
const UNEVEN_WEAR_PHRASE = {
  toe_in: "Toe-in wear (outer edge worn)",
  toe_out: "Toe-out wear (inner edge worn)",
  under_inflation: "Under-inflation wear (both edges worn)",
  over_inflation: "Over-inflation wear (centre worn)",
  irregular: "Irregular wear (no single cause)",
  alignment: "Alignment wear (legacy, direction not recorded)",
  imbalance: "Irregular wear (legacy)",
};

/**
 * A short human sentence for why, stored in reject_reason so the report screens
 * still have something to show now that the technician no longer types one.
 * Kept inside the column's 255 chars by construction.
 */
function describeInspectionResult({ minTread, sidewallCondition, unevenWearType, spread }) {
  const parts = [];
  if (minTread != null && minTread < TYRE_REJECT_TREAD_MM) {
    parts.push(`Shallowest groove ${minTread}mm is below the ${TYRE_REJECT_TREAD_MM}mm limit`);
  } else if (minTread != null && minTread < TYRE_MONITOR_TREAD_MM) {
    parts.push(`Shallowest groove ${minTread}mm is below ${TYRE_MONITOR_TREAD_MM}mm`);
  }
  if (sidewallCondition === "not_ok") parts.push("Sidewall condition not OK");
  if (unevenWearType) {
    const phrase = UNEVEN_WEAR_PHRASE[unevenWearType] ?? `Uneven wear (${unevenWearType})`;
    parts.push(`${phrase}, ${spread}mm spread`);
  }
  return parts.length ? parts.join("; ").slice(0, 255) : null;
}

// Tyre data is scoped to the projects a user is assigned to, matching how
// getBuses already behaves — an admin sees the whole fleet, everyone else sees
// only their own projects' buses.
//
// The subtlety is stock: a spare, retreading, rejected or retired tyre isn't on
// any bus, so it belongs to no project. Filtering those on a bus's project would
// hide the entire stock list from every non-admin, so unmounted tyres are always
// included and only mounted ones are filtered by where they're fitted.
// Guards the write paths that take a bus_id from the request body. Scoping the
// list queries only controls what a user is shown; without this they could
// still swap a tyre onto, or file an inspection against, a bus belonging to a
// project they aren't assigned to.
async function assertBusInScope(conn, auth, busId) {
  const [busRows] = await conn.execute(
    "SELECT bus_id, project_id FROM BUS WHERE bus_id=? LIMIT 1",
    [busId]
  );
  if (!busRows.length) throw new Error("bus_id not found");
  if (auth.role === "admin") return null;

  const userId = await getOrCreateUserId(conn, auth);
  const [chk] = await conn.execute(
    "SELECT 1 FROM USER_PROJECT WHERE user_id=? AND project_id=? LIMIT 1",
    [userId, busRows[0].project_id]
  );
  if (!chk.length) return json(403, { code: "FORBIDDEN", message: "Bus is not in one of your projects" });
  return null;
}

/**
 * The project the caller has SELECTED in the app, as opposed to the set of
 * projects they are permitted to see.
 *
 * Every role but admin now picks one project before reaching any screen, and
 * the screens are expected to show that project only. The two scope helpers
 * below already narrowed results to a user's USER_PROJECT rows; this narrows
 * them further to the single project asked for.
 *
 * The membership check is not redundant with that scoping. A caller can put any
 * project_id in the query string, and for endpoints that return aggregates a
 * silent empty result would be indistinguishable from "this project has no
 * tyres" — so an unauthorised project is refused outright rather than filtered
 * to nothing. Admin skips the check, as it does everywhere else.
 *
 * Returns null when no project was requested (the fleet-wide view admin keeps),
 * or a json() 403 response, which callers must return as-is.
 */
async function resolveSelectedProject(conn, auth, qs) {
  const projectId = qs?.project_id ? String(qs.project_id).trim() : null;
  if (!projectId) return { projectId: null, deny: null };

  if (auth.role !== "admin") {
    const userId = await getOrCreateUserId(conn, auth);
    const [chk] = await conn.execute(
      "SELECT 1 FROM USER_PROJECT WHERE user_id=? AND project_id=? LIMIT 1",
      [userId, projectId]
    );
    if (!chk.length) {
      return {
        projectId: null,
        deny: json(403, { code: "FORBIDDEN", message: "Project is not one of yours" }),
      };
    }
  }
  return { projectId, deny: null };
}

function busProjectScope(auth, userId, busAlias = "b", projectId = null) {
  const sql = [];
  const vals = [];
  if (auth.role !== "admin") {
    sql.push(`AND EXISTS (SELECT 1 FROM USER_PROJECT up WHERE up.user_id=? AND up.project_id=${busAlias}.project_id)`);
    vals.push(userId);
  }
  if (projectId) {
    sql.push(`AND ${busAlias}.project_id = ?`);
    vals.push(projectId);
  }
  return { sql: sql.join(" "), vals };
}

function mountedTyreProjectScope(auth, userId, mountAlias = "m", projectId = null) {
  const sql = [];
  const vals = [];
  if (auth.role !== "admin") {
    sql.push(`AND (${mountAlias}.tyre_mounting_id IS NULL OR EXISTS (
            SELECT 1 FROM BUS sb JOIN USER_PROJECT up ON up.project_id = sb.project_id
            WHERE sb.bus_id = ${mountAlias}.bus_id AND up.user_id = ?))`);
    vals.push(userId);
  }
  if (projectId) {
    // NOTE the IS NULL arm: an UNMOUNTED tyre belongs to no bus and therefore to
    // no project, so a strict filter would empty the spares list for every
    // project and leave the replacement flow with nothing to fit. Spare stock is
    // shared across projects until the moment it goes on a bus, and there is no
    // column that says otherwise. Mounted tyres are filtered normally.
    sql.push(`AND (${mountAlias}.tyre_mounting_id IS NULL OR EXISTS (
            SELECT 1 FROM BUS pb WHERE pb.bus_id = ${mountAlias}.bus_id AND pb.project_id = ?))`);
    vals.push(projectId);
  }
  return { sql: sql.join(" "), vals };
}

function requireOneOf(value, allowed, name) {
  const v = (value ?? "").toString().trim().toLowerCase();
  if (!allowed.includes(v)) throw new Error(`Invalid ${name}`);
  return v;
}

// Both halves of the Tyre Replacement popup take one groove-thickness reading
// (mm) per groove on the tyre — the fleet runs both 4-groove (LM 666, GT 867)
// and 3-groove (LM 668) tyres, and the paper form leaves the fourth box empty
// on the latter. `expected` is the tyre's own TYRE.tyre_tread_count, so the
// count is validated against the actual tyre rather than assumed. Returns null
// when the field wasn't sent at all (e.g. no outgoing tyre to measure).
function parseThicknessReadings(value, name, expected = null) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new Error(`Invalid ${name} — must be an array of readings`);

  const allowed = expected != null ? [expected] : TYRE_ALLOWED_TREAD_COUNTS;
  if (!allowed.includes(value.length)) {
    throw new Error(
      `Invalid ${name} — this tyre has ${allowed.join(" or ")} grooves, so ${allowed.join(" or ")} readings are required`
    );
  }

  return value.map((v, i) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}[${i}] — must be a number >= 0`);
    return n;
  });
}

async function getTyreInspectionIntervalDays(conn) {
  const [rows] = await conn.execute(
    `SELECT setting_value FROM APP_SETTING WHERE setting_key='tyre_inspection_interval_days' LIMIT 1`
  );
  const days = rows?.length ? Number(rows[0].setting_value) : NaN;
  return Number.isFinite(days) && days > 0 ? days : 30;
}

async function listTyres(conn, auth, qs) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const { projectId, deny: projectDeny } = await resolveSelectedProject(conn, auth, qs);
  if (projectDeny) return projectDeny;

  const userId = await getOrCreateUserId(conn, auth);
  const scope = mountedTyreProjectScope(auth, userId, "m", projectId);

  const where = [];
  const vals = [];
  if (qs?.status) { where.push("t.tyre_status=?"); vals.push(requireOneOf(qs.status, [...TYRE_MANUAL_STATUSES, "mounted"], "status")); }
  if (qs?.unmounted === "1") where.push("m.tyre_mounting_id IS NULL");

  // The latest inspection's finding rides along on every tyre row, so a tyre can
  // be LABELLED with its wear classification anywhere it is listed. Without this
  // the classification only existed inside the tread diagram, which means it was
  // invisible in every list — the places a manager actually scans.
  //
  // LEFT JOIN, so a tyre that has never been inspected still comes back; its
  // latest_* columns are simply null and the label renders as "not inspected".
  const [rows] = await conn.execute(
    `SELECT t.*, m.tyre_mounting_id AS current_mounting_id, m.bus_id AS current_bus_id,
            m.axle_number, m.axle_side, m.wheel_position, m.mounted_at,
            b.bus_route AS current_bus_route, b.bus_route_colour AS current_bus_route_colour,
            b.bus_route_number AS current_bus_route_number, b.bus_ev_no AS current_bus_ev_no,
            b.bus_model AS current_bus_model,
            b.project_id AS current_project_id,
            latest.uneven_wear_type  AS latest_uneven_wear_type,
            latest.tread_spread_mm   AS latest_tread_spread_mm,
            latest.min_tread_mm      AS latest_min_tread_mm,
            latest.inspection_datetime AS latest_inspection_datetime
     FROM TYRE t
     LEFT JOIN TYRE_MOUNTING m ON m.tyre_id = t.tyre_id AND m.unmounted_at IS NULL
     LEFT JOIN BUS b ON b.bus_id = m.bus_id
     LEFT JOIN (${LATEST_TYRE_INSPECTION_SQL}) latest ON latest.tyre_id = t.tyre_id
     WHERE 1=1 ${where.length ? `AND ${where.join(" AND ")}` : ""} ${scope.sql}
     ORDER BY t.tyre_serial_number ASC
     LIMIT 2000`,
    [...vals, ...scope.vals]
  );
  return json(200, rows);
}

async function getTyre(conn, auth, tyreId) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT t.*, m.tyre_mounting_id AS current_mounting_id, m.bus_id AS current_bus_id,
            m.axle_number, m.axle_side, m.wheel_position, m.mounted_at,
            b.bus_route AS current_bus_route, b.bus_route_colour AS current_bus_route_colour,
            b.bus_route_number AS current_bus_route_number, b.bus_ev_no AS current_bus_ev_no,
            b.bus_model AS current_bus_model,
            b.project_id AS current_project_id
     FROM TYRE t
     LEFT JOIN TYRE_MOUNTING m ON m.tyre_id = t.tyre_id AND m.unmounted_at IS NULL
     LEFT JOIN BUS b ON b.bus_id = m.bus_id
     WHERE t.tyre_id=?`,
    [tyreId]
  );
  if (!rows.length) return json(404, { message: "Tyre not found" });

  const [mountingHistory] = await conn.execute(
    `SELECT m.*, b.bus_ev_no FROM TYRE_MOUNTING m LEFT JOIN BUS b ON b.bus_id = m.bus_id
     WHERE m.tyre_id=? ORDER BY m.mounted_at DESC, m.tyre_mounting_id DESC`,
    [tyreId]
  );

  const [inspectionHistory] = await conn.execute(
    `SELECT ti.tyre_inspection_id, ti.tyre_id, ti.session_id, ti.tyre_pressure, ti.sidewall_condition,
            ti.sidewall_note, ti.retread_count_observed, ti.inspection_result, ti.result_source,
            ti.reject_reason, ti.uneven_wear_type, ti.tread_spread_mm,
            s.bus_id, s.inspection_datetime, s.odometer_reading,
            b.bus_route, b.bus_route_colour, b.bus_route_number, b.bus_ev_no,
            (SELECT MIN(tt.tread_thickness_mm) FROM TYRE_TREAD tt
              WHERE tt.tyre_inspection_id = ti.tyre_inspection_id) AS min_tread_mm,
            -- Ordered groove readings, so the tread diagram can be drawn from a
            -- history row without a second round trip per inspection.
            (SELECT GROUP_CONCAT(tt.tread_thickness_mm ORDER BY tt.tread_position ASC)
               FROM TYRE_TREAD tt
              WHERE tt.tyre_inspection_id = ti.tyre_inspection_id) AS tread_readings
     FROM TYRE_INSPECTION ti
     JOIN TYRE_INSPECTION_SESSION s ON s.tyre_inspection_session_id = ti.session_id
     LEFT JOIN BUS b ON b.bus_id = s.bus_id
     WHERE ti.tyre_id=?
     ORDER BY s.inspection_datetime DESC
     LIMIT 50`,
    [tyreId]
  );

  return json(200, { ...rows[0], mounting_history: mountingHistory, inspection_history: inspectionHistory });
}

async function createTyre(conn, auth, b) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  if (!b.tyre_serial_number) throw new Error("tyre_serial_number is required");

  const retreadCount = b.tyre_retread_count != null ? requireRetreadCount(b.tyre_retread_count, "tyre_retread_count") : 0;
  const stickerKey = retreadStickerKeyFor(
    b.retread_sticker_s3_key, retreadCount, "retread_sticker_s3_key");
  const treadCount = b.tyre_tread_count != null ? toWholeNumber(b.tyre_tread_count, "tyre_tread_count") : 4;
  if (!TYRE_ALLOWED_TREAD_COUNTS.includes(treadCount)) {
    throw new Error(`Invalid tyre_tread_count — must be ${TYRE_ALLOWED_TREAD_COUNTS.join(" or ")}`);
  }

  // Every new tyre is measured as it enters stock: one reading per groove.
  // It is on no bus yet, so this can't be an inspection; the readings live on
  // the TYRE row and pre-fill the incoming thickness when it is fitted.
  if (b.intake_thickness == null) {
    return json(400, {
      code: "INTAKE_THICKNESS_REQUIRED",
      message: `Enter the thickness of each groove (${treadCount} readings)`,
    });
  }
  const intake = parseIntakeThickness(b.intake_thickness, treadCount);
  const userId = await getOrCreateUserId(conn, auth);

  const [res] = await conn.execute(
    `INSERT INTO TYRE (tyre_serial_number, tyre_brand, tyre_model, tyre_retread_count,
                       retread_sticker_s3_bucket, retread_sticker_s3_key,
                       tyre_tread_count, tyre_bought_date,
                       intake_thickness_1, intake_thickness_2, intake_thickness_3, intake_thickness_4,
                       intake_measured_at, intake_measured_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)`,
    [
      String(b.tyre_serial_number).trim(),
      b.tyre_brand ? String(b.tyre_brand).trim() : null,
      b.tyre_model ? String(b.tyre_model).trim() : null,
      retreadCount,
      stickerKey ? S3_BUCKET : null,
      stickerKey,
      treadCount,
      b.tyre_bought_date ?? null,
      intake[0] ?? null, intake[1] ?? null, intake[2] ?? null, intake[3] ?? null,
      userId,
    ]
  );
  return json(200, { tyre_id: res.insertId });
}

// The deepest a groove on a new bus tyre can plausibly be; anything above it
// is a typing slip (e.g. 155 for 15.5).
const TYRE_MAX_THICKNESS_MM = 30;

function parseIntakeThickness(value, treadCount) {
  const readings = parseThicknessReadings(value, "intake_thickness", treadCount);
  readings.forEach((n, i) => {
    if (n > TYRE_MAX_THICKNESS_MM) {
      throw new Error(`Invalid intake_thickness[${i}] — must be ${TYRE_MAX_THICKNESS_MM}mm or less`);
    }
  });
  return readings;
}

async function updateTyre(conn, auth, tyreId, b) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const updates = [];
  const vals = [];

  if (b.tyre_serial_number != null) { updates.push("tyre_serial_number=?"); vals.push(String(b.tyre_serial_number).trim()); }
  if (b.tyre_brand !== undefined)   { updates.push("tyre_brand=?");         vals.push(b.tyre_brand ? String(b.tyre_brand).trim() : null); }
  if (b.tyre_model !== undefined)   { updates.push("tyre_model=?");         vals.push(b.tyre_model ? String(b.tyre_model).trim() : null); }
  if (b.tyre_retread_count != null) {
    const count = requireRetreadCount(b.tyre_retread_count, "tyre_retread_count");
    updates.push("tyre_retread_count=?"); vals.push(count);
    // Editing the count is setting the count, so it carries the same burden of
    // proof as recording it on any of the three forms.
    const key = retreadStickerKeyFor(b.retread_sticker_s3_key, count, "retread_sticker_s3_key");
    if (key) {
      updates.push("retread_sticker_s3_bucket=?"); vals.push(S3_BUCKET);
      updates.push("retread_sticker_s3_key=?"); vals.push(key);
    }
  }
  if (b.tyre_tread_count != null) {
    const treadCount = toWholeNumber(b.tyre_tread_count, "tyre_tread_count");
    if (!TYRE_ALLOWED_TREAD_COUNTS.includes(treadCount)) {
      throw new Error(`Invalid tyre_tread_count — must be ${TYRE_ALLOWED_TREAD_COUNTS.join(" or ")}`);
    }
    updates.push("tyre_tread_count=?"); vals.push(treadCount);
  }
  if (b.tyre_bought_date !== undefined) { updates.push("tyre_bought_date=?"); vals.push(b.tyre_bought_date ?? null); }
  // Correcting the readings taken when the tyre entered stock. Checked against
  // the groove count being set in this same call, or the tyre's current one.
  if (b.intake_thickness != null) {
    let count = b.tyre_tread_count != null ? Number(b.tyre_tread_count) : null;
    if (count == null) {
      const [cur] = await conn.execute("SELECT tyre_tread_count FROM TYRE WHERE tyre_id=?", [tyreId]);
      if (!cur.length) return json(404, { message: "Tyre not found" });
      count = Number(cur[0].tyre_tread_count) || 4;
    }
    const intake = parseIntakeThickness(b.intake_thickness, count);
    updates.push(
      "intake_thickness_1=?", "intake_thickness_2=?", "intake_thickness_3=?", "intake_thickness_4=?",
      "intake_measured_at=NOW()", "intake_measured_by=?",
    );
    vals.push(intake[0] ?? null, intake[1] ?? null, intake[2] ?? null, intake[3] ?? null, await getOrCreateUserId(conn, auth));
  }
  if (b.tyre_status != null) {
    updates.push("tyre_status=?");
    vals.push(requireOneOf(b.tyre_status, TYRE_MANUAL_STATUSES, "tyre_status"));
  }

  if (!updates.length) return json(200, { success: true });

  vals.push(tyreId);
  await conn.execute(`UPDATE TYRE SET ${updates.join(", ")} WHERE tyre_id=?`, vals);
  return json(200, { success: true });
}

async function listBusTyres(conn, auth, busId) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  // Same latest-inspection join listTyres carries, so the wheel diagram can
  // label each position with its shallowest groove. Without it this endpoint
  // returns no tread at all and the diagram has nothing to show.
  const [rows] = await conn.execute(
    `SELECT t.*, m.tyre_mounting_id AS current_mounting_id, m.bus_id AS current_bus_id,
            m.axle_number, m.axle_side, m.wheel_position, m.mounted_at,
            b.bus_route AS current_bus_route, b.bus_route_colour AS current_bus_route_colour,
            b.bus_route_number AS current_bus_route_number, b.bus_ev_no AS current_bus_ev_no,
            b.bus_model AS current_bus_model,
            b.project_id AS current_project_id,
            latest.uneven_wear_type    AS latest_uneven_wear_type,
            latest.tread_spread_mm     AS latest_tread_spread_mm,
            latest.min_tread_mm        AS latest_min_tread_mm,
            latest.inspection_datetime AS latest_inspection_datetime
     FROM TYRE_MOUNTING m
     JOIN TYRE t ON t.tyre_id = m.tyre_id
     LEFT JOIN BUS b ON b.bus_id = m.bus_id
     LEFT JOIN (${LATEST_TYRE_INSPECTION_SQL}) latest ON latest.tyre_id = t.tyre_id
     WHERE m.bus_id=? AND m.unmounted_at IS NULL
     ORDER BY m.axle_number ASC, m.axle_side ASC, m.wheel_position ASC`,
    [busId]
  );
  return json(200, rows);
}

async function swapTyre(conn, auth, b) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  if (!b.bus_id) throw new Error("bus_id is required");
  const busId = String(b.bus_id).trim();
  const axleNumber = toWholeNumber(b.axle_number, "axle_number");
  if (axleNumber <= 0) throw new Error("axle_number must be a whole number > 0");
  const axleSide = requireOneOf(b.axle_side, TYRE_AXLE_SIDES, "axle_side");
  const wheelPosition = b.wheel_position != null ? requireOneOf(b.wheel_position, TYRE_WHEEL_POSITIONS, "wheel_position") : "single";
  const incomingTyreId = toId(b.incoming_tyre_id, "incoming_tyre_id");
  const outgoingStatus = b.outgoing_status != null ? requireOneOf(b.outgoing_status, TYRE_MANUAL_STATUSES, "outgoing_status") : "spare";

  // Tyre Replacement popup detail — all optional at this layer so the
  // endpoint still works for a bare swap; the rm-manager screen always sends
  // the incoming side, and the outgoing side whenever there was a tyre to
  // measure before removal.
  // The thickness arrays are validated inside the transaction instead of here:
  // how many readings are required depends on each tyre's own
  // TYRE.tyre_tread_count (3 or 4 grooves), which isn't known until the rows
  // are read below.
  const outgoingSidewallCondition = b.outgoing_sidewall_condition != null
    ? requireOneOf(b.outgoing_sidewall_condition, TYRE_SIDEWALL_CONDITIONS, "outgoing_sidewall_condition")
    : null;
  const incomingSidewallCondition = b.incoming_sidewall_condition != null
    ? requireOneOf(b.incoming_sidewall_condition, TYRE_SIDEWALL_CONDITIONS, "incoming_sidewall_condition")
    : null;

  // A not-OK sidewall must come with the photograph that shows it — see
  // createTyreInspectionSession for the reasoning. Two independent pairs,
  // because the tyre coming off and the tyre going on are different casings and
  // either can be NC on its own.
  const sidewallPhotoKey = (value, condition, name) => {
    const key = value ? String(value).trim() : null;
    if (condition === "not_ok" && !key) {
      throw new Error(`${name} is required when the sidewall condition is not_ok`);
    }
    // An OK sidewall has nothing to show, so a stray key is dropped rather than
    // stored against a tyre that was judged sound.
    return condition === "not_ok" ? key : null;
  };
  const outgoingSidewallPhotoKey = sidewallPhotoKey(
    b.outgoing_sidewall_photo_s3_key, outgoingSidewallCondition, "outgoing_sidewall_photo_s3_key");
  const incomingSidewallPhotoKey = sidewallPhotoKey(
    b.incoming_sidewall_photo_s3_key, incomingSidewallCondition, "incoming_sidewall_photo_s3_key");
  const retreadStickerKey = b.retread_sticker_s3_key ? String(b.retread_sticker_s3_key).trim() : null;
  let incomingTyrePressure = null;
  if (b.incoming_tyre_pressure != null) {
    incomingTyrePressure = Number(b.incoming_tyre_pressure);
    if (!Number.isFinite(incomingTyrePressure)) throw new Error("Invalid incoming_tyre_pressure");
  }
  const installPhotoKey = b.install_photo_s3_key ? String(b.install_photo_s3_key).trim() : null;

  const userId = await getOrCreateUserId(conn, auth);

  await conn.beginTransaction();
  try {
    const outOfScope = await assertBusInScope(conn, auth, busId);
    if (outOfScope) { await conn.rollback(); return outOfScope; }

    const [incomingRows] = await conn.execute(
      // tyre_retread_count is selected because the monotonic guard below reads
      // it. It was missing, so `known` was always retreadBucket(undefined) === 0
      // and a swap recording a LOWER count than the tyre already carried passed
      // silently.
      "SELECT tyre_id, tyre_status, tyre_tread_count, tyre_retread_count FROM TYRE WHERE tyre_id=? FOR UPDATE",
      [incomingTyreId]
    );
    if (!incomingRows.length) throw new Error("incoming_tyre_id not found");

    const incomingThickness = parseThicknessReadings(
      b.incoming_thickness,
      "incoming_thickness",
      Number(incomingRows[0].tyre_tread_count) || null
    );

    // Retread count as read off the tyre (and off its sticker photo) at
    // fitment. It can only ever go up — a tyre cannot un-retread — so a lower
    // figure than what's already recorded is a data-entry error.
    let incomingRetreadCount = null;
    if (b.incoming_retread_count != null) {
      incomingRetreadCount = requireRetreadCount(b.incoming_retread_count, "incoming_retread_count");
      const known = retreadBucket(incomingRows[0].tyre_retread_count);
      if (incomingRetreadCount < known) {
        throw new Error(
          `Invalid incoming_retread_count — this tyre is already recorded as retreaded ${known === TYRE_MAX_RETREAD_BUCKET ? `${TYRE_MAX_RETREAD_BUCKET}+` : known} time(s)`
        );
      }
    }
    if (TYRE_UNMOUNTABLE_STATUSES.includes(incomingRows[0].tyre_status)) {
      await conn.rollback();
      return json(409, { code: "TYRE_NOT_MOUNTABLE", message: `Tyre is ${incomingRows[0].tyre_status} and cannot be mounted` });
    }

    const [existingAtPosition] = await conn.execute(
      `SELECT m.tyre_mounting_id, m.tyre_id, t.tyre_tread_count
       FROM TYRE_MOUNTING m JOIN TYRE t ON t.tyre_id = m.tyre_id
       WHERE m.bus_id=? AND m.axle_number=? AND m.axle_side=? AND m.wheel_position=? AND m.unmounted_at IS NULL
       FOR UPDATE`,
      [busId, axleNumber, axleSide, wheelPosition]
    );

    const outgoingThickness = parseThicknessReadings(
      b.outgoing_thickness,
      "outgoing_thickness",
      existingAtPosition.length ? Number(existingAtPosition[0].tyre_tread_count) || null : null
    );

    // Refitting the same tyre to the position it is already on is a real
    // operation, not a mistake: the tyre comes off, goes away for retreading,
    // and goes back on. It's recorded as a genuine swap — the old mounting is
    // closed and a new one opened — so the tyre's time off the bus, its
    // pre-removal readings and its post-retread readings all survive.
    const isSelfRefit =
      existingAtPosition.length && Number(existingAtPosition[0].tyre_id) === incomingTyreId;

    if (!isSelfRefit) {
      const [incomingOpenMount] = await conn.execute(
        "SELECT tyre_mounting_id FROM TYRE_MOUNTING WHERE tyre_id=? AND unmounted_at IS NULL FOR UPDATE",
        [incomingTyreId]
      );
      if (incomingOpenMount.length) {
        await conn.rollback();
        return json(409, {
          code: "TYRE_ALREADY_MOUNTED",
          message: "Tyre is already mounted elsewhere — unmount it first",
        });
      }
    }

    if (existingAtPosition.length) {
      const outgoing = existingAtPosition[0];
      await conn.execute(
        `UPDATE TYRE_MOUNTING SET unmounted_at=NOW(), unmounted_by=?, unmount_reason='swapped out' WHERE tyre_mounting_id=?`,
        [userId, outgoing.tyre_mounting_id]
      );
      if (!isSelfRefit) {
        await conn.execute(`UPDATE TYRE SET tyre_status=? WHERE tyre_id=?`, [outgoingStatus, outgoing.tyre_id]);
      }
    }

    const [mountRes] = await conn.execute(
      `INSERT INTO TYRE_MOUNTING (tyre_id, bus_id, axle_number, axle_side, wheel_position, mounted_by)
       VALUES (?,?,?,?,?,?)`,
      [incomingTyreId, busId, axleNumber, axleSide, wheelPosition, userId]
    );
    await conn.execute(`UPDATE TYRE SET tyre_status='mounted' WHERE tyre_id=?`, [incomingTyreId]);
    if (incomingRetreadCount != null) {
      await conn.execute(
        `UPDATE TYRE SET tyre_retread_count=GREATEST(tyre_retread_count, ?) WHERE tyre_id=?`,
        [incomingRetreadCount, incomingTyreId]
      );
    }

    const hasSwapDetail =
      outgoingThickness || outgoingSidewallCondition || incomingThickness ||
      incomingTyrePressure != null || installPhotoKey ||
      incomingSidewallCondition || incomingRetreadCount != null || retreadStickerKey ||
      outgoingSidewallPhotoKey || incomingSidewallPhotoKey;
    if (hasSwapDetail) {
      await conn.execute(
        `INSERT INTO TYRE_SWAP
         (tyre_mounting_id, outgoing_tyre_id,
          outgoing_thickness_1, outgoing_thickness_2, outgoing_thickness_3, outgoing_thickness_4,
          outgoing_sidewall_condition,
          outgoing_sidewall_photo_s3_bucket, outgoing_sidewall_photo_s3_key,
          incoming_thickness_1, incoming_thickness_2, incoming_thickness_3, incoming_thickness_4,
          incoming_tyre_pressure, incoming_sidewall_condition,
          incoming_sidewall_photo_s3_bucket, incoming_sidewall_photo_s3_key,
          incoming_retread_count,
          retread_sticker_s3_bucket, retread_sticker_s3_key,
          install_photo_s3_bucket, install_photo_s3_key,
          performed_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          mountRes.insertId,
          existingAtPosition.length ? existingAtPosition[0].tyre_id : null,
          outgoingThickness?.[0] ?? null, outgoingThickness?.[1] ?? null,
          outgoingThickness?.[2] ?? null, outgoingThickness?.[3] ?? null,
          outgoingSidewallCondition,
          outgoingSidewallPhotoKey ? S3_BUCKET : null, outgoingSidewallPhotoKey,
          incomingThickness?.[0] ?? null, incomingThickness?.[1] ?? null,
          incomingThickness?.[2] ?? null, incomingThickness?.[3] ?? null,
          incomingTyrePressure, incomingSidewallCondition,
          incomingSidewallPhotoKey ? S3_BUCKET : null, incomingSidewallPhotoKey,
          incomingRetreadCount,
          retreadStickerKey ? S3_BUCKET : null, retreadStickerKey,
          installPhotoKey ? S3_BUCKET : null, installPhotoKey,
          userId,
        ]
      );
    }

    await conn.commit();
    return json(200, { success: true, tyre_mounting_id: mountRes.insertId });
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

// Upload target for the tyre forms' photo steps — requested before the record
// the photo belongs to exists (there is no tyre_mounting_id or
// tyre_inspection_id yet), so the key isn't nested under one, unlike job and
// report media.
//
// Three photos come off these forms: the wheel after install and the tyre's
// retread sticker (Tyre Replacement), and the damage behind a not-OK sidewall
// (Tyre Inspection). The kind says which is which and picks the key prefix.
// Sidewall lives under its own prefix rather than tyres/swap/ because it has
// nothing to do with a swap.
const TYRE_PHOTO_KINDS = {
  install: "tyres/swap/install",
  retread_sticker: "tyres/swap/retread_sticker",
  sidewall: "tyres/inspection/sidewall",
};

async function presignTyrePhoto(conn, auth, qs) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const mime = (qs.mime ?? "").toString().trim();
  if (!mime) throw new Error("mime required");

  const kind = (qs.kind ?? "install").toString().trim();
  const prefix = TYRE_PHOTO_KINDS[kind];
  if (!prefix) throw new Error("Invalid kind");

  const ext = extFromMime(mime);
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const cmd = new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: mime });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });

  return json(200, { uploadUrl, s3_bucket: S3_BUCKET, s3_key: key });
}

async function listBusTyreSwaps(conn, auth, busId) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT s.tyre_swap_id, s.tyre_mounting_id,
            m.axle_number, m.axle_side, m.wheel_position, m.mounted_at,
            m.tyre_id AS incoming_tyre_id, tin.tyre_serial_number AS incoming_serial,
            s.outgoing_tyre_id, tout.tyre_serial_number AS outgoing_serial,
            s.outgoing_thickness_1, s.outgoing_thickness_2, s.outgoing_thickness_3, s.outgoing_thickness_4,
            s.outgoing_sidewall_condition,
            s.outgoing_sidewall_photo_s3_bucket, s.outgoing_sidewall_photo_s3_key,
            s.incoming_thickness_1, s.incoming_thickness_2, s.incoming_thickness_3, s.incoming_thickness_4,
            s.incoming_tyre_pressure, s.incoming_sidewall_condition,
            s.incoming_sidewall_photo_s3_bucket, s.incoming_sidewall_photo_s3_key,
            s.incoming_retread_count,
            s.retread_sticker_s3_bucket, s.retread_sticker_s3_key,
            s.install_photo_s3_bucket, s.install_photo_s3_key,
            u.user_name AS performed_by_name, s.created_at
     FROM TYRE_SWAP s
     JOIN TYRE_MOUNTING m ON m.tyre_mounting_id = s.tyre_mounting_id
     LEFT JOIN TYRE tin ON tin.tyre_id = m.tyre_id
     LEFT JOIN TYRE tout ON tout.tyre_id = s.outgoing_tyre_id
     LEFT JOIN \`USER\` u ON u.user_id = s.performed_by
     WHERE m.bus_id=?
     ORDER BY s.created_at DESC, s.tyre_swap_id DESC
     LIMIT 100`,
    [busId]
  );

  const enriched = await Promise.all(
    (rows || []).map(async (r) => ({
      ...r,
      install_photo_view_url: await signS3Url(r.install_photo_s3_bucket, r.install_photo_s3_key),
      retread_sticker_view_url: await signS3Url(r.retread_sticker_s3_bucket, r.retread_sticker_s3_key),
      outgoing_sidewall_photo_view_url: await signS3Url(
        r.outgoing_sidewall_photo_s3_bucket, r.outgoing_sidewall_photo_s3_key),
      incoming_sidewall_photo_view_url: await signS3Url(
        r.incoming_sidewall_photo_s3_bucket, r.incoming_sidewall_photo_s3_key),
    }))
  );

  return json(200, enriched);
}

async function unmountTyre(conn, auth, tyreId, b) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const newStatus = b.new_status != null ? requireOneOf(b.new_status, TYRE_MANUAL_STATUSES, "new_status") : "spare";
  const userId = await getOrCreateUserId(conn, auth);

  await conn.beginTransaction();
  try {
    const [openMount] = await conn.execute(
      "SELECT tyre_mounting_id FROM TYRE_MOUNTING WHERE tyre_id=? AND unmounted_at IS NULL FOR UPDATE",
      [tyreId]
    );
    if (!openMount.length) {
      await conn.rollback();
      return json(409, { code: "TYRE_NOT_MOUNTED", message: "Tyre is not currently mounted" });
    }

    await conn.execute(
      `UPDATE TYRE_MOUNTING SET unmounted_at=NOW(), unmounted_by=?, unmount_reason=? WHERE tyre_mounting_id=?`,
      [userId, b.reason ? String(b.reason).trim() : null, openMount[0].tyre_mounting_id]
    );
    await conn.execute(`UPDATE TYRE SET tyre_status=? WHERE tyre_id=?`, [newStatus, tyreId]);

    await conn.commit();
    return json(200, { success: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

async function getOverdueTyreInspections(conn, auth, qs) {
  // Read-only. Changing the interval is a fleet-wide setting and stays with
  // admin/rm_manager in updateTyreSettings below.
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const { projectId, deny: projectDeny } = await resolveSelectedProject(conn, auth, qs);
  if (projectDeny) return projectDeny;

  const intervalDays = await getTyreInspectionIntervalDays(conn);

  // Every bus, not just overdue ones — the tyre management home screen uses
  // the full list to show each bus card's last-inspection / days-remaining
  // status, while overdue_buses (a filtered view of the same rows) keeps
  // backing the existing overdue banner.
  const userId = await getOrCreateUserId(conn, auth);
  const scope = busProjectScope(auth, userId, "b", projectId);

  const [rows] = await conn.execute(
    `SELECT b.bus_id, b.bus_route, b.bus_route_colour, b.bus_route_number, b.bus_ev_no,
            b.bus_model, b.project_id, s.last_inspected_at,
            CASE WHEN s.last_inspected_at IS NULL THEN NULL ELSE DATEDIFF(NOW(), s.last_inspected_at) END AS days_since_inspection
     FROM BUS b
     LEFT JOIN (
       SELECT bus_id, MAX(inspection_datetime) AS last_inspected_at
       FROM TYRE_INSPECTION_SESSION
       GROUP BY bus_id
     ) s ON s.bus_id = b.bus_id
     WHERE 1=1 ${scope.sql}
     ORDER BY (s.last_inspected_at IS NULL) DESC, s.last_inspected_at ASC`,
    scope.vals
  );

  const overdueBuses = rows.filter(
    (r) => r.last_inspected_at == null || r.days_since_inspection > intervalDays
  );

  return json(200, {
    inspection_interval_days: intervalDays,
    overdue_buses: overdueBuses,
    all_buses: rows,
  });
}

async function getLowTreadTyres(conn, auth, qs) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const { projectId, deny: projectDeny } = await resolveSelectedProject(conn, auth, qs);
  if (projectDeny) return projectDeny;

  // For each tyre, find its most recent inspection (by session datetime) and
  // the shallowest groove reading recorded in that inspection, then keep only
  // tyres whose latest reading is below the threshold.
  const userId = await getOrCreateUserId(conn, auth);
  const scope = mountedTyreProjectScope(auth, userId, "m", projectId);

  const [rows] = await conn.execute(
    `SELECT t.tyre_id, t.tyre_serial_number, t.tyre_brand, t.tyre_model, t.tyre_status,
            t.tyre_tread_count, t.tyre_retread_count,
            m.bus_id AS current_bus_id, m.axle_number, m.axle_side, m.wheel_position,
            b.bus_route AS current_bus_route, b.bus_route_colour AS current_bus_route_colour,
            b.bus_route_number AS current_bus_route_number, b.bus_ev_no AS current_bus_ev_no,
            b.bus_model AS current_bus_model,
            b.project_id AS current_project_id,
            latest.min_tread_mm, latest.inspection_datetime
     FROM TYRE t
     JOIN (${LATEST_TYRE_INSPECTION_SQL}) latest ON latest.tyre_id = t.tyre_id
     LEFT JOIN TYRE_MOUNTING m ON m.tyre_id = t.tyre_id AND m.unmounted_at IS NULL
     LEFT JOIN BUS b ON b.bus_id = m.bus_id
     WHERE latest.min_tread_mm < ? ${scope.sql}
     ORDER BY latest.min_tread_mm ASC`,
    [TYRE_LOW_TREAD_THRESHOLD_MM, ...scope.vals]
  );

  return json(200, { threshold_mm: TYRE_LOW_TREAD_THRESHOLD_MM, low_tread_tyres: rows });
}

// ===== FLEET TYRE SUMMARY =====

// Tread-depth bands for the fleet summary. The first band is "at or below its
// max"; every other band is "over the previous max, up to and including its
// own". Only the key is returned — the human status label ("PAST LIMIT",
// "NEAR NEW") is i18n on the client so the screen reads in Bahasa Melayu too.
const TYRE_TREAD_BANDS = [
  { key: "past_limit", min_mm: null, max_mm: 5 },
  { key: "critical", min_mm: 5, max_mm: 7 },
  { key: "watch", min_mm: 7, max_mm: 9 },
  { key: "mid_life", min_mm: 9, max_mm: 12 },
  { key: "good", min_mm: 12, max_mm: 16 },
  { key: "near_new", min_mm: 16, max_mm: null },
];

function treadBandKey(mm) {
  for (const b of TYRE_TREAD_BANDS) {
    if (b.max_mm == null) return b.key;
    if (mm <= b.max_mm) return b.key;
  }
  return TYRE_TREAD_BANDS[TYRE_TREAD_BANDS.length - 1].key;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10;
}

function treadStats(values) {
  if (!values.length) {
    return { count: 0, shallowest: null, deepest: null, mean: null, median: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, n) => acc + n, 0);
  return {
    count: sorted.length,
    shallowest: Math.round(sorted[0] * 10) / 10,
    deepest: Math.round(sorted[sorted.length - 1] * 10) / 10,
    mean: Math.round((sum / sorted.length) * 100) / 100,
    median: median(sorted),
  };
}

/**
 * Fleet tyre analytics for the "Tyre Summary and Data" screen.
 *
 * Nothing like this existed: GET /tyres carries no tread data at all, and
 * GET /tyres/low-tread returns only the tyres already past the limit, so there
 * was no way to ask what the fleet's tread distribution actually looks like.
 *
 * One query, one row per tyre currently ON a bus, reduced in JS rather than in
 * SQL. At fleet size (~500 mounted tyres) that is one cheap round trip, and it
 * keeps median, "which tyre is shallowest on this bus" and the band buckets as
 * readable arithmetic instead of three more correlated subqueries.
 *
 * CAVEAT, and it is a real one: swap readings are written to the denormalised
 * TYRE_SWAP.*_thickness_N columns and never reach TYRE_TREAD, so everything
 * here sees INSPECTIONS ONLY. A tyre measured during a replacement but never
 * formally inspected has no tread data and counts as unmeasured.
 */
async function getTyreSummary(conn, auth, qs) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const { projectId, deny: projectDeny } = await resolveSelectedProject(conn, auth, qs);
  if (projectDeny) return projectDeny;

  const userId = await getOrCreateUserId(conn, auth);
  const scope = busProjectScope(auth, userId, "b", projectId);

  // LEFT JOIN to the latest inspection, not JOIN: a tyre fitted but never yet
  // inspected must still count as mounted-but-unmeasured rather than silently
  // vanishing from the fleet total.
  const [rows] = await conn.execute(
    `SELECT t.tyre_id, t.tyre_serial_number, t.tyre_brand, t.tyre_model,
            t.tyre_tread_count, t.tyre_retread_count, t.tyre_status,
            m.bus_id, m.axle_number, m.axle_side, m.wheel_position, m.mounted_at,
            b.bus_route, b.bus_route_number, b.bus_ev_no, b.bus_route_colour,
            b.bus_model, b.project_id,
            latest.min_tread_mm, latest.max_tread_mm, latest.groove_count,
            latest.inspection_datetime, latest.inspection_result,
            latest.sidewall_condition, latest.uneven_wear_type, latest.tread_spread_mm
     FROM TYRE_MOUNTING m
     JOIN TYRE t ON t.tyre_id = m.tyre_id
     JOIN BUS b ON b.bus_id = m.bus_id
     LEFT JOIN (${LATEST_TYRE_INSPECTION_SQL}) latest ON latest.tyre_id = t.tyre_id
     WHERE m.unmounted_at IS NULL ${scope.sql}
     ORDER BY b.bus_id ASC, m.axle_number ASC, m.axle_side ASC, m.wheel_position ASC`,
    scope.vals
  );

  const fitted = rows.map((r) => ({
    ...r,
    min_tread_mm: r.min_tread_mm == null ? null : Number(r.min_tread_mm),
    tread_spread_mm: r.tread_spread_mm == null ? null : Number(r.tread_spread_mm),
  }));
  const measured = fitted.filter((r) => r.min_tread_mm != null);

  // Axle 1 is the steer axle; everything behind it is drive/rear. This is the
  // only place the front/rear split is defined.
  const isFront = (r) => Number(r.axle_number) === 1;

  const bands = TYRE_TREAD_BANDS.map((band) => {
    const inBand = measured.filter((r) => treadBandKey(r.min_tread_mm) === band.key);
    const front = inBand.filter(isFront).length;
    return {
      key: band.key,
      min_mm: band.min_mm,
      max_mm: band.max_mm,
      front,
      rear: inBand.length - front,
      total: inBand.length,
      pct_of_fleet: measured.length
        ? Math.round((inBand.length / measured.length) * 1000) / 10
        : 0,
    };
  });

  const stats = {
    front: treadStats(measured.filter(isFront).map((r) => r.min_tread_mm)),
    rear: treadStats(measured.filter((r) => !isFront(r)).map((r) => r.min_tread_mm)),
    fleet: treadStats(measured.map((r) => r.min_tread_mm)),
  };

  // Per bus, ranked by the bus's own shallowest reading — the user works from
  // "which bus is worst", not "which tyre is worst", because a bus is what gets
  // taken off the road.
  const busMap = new Map();
  for (const r of fitted) {
    const key = String(r.bus_id);
    if (!busMap.has(key)) {
      busMap.set(key, {
        bus_id: r.bus_id,
        bus_route: r.bus_route,
        bus_route_number: r.bus_route_number,
        bus_ev_no: r.bus_ev_no,
        bus_route_colour: r.bus_route_colour,
        bus_model: r.bus_model,
        project_id: r.project_id,
        fitted_count: 0,
        measured_count: 0,
        past_limit_count: 0,
        uneven_wear_count: 0,
        shallowest_mm: null,
        shallowest_axle_number: null,
        shallowest_axle_side: null,
        shallowest_wheel_position: null,
        shallowest_tyre_id: null,
        shallowest_serial: null,
        last_inspected_at: null,
      });
    }
    const bus = busMap.get(key);
    bus.fitted_count += 1;
    if (r.uneven_wear_type) bus.uneven_wear_count += 1;
    if (r.inspection_datetime && (!bus.last_inspected_at || r.inspection_datetime > bus.last_inspected_at)) {
      bus.last_inspected_at = r.inspection_datetime;
    }
    if (r.min_tread_mm == null) continue;
    bus.measured_count += 1;
    if (r.min_tread_mm < TYRE_LOW_TREAD_THRESHOLD_MM) bus.past_limit_count += 1;
    if (bus.shallowest_mm == null || r.min_tread_mm < bus.shallowest_mm) {
      bus.shallowest_mm = r.min_tread_mm;
      bus.shallowest_axle_number = r.axle_number;
      bus.shallowest_axle_side = r.axle_side;
      bus.shallowest_wheel_position = r.wheel_position;
      bus.shallowest_tyre_id = r.tyre_id;
      bus.shallowest_serial = r.tyre_serial_number;
    }
  }

  // Shallowest first; buses with no readings at all sort last rather than
  // masquerading as healthy.
  const buses = [...busMap.values()].sort((a, b) => {
    if (a.shallowest_mm == null && b.shallowest_mm == null) return String(a.bus_id).localeCompare(String(b.bus_id));
    if (a.shallowest_mm == null) return 1;
    if (b.shallowest_mm == null) return -1;
    return a.shallowest_mm - b.shallowest_mm;
  });

  const unevenWear = measured
    .filter((r) => r.uneven_wear_type)
    .map((r) => ({
      tyre_id: r.tyre_id,
      tyre_serial_number: r.tyre_serial_number,
      bus_id: r.bus_id,
      bus_route: r.bus_route,
      bus_route_number: r.bus_route_number,
      bus_ev_no: r.bus_ev_no,
      axle_number: r.axle_number,
      axle_side: r.axle_side,
      wheel_position: r.wheel_position,
      uneven_wear_type: r.uneven_wear_type,
      tread_spread_mm: r.tread_spread_mm,
      min_tread_mm: r.min_tread_mm,
    }))
    .sort((a, b) => (b.tread_spread_mm ?? 0) - (a.tread_spread_mm ?? 0));

  return json(200, {
    threshold_mm: TYRE_LOW_TREAD_THRESHOLD_MM,
    fitted_count: fitted.length,
    measured_count: measured.length,
    // Fitted but never inspected. Surfaced rather than hidden, so a small
    // denominator is visible instead of quietly flattering the percentages.
    unmeasured_count: fitted.length - measured.length,
    bus_count: buses.length,
    bands,
    stats,
    buses,
    uneven_wear: unevenWear,
  });
}

async function getTyreSettings(conn, auth) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const days = await getTyreInspectionIntervalDays(conn);
  return json(200, { inspection_interval_days: days });
}

async function updateTyreSettings(conn, auth, b) {
  const deny = requireRole(auth, ["admin", "rm_manager"]);
  if (deny) return deny;

  const days = toWholeNumber(b.inspection_interval_days, "inspection_interval_days");
  if (days <= 0) throw new Error("inspection_interval_days must be a whole number > 0");

  const userId = await getOrCreateUserId(conn, auth);
  await conn.execute(
    `INSERT INTO APP_SETTING (setting_key, setting_value, updated_by) VALUES ('tyre_inspection_interval_days', ?, ?)
     ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by)`,
    [String(days), userId]
  );
  return json(200, { success: true, inspection_interval_days: days });
}

async function createTyreInspectionSession(conn, auth, busId, b) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const tyres = Array.isArray(b.tyres) ? b.tyres : [];
  if (!tyres.length) throw new Error("tyres is required and must be a non-empty array");

  const odometer = b.odometer_reading != null ? toWholeNumber(b.odometer_reading, "odometer_reading") : null;
  const userId = await getOrCreateUserId(conn, auth);

  await conn.beginTransaction();
  try {
    const outOfScope = await assertBusInScope(conn, auth, busId);
    if (outOfScope) { await conn.rollback(); return outOfScope; }

    // axle_side comes back too: tread_position 1 is a fixed edge of the BUS, so
    // which side the wheel is on is what decides whether that is the outboard or
    // the inboard shoulder — and therefore whether a gradient is toe-in or
    // toe-out. Read from TYRE_MOUNTING rather than trusted from the request, so
    // a client cannot hand the server a side that disagrees with where the tyre
    // is actually fitted.
    const [mountedRows] = await conn.execute(
      `SELECT tyre_id, axle_side FROM TYRE_MOUNTING WHERE bus_id=? AND unmounted_at IS NULL`,
      [busId]
    );
    const mountedTyreIds = new Set(mountedRows.map((r) => Number(r.tyre_id)));
    const axleSideByTyre = new Map(mountedRows.map((r) => [Number(r.tyre_id), r.axle_side]));

    const [sessionRes] = await conn.execute(
      `INSERT INTO TYRE_INSPECTION_SESSION (bus_id, technician_user_id, odometer_reading) VALUES (?,?,?)`,
      [busId, userId, odometer]
    );
    const sessionId = sessionRes.insertId;

    for (const entry of tyres) {
      const tyreId = toId(entry.tyre_id, "tyre_id");
      // Tyres are only inspected on a bus. A spare's readings are taken when
      // it is added to stock, and again when it is fitted.
      if (!mountedTyreIds.has(tyreId)) {
        throw new Error(
          `Invalid tyre_id ${tyreId}: tyres can only be inspected while mounted on a bus. Fit it with Tyre Replacement first.`
        );
      }

      const pressure = entry.tyre_pressure != null ? Number(entry.tyre_pressure) : null;
      if (pressure != null && !Number.isFinite(pressure)) throw new Error("Invalid tyre_pressure");
      const retreadCountObserved = entry.retread_count_observed != null
        ? requireRetreadCount(entry.retread_count_observed, "retread_count_observed")
        : null;
      const retreadStickerKey = retreadStickerKeyFor(
        entry.retread_sticker_s3_key, retreadCountObserved, "retread_sticker_s3_key");

      const sidewallCondition = entry.sidewall_condition != null
        ? requireOneOf(entry.sidewall_condition, TYRE_SIDEWALL_CONDITIONS, "sidewall_condition")
        : null;

      // A sidewall marked not-OK has to say what was seen AND show it. "NC" on
      // its own told a reviewer nothing, and a note on its own is one person's
      // word about a casing that may be scrapped before anyone else sees it.
      //
      // The photo used to be optional here, on the reasoning that a failed S3
      // upload must not stop a safety finding being filed. That is now enforced
      // the other way round on purpose: the form will not let a technician reach
      // submit without a photo attached, so an upload failure surfaces at the
      // moment it happens and can be retried, instead of silently producing a
      // finding nobody can verify later.
      let sidewallNote = null;
      let sidewallPhotoKey = null;
      if (sidewallCondition === "not_ok") {
        sidewallNote = entry.sidewall_note ? String(entry.sidewall_note).trim() : "";
        if (!sidewallNote) throw new Error("sidewall_note is required when sidewall_condition is not_ok");
        sidewallNote = sidewallNote.slice(0, 500);
        sidewallPhotoKey = entry.sidewall_photo_s3_key ? String(entry.sidewall_photo_s3_key).trim() : null;
        if (!sidewallPhotoKey) {
          throw new Error("sidewall_photo_s3_key is required when sidewall_condition is not_ok");
        }
      }

      // Readings are parsed BEFORE the inspection row is written, because the
      // verdict is derived from them. They used to be inserted afterwards.
      const treads = Array.isArray(entry.treads) ? entry.treads : [];
      const parsedTreads = treads
        .map((tread) => {
          const pos = toWholeNumber(tread.tread_position, "tread_position");
          if (pos < 1 || pos > 4) throw new Error("tread_position must be between 1 and 4");
          const thickness = Number(tread.tread_thickness_mm);
          if (!Number.isFinite(thickness) || thickness < 0) throw new Error("Invalid tread_thickness_mm");
          return { pos, thickness };
        })
        .sort((a, b2) => a.pos - b2.pos);

      const readings = parsedTreads.map((x) => x.thickness);
      const minTread = readings.length ? Math.min(...readings) : null;
      const { type: unevenWearType, spread } = classifyUnevenWear(
        readings,
        axleSideByTyre.get(tyreId) ?? null,
      );

      // inspection_result is DERIVED, never taken from the request — the
      // technician no longer picks it. Any inspection_result / reject_reason an
      // older app build still sends is ignored rather than rejected, so a phone
      // that hasn't updated keeps working.
      const result = deriveInspectionResult({ minTread, sidewallCondition, unevenWearType });
      const resultReason = describeInspectionResult({ minTread, sidewallCondition, unevenWearType, spread });

      const [inspRes] = await conn.execute(
        `INSERT INTO TYRE_INSPECTION
           (session_id, tyre_id, tyre_pressure, sidewall_condition, sidewall_note,
            sidewall_photo_s3_bucket, sidewall_photo_s3_key,
            retread_count_observed, retread_sticker_s3_bucket, retread_sticker_s3_key,
            uneven_wear_type, tread_spread_mm,
            inspection_result, result_source, reject_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'derived',?)`,
        [
          sessionId,
          tyreId,
          pressure,
          sidewallCondition,
          sidewallNote,
          sidewallPhotoKey ? S3_BUCKET : null,
          sidewallPhotoKey,
          retreadCountObserved,
          retreadStickerKey ? S3_BUCKET : null,
          retreadStickerKey,
          unevenWearType,
          spread,
          result,
          resultReason,
        ]
      );
      const inspectionId = inspRes.insertId;

      // The technician's observed retread count during a routine inspection is
      // the most up-to-date read on the physical tyre, so keep TYRE in step with
      // it. GREATEST means a casing's recorded history can only ever go up.
      if (retreadCountObserved != null) {
        await conn.execute(
          `UPDATE TYRE SET tyre_retread_count=GREATEST(tyre_retread_count, ?) WHERE tyre_id=?`,
          [retreadCountObserved, tyreId]
        );
        // And carry the sticker across, so TYRE always holds the photo backing
        // the count it currently shows. Guarded on the same GREATEST comparison
        // as the count itself: a lower observation does not move the count, so
        // it must not replace the photo either.
        if (retreadStickerKey) {
          await conn.execute(
            `UPDATE TYRE SET retread_sticker_s3_bucket=?, retread_sticker_s3_key=?
             WHERE tyre_id=? AND tyre_retread_count <= ?`,
            [S3_BUCKET, retreadStickerKey, tyreId, retreadCountObserved]
          );
        }
      }

      for (const x of parsedTreads) {
        await conn.execute(
          `INSERT INTO TYRE_TREAD (tyre_inspection_id, tread_position, tread_thickness_mm) VALUES (?,?,?)`,
          [inspectionId, x.pos, x.thickness]
        );
      }

      // NOTE: a derived 'reject' deliberately does NOT retire the tyre.
      //
      // The old code set tyre_status='rejected' here off the technician's manual
      // dropdown. Doing the same off an automatic threshold would take every
      // tyre under 5mm out of service on its next inspection — roughly a quarter
      // of the fleet — and 'rejected' is one of TYRE_UNMOUNTABLE_STATUSES, so
      // they could not be refitted afterwards. Retiring a casing stays a human
      // decision, made through the replacement flow's outgoing_status.
      //
      // Do not "restore" the UPDATE that used to live here.
    }

    await conn.commit();
    return json(200, { session_id: sessionId });
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

async function listBusTyreInspections(conn, auth, busId) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT s.*, u.user_name AS technician_name,
            b.bus_route, b.bus_route_colour, b.bus_route_number, b.bus_ev_no, b.bus_model, b.project_id
     FROM TYRE_INSPECTION_SESSION s
     LEFT JOIN \`USER\` u ON u.user_id = s.technician_user_id
     LEFT JOIN BUS b ON b.bus_id = s.bus_id
     WHERE s.bus_id=?
     ORDER BY s.inspection_datetime DESC, s.tyre_inspection_session_id DESC`,
    [busId]
  );
  return json(200, rows);
}

async function getTyreInspectionSession(conn, auth, sessionId) {
  const deny = requireRole(auth, ["admin", "rm_manager", "technician"]);
  if (deny) return deny;

  const [sessionRows] = await conn.execute(
    `SELECT s.*, u.user_name AS technician_name,
            b.bus_route, b.bus_route_colour, b.bus_route_number, b.bus_ev_no, b.bus_model, b.project_id
     FROM TYRE_INSPECTION_SESSION s
     LEFT JOIN \`USER\` u ON u.user_id = s.technician_user_id
     LEFT JOIN BUS b ON b.bus_id = s.bus_id
     WHERE s.tyre_inspection_session_id=?`,
    [sessionId]
  );
  if (!sessionRows.length) return json(404, { message: "Inspection session not found" });

  // axle_side rides along so the report screen can put a toe finding the right
  // way round: tread_position 1 is a fixed edge of the BUS, so which side the
  // wheel is on decides whether that is the outboard or inboard shoulder.
  //
  // Taken from where the tyre is fitted NOW, not where it was at inspection
  // time, which the schema does not record per inspection. It is only ever used
  // to re-derive a classification the row does not already carry — a pre-014
  // import — and a tyre that has since moved to the other side of the bus is
  // rare enough to be worth the simpler query.
  const [tyreRows] = await conn.execute(
    `SELECT ti.*, t.tyre_serial_number, t.tyre_brand, t.tyre_model,
            m.axle_number, m.axle_side, m.wheel_position
     FROM TYRE_INSPECTION ti
     JOIN TYRE t ON t.tyre_id = ti.tyre_id
     LEFT JOIN TYRE_MOUNTING m ON m.tyre_id = ti.tyre_id AND m.unmounted_at IS NULL
     WHERE ti.session_id=?`,
    [sessionId]
  );

  const inspectionIds = tyreRows.map((r) => r.tyre_inspection_id);
  let treadRows = [];
  if (inspectionIds.length) {
    const placeholders = inspectionIds.map(() => "?").join(",");
    const [tRows] = await conn.execute(
      `SELECT * FROM TYRE_TREAD WHERE tyre_inspection_id IN (${placeholders}) ORDER BY tread_position ASC`,
      inspectionIds
    );
    treadRows = tRows;
  }

  const treadsByInspection = new Map();
  for (const t of treadRows) {
    const list = treadsByInspection.get(t.tyre_inspection_id) ?? [];
    list.push(t);
    treadsByInspection.set(t.tyre_inspection_id, list);
  }

  const tyres = tyreRows.map((r) => ({ ...r, treads: treadsByInspection.get(r.tyre_inspection_id) ?? [] }));

  return json(200, { ...sessionRows[0], tyres });
}

// ===================== SCHEDULED TASKS =====================

// Invoked by EventBridge, not by a user. There is no auth context here, so
// every query runs fleet-wide and results are grouped by project before
// notifying — the per-project recipients are then resolved the same way an
// HTTP-triggered notification resolves them.

const TYRE_DIGEST_QUIET_DAYS = 7;

/**
 * Has this exact alerting set already gone out recently?
 *
 * Returns true (and records the send) when it should be sent. An unchanged set
 * produces the same key and stays quiet; any change produces a new key and
 * alerts immediately.
 */
async function shouldSendDigest(conn, dedupeKey) {
  try {
    const [rows] = await conn.execute(
      `SELECT last_sent_at FROM NOTIFICATION_DEDUPE
       WHERE dedupe_key=? AND last_sent_at > (NOW() - INTERVAL ? DAY) LIMIT 1`,
      [dedupeKey, TYRE_DIGEST_QUIET_DAYS]
    );
    if (rows.length) return false;

    await conn.execute(
      `INSERT INTO NOTIFICATION_DEDUPE (dedupe_key, last_sent_at) VALUES (?, NOW())
       ON DUPLICATE KEY UPDATE last_sent_at = NOW()`,
      [dedupeKey]
    );
    return true;
  } catch (e) {
    // A dedupe failure must not suppress a genuine alert, so fail open.
    plog("digest.dedupe.fail", { dedupeKey, ...errFields(e) });
    return true;
  }
}

async function runTyreDigest(conn) {
  const intervalDays = await getTyreInspectionIntervalDays(conn);

  const [overdueRows] = await conn.execute(
    `SELECT b.bus_id, b.project_id, b.bus_route,
            DATEDIFF(NOW(), s.last_inspected_at) AS days_since_inspection
     FROM BUS b
     LEFT JOIN (
       SELECT bus_id, MAX(inspection_datetime) AS last_inspected_at
       FROM TYRE_INSPECTION_SESSION GROUP BY bus_id
     ) s ON s.bus_id = b.bus_id
     WHERE s.last_inspected_at IS NULL OR DATEDIFF(NOW(), s.last_inspected_at) > ?`,
    [intervalDays]
  );

  const [lowRows] = await conn.execute(
    `SELECT t.tyre_id, t.tyre_serial_number, m.bus_id, b.project_id, latest.min_tread_mm
     FROM TYRE t
     JOIN (${LATEST_TYRE_INSPECTION_SQL}) latest ON latest.tyre_id = t.tyre_id
     JOIN TYRE_MOUNTING m ON m.tyre_id = t.tyre_id AND m.unmounted_at IS NULL
     LEFT JOIN BUS b ON b.bus_id = m.bus_id
     WHERE latest.min_tread_mm < ?`,
    [TYRE_LOW_TREAD_THRESHOLD_MM]
  );

  // Group both findings by project so each manager hears only about their own.
  const byProject = new Map();
  const bucket = (projectId) => {
    const key = projectId ?? "__none__";
    if (!byProject.has(key)) byProject.set(key, { projectId: projectId ?? null, buses: [], tyres: [] });
    return byProject.get(key);
  };
  for (const r of overdueRows) bucket(r.project_id).buses.push(r);
  for (const r of lowRows) bucket(r.project_id).tyres.push(r);

  plog("digest.scan", {
    intervalDays,
    overdueBuses: overdueRows.length,
    lowTreadTyres: lowRows.length,
    projects: byProject.size,
  });

  let sent = 0;
  let skipped = 0;

  for (const group of byProject.values()) {
    if (!group.buses.length && !group.tyres.length) continue;

    const busIds = group.buses.map((b) => String(b.bus_id)).sort();
    const tyreIds = group.tyres.map((t) => String(t.tyre_id)).sort();
    const fingerprint = crypto
      .createHash("sha1")
      .update(`${busIds.join(",")}|${tyreIds.join(",")}`)
      .digest("hex");
    const dedupeKey = `tyre_digest:${group.projectId ?? "none"}:${fingerprint}`;

    if (!(await shouldSendDigest(conn, dedupeKey))) {
      skipped += 1;
      plog("digest.skip", { projectId: group.projectId, reason: "unchanged", dedupeKey });
      continue;
    }

    const parts = [];
    if (group.buses.length) {
      parts.push(`${group.buses.length} bus${group.buses.length === 1 ? "" : "es"} overdue for tyre inspection`);
    }
    if (group.tyres.length) {
      const worst = Math.min(...group.tyres.map((t) => Number(t.min_tread_mm)));
      parts.push(
        `${group.tyres.length} tyre${group.tyres.length === 1 ? "" : "s"} below ${TYRE_LOW_TREAD_THRESHOLD_MM}mm (lowest ${worst}mm)`
      );
    }

    const busList = group.buses.slice(0, 5).map((b) => b.bus_id).join(", ");
    await notifyUsersByRole(conn, {
      roles: ["admin", "rm_manager", "fleet_manager"],
      projectId: group.projectId,
      type: "tyre_digest",
      title: "Tyre attention needed",
      body:
        parts.join(" · ") +
        (busList ? `. Buses: ${busList}${group.buses.length > 5 ? "…" : ""}` : ""),
    });
    sent += 1;
  }

  // Keep the dedupe table from growing without bound.
  try {
    await conn.execute("DELETE FROM NOTIFICATION_DEDUPE WHERE last_sent_at < (NOW() - INTERVAL 90 DAY)");
  } catch (e) {
    plog("digest.prune.fail", errFields(e));
  }

  plog("digest.done", { sent, skipped });
  return { sent, skipped, overdueBuses: overdueRows.length, lowTreadTyres: lowRows.length };
}

async function runScheduledTask(conn, event) {
  const task = event?.task ?? "tyre_daily";
  plog("scheduled.start", { task });
  try {
    // Queued by dispatchPush(). Only reachable from an async self-invoke: the
    // handler's requestContext guard keeps this branch off the HTTP API.
    if (task === "push") {
      const p = event?.push ?? {};
      const userIds = Array.isArray(p.userIds) ? p.userIds.map(Number).filter(Number.isInteger) : [];
      await sendExpoPushNotifications(conn, {
        userIds,
        title: p.title,
        body: p.body ?? null,
        data: p.data ?? {},
      });
      return json(200, { task, userIds: userIds.length });
    }
    if (task === "tyre_daily") {
      const result = await runTyreDigest(conn);
      return json(200, { task, ...result });
    }
    if (task === "puspakom_tick") {
      const result = await runPuspakomTick(conn);
      return json(200, { task, ...result });
    }
    plog("scheduled.unknown", { task });
    return json(400, { message: `Unknown scheduled task: ${task}` });
  } catch (e) {
    plog("scheduled.fail", { task, ...errFields(e) });
    return json(500, { message: e?.message ?? "Scheduled task failed" });
  }
}

// ===================== REPORT MEDIA =====================

async function listReportMedia(conn, auth, reportId) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver"]);
  if (deny) return deny;

  if (auth.role === "driver") {
    const userId = await getOrCreateUserId(conn, auth);
    const [r] = await conn.execute("SELECT user_id FROM REPORT WHERE report_id=?", [reportId]);
    if (!r?.length) return json(404, { message: "report_id not found" });
    if (Number(r[0].user_id) !== userId) return json(403, { message: "Forbidden" });
  }

  const [rows] = await conn.execute(
    `SELECT media_id, report_id, media_type, mime_type, s3_bucket, s3_key, size_bytes, media_duration, uploaded_at
     FROM REPORT_MEDIA WHERE report_id=? ORDER BY uploaded_at DESC, media_id DESC`,
    [reportId]
  );

  const enriched = await Promise.all(
    (rows || []).map(async (m) => {
      try {
        const cmd = new GetObjectCommand({ Bucket: m.s3_bucket || S3_BUCKET, Key: m.s3_key });
        const viewUrl = await getSignedUrl(s3, cmd, { expiresIn: VIEW_URL_TTL_S });
        return { ...m, viewUrl };
      } catch (e) {
        console.error("Failed signing media", m?.s3_key, e);
        return { ...m, viewUrl: null };
      }
    })
  );

  return json(200, enriched);
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "video/mp4") return "mp4";
  return "bin";
}

// Signing is a local crypto computation (no network call), so this is cheap
// to run per-row even across a 200-row list — same reasoning behind the
// existing per-media-item Promise.all signing below.
// How long a photo/selfie link stays valid. It was 5 minutes, so a screen
// left open while walking to the bus showed broken images on return.
const VIEW_URL_TTL_S = 3600;

async function signS3Url(bucket, key) {
  if (!bucket || !key) return null;
  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    return await getSignedUrl(s3, cmd, { expiresIn: VIEW_URL_TTL_S });
  } catch (e) {
    console.error("Failed signing selfie url", key, e);
    return null;
  }
}

async function presignReportMedia(conn, auth, reportId, qs) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver"]);
  if (deny) return deny;

  const mime = (qs.mime ?? "").toString().trim();
  if (!mime) throw new Error("mime required");

  const [rows] = await conn.execute("SELECT report_id, user_id FROM REPORT WHERE report_id=?", [reportId]);
  if (!rows?.length) throw new Error("report_id not found");

  if (auth.role === "driver") {
    const userId = await getOrCreateUserId(conn, auth);
    if (Number(rows[0].user_id) !== userId) return json(403, { message: "Forbidden" });
  }

  const ext = extFromMime(mime);
  const key = `reports/${reportId}/${crypto.randomUUID()}.${ext}`;
  const cmd = new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: mime });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });

  return json(200, { uploadUrl, s3_bucket: S3_BUCKET, s3_key: key });
}

async function confirmReportMedia(conn, auth, reportId, b) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver"]);
  if (deny) return deny;

  if (!b.s3_key) throw new Error("s3_key required");
  if (!b.mime_type) throw new Error("mime_type required");

  const [rows] = await conn.execute("SELECT report_id, user_id FROM REPORT WHERE report_id=?", [reportId]);
  if (!rows?.length) throw new Error("report_id not found");

  if (auth.role === "driver") {
    const userId = await getOrCreateUserId(conn, auth);
    if (Number(rows[0].user_id) !== userId) return json(403, { message: "Forbidden" });
  }

  const mediaType = b.mime_type.toString().startsWith("video") ? "video" : "image";
  await conn.execute(
    `INSERT INTO REPORT_MEDIA (report_id, media_type, mime_type, s3_bucket, s3_key, size_bytes, uploaded_at) VALUES (?,?,?,?,?,?,NOW())`,
    [reportId, mediaType, b.mime_type, S3_BUCKET, b.s3_key, b.size_bytes ?? null]
  );
  return json(200, { success: true });
}

// A separate presign/confirm pair (rather than reusing REPORT_MEDIA) since a
// selfie isn't a gallery photo of the bus — it's identity-verification data
// that lives directly on the REPORT row (one per report, not a list).
async function presignReportSelfie(conn, auth, reportId, qs) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver"]);
  if (deny) return deny;

  const mime = (qs.mime ?? "").toString().trim();
  if (!mime) throw new Error("mime required");

  const [rows] = await conn.execute("SELECT report_id, user_id FROM REPORT WHERE report_id=?", [reportId]);
  if (!rows?.length) throw new Error("report_id not found");

  if (auth.role === "driver") {
    const userId = await getOrCreateUserId(conn, auth);
    if (Number(rows[0].user_id) !== userId) return json(403, { message: "Forbidden" });
  }

  const ext = extFromMime(mime);
  const key = `reports/${reportId}/selfie/${crypto.randomUUID()}.${ext}`;
  const cmd = new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: mime });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });

  return json(200, { uploadUrl, s3_bucket: S3_BUCKET, s3_key: key });
}

async function confirmReportSelfie(conn, auth, reportId, b) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver"]);
  if (deny) return deny;

  if (!b.s3_key) throw new Error("s3_key required");
  if (!b.mime_type) throw new Error("mime_type required");
  const verifiedName = (b.verified_name ?? "").toString().trim();
  if (!verifiedName) throw new Error("verified_name is required");

  const [rows] = await conn.execute("SELECT report_id, user_id FROM REPORT WHERE report_id=?", [reportId]);
  if (!rows?.length) throw new Error("report_id not found");

  // The submission sign-off belongs to whoever filed the report — any other
  // account could previously replace it.
  if (auth.role !== "admin") {
    const userId = await getOrCreateUserId(conn, auth);
    if (Number(rows[0].user_id) !== userId) return json(403, { message: "Forbidden" });
  }

  await conn.execute(
    `UPDATE REPORT SET report_verified_name=?, report_selfie_s3_bucket=?, report_selfie_s3_key=? WHERE report_id=?`,
    [verifiedName, S3_BUCKET, b.s3_key, reportId]
  );
  return json(200, { success: true });
}

// ===================== JOB MEDIA =====================

async function listJobMedia(conn, auth, jobId, qs) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const untaggedOnly = qs?.task_id === "none";
  const taskId = !untaggedOnly && qs?.task_id != null ? toId(qs.task_id, "task_id") : null;
  const where = untaggedOnly
    ? "job_id=? AND task_id IS NULL"
    : taskId != null
      ? "job_id=? AND task_id=?"
      : "job_id=?";
  const vals = taskId != null ? [jobId, taskId] : [jobId];

  const [rows] = await conn.execute(
    `SELECT media_id, job_id, task_id, media_type, mime_type, s3_bucket, s3_key, size_bytes, media_duration, uploaded_at
     FROM JOB_MEDIA WHERE ${where} ORDER BY uploaded_at DESC, media_id DESC`,
    vals
  );

  const enriched = await Promise.all(
    (rows || []).map(async (m) => {
      try {
        const cmd = new GetObjectCommand({ Bucket: m.s3_bucket || S3_BUCKET, Key: m.s3_key });
        const viewUrl = await getSignedUrl(s3, cmd, { expiresIn: VIEW_URL_TTL_S });
        return { ...m, viewUrl };
      } catch (e) {
        console.error("Failed signing media", m?.s3_key, e);
        return { ...m, viewUrl: null };
      }
    })
  );

  return json(200, enriched);
}

async function presignJobMedia(conn, auth, jobId, qs) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const lock = await assertTechJobUnlocked(conn, auth, jobId);
  if (lock) return lock;

  const mime = (qs.mime ?? "").toString().trim();
  if (!mime) throw new Error("mime required");

  const [j] = await conn.execute("SELECT job_id FROM JOB WHERE job_id=?", [jobId]);
  if (!j?.length) throw new Error("job_id not found");

  const taskId = qs?.task_id != null ? toId(qs.task_id, "task_id") : null;
  const ext = extFromMime(mime);
  const key = taskId != null
    ? `jobs/${jobId}/tasks/${taskId}/${crypto.randomUUID()}.${ext}`
    : `jobs/${jobId}/${crypto.randomUUID()}.${ext}`;
  const cmd = new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: mime });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
  return json(200, { uploadUrl, s3_bucket: S3_BUCKET, s3_key: key });
}

async function confirmJobMedia(conn, auth, jobId, b) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const lock = await assertTechJobUnlocked(conn, auth, jobId);
  if (lock) return lock;

  if (!b.s3_key) throw new Error("s3_key required");
  if (!b.mime_type) throw new Error("mime_type required");

  const [j] = await conn.execute("SELECT job_id FROM JOB WHERE job_id=?", [jobId]);
  if (!j?.length) throw new Error("job_id not found");

  let taskId = null;
  if (b.task_id != null) {
    taskId = toId(b.task_id, "task_id");
    const [t] = await conn.execute("SELECT task_id FROM JOB_TASK WHERE task_id=? AND job_id=?", [taskId, jobId]);
    if (!t?.length) throw new Error("task_id does not belong to this job");
  }

  const mediaType = b.mime_type.toString().startsWith("video") ? "video" : "image";
  await conn.execute(
    `INSERT INTO JOB_MEDIA (job_id, task_id, media_type, mime_type, s3_bucket, s3_key, size_bytes, uploaded_at) VALUES (?,?,?,?,?,?,?,NOW())`,
    [jobId, taskId, mediaType, b.mime_type, S3_BUCKET, b.s3_key, b.size_bytes ?? null]
  );
  return json(200, { success: true });
}

// Same reasoning as the report selfie pair above — a dedicated presign/
// confirm pair writing straight onto the JOB row's own columns, not another
// JOB_MEDIA row, since there's exactly one completion selfie per job.
async function presignJobSelfie(conn, auth, jobId, qs) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const lock = await assertTechJobUnlocked(conn, auth, jobId);
  if (lock) return lock;

  const mime = (qs.mime ?? "").toString().trim();
  if (!mime) throw new Error("mime required");

  const [j] = await conn.execute("SELECT job_id FROM JOB WHERE job_id=?", [jobId]);
  if (!j?.length) throw new Error("job_id not found");

  const ext = extFromMime(mime);
  const key = `jobs/${jobId}/selfie/${crypto.randomUUID()}.${ext}`;
  const cmd = new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: mime });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
  return json(200, { uploadUrl, s3_bucket: S3_BUCKET, s3_key: key });
}

async function confirmJobSelfie(conn, auth, jobId, b) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const lock = await assertTechJobUnlocked(conn, auth, jobId);
  if (lock) return lock;

  if (!b.s3_key) throw new Error("s3_key required");
  if (!b.mime_type) throw new Error("mime_type required");
  const verifiedName = (b.verified_name ?? "").toString().trim();
  if (!verifiedName) throw new Error("verified_name is required");

  const [j] = await conn.execute("SELECT job_id FROM JOB WHERE job_id=?", [jobId]);
  if (!j?.length) throw new Error("job_id not found");

  await conn.execute(
    `UPDATE JOB SET job_verified_name=?, job_selfie_s3_bucket=?, job_selfie_s3_key=? WHERE job_id=?`,
    [verifiedName, S3_BUCKET, b.s3_key, jobId]
  );
  return json(200, { success: true });
}

// Selfie upload for the two sign-offs that happen *as part of* another call:
// approving a report (kind=report-review) and accepting a job
// (kind=job-accept). Only the upload URL is issued here; the returned key is
// sent with the approve/accept request, which stores it together with the
// typed name in the same write as the action itself.
async function presignVerificationSelfie(conn, auth, qs) {
  const kind = (qs.kind ?? "").toString().trim();
  const id = toId(qs.id, "id");
  const mime = (qs.mime ?? "").toString().trim();
  if (!mime) throw new Error("mime required");

  let key;
  if (kind === "report-review") {
    const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager"]);
    if (deny) return deny;
    const [r] = await conn.execute("SELECT report_id FROM REPORT WHERE report_id=?", [id]);
    if (!r?.length) return json(404, { message: "Report not found" });
    key = `reports/${id}/review-selfie/${crypto.randomUUID()}.${extFromMime(mime)}`;
  } else if (kind === "job-accept") {
    const deny = requireRole(auth, ["admin", "technician"]);
    if (deny) return deny;
    const [j] = await conn.execute("SELECT technician_user_id FROM JOB WHERE job_id=?", [id]);
    if (!j?.length) return json(404, { message: "Job not found" });
    if (j[0].technician_user_id != null) {
      const me = await getOrCreateUserId(conn, auth);
      if (Number(j[0].technician_user_id) !== me) {
        return json(409, { code: "JOB_TAKEN", message: "This job was already accepted by another technician." });
      }
    }
    key = `jobs/${id}/accept-selfie/${crypto.randomUUID()}.${extFromMime(mime)}`;
  } else {
    return json(400, { message: "kind must be report-review or job-accept" });
  }

  const cmd = new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: mime });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
  return json(200, { uploadUrl, s3_bucket: S3_BUCKET, s3_key: key });
}

// ===================== NOTIFICATIONS =====================

const ALL_ROLES = ["admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver"];

async function listNotifications(conn, auth, qs) {
  const deny = requireRole(auth, ALL_ROLES);
  if (deny) return deny;

  const userId = await getOrCreateUserId(conn, auth);
  const where = ["user_id=?"];
  const vals = [userId];
  if (qs?.unread === "1") where.push("is_read=0");

  const [rows] = await conn.execute(
    // * rather than a column list so puspakom_inspection_id (migration 024)
    // comes through once it exists, without breaking before it does.
    `SELECT *
     FROM NOTIFICATION
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC, notification_id DESC
     LIMIT 100`,
    vals
  );
  return json(200, rows);
}

async function getUnreadNotificationCount(conn, auth) {
  const deny = requireRole(auth, ALL_ROLES);
  if (deny) return deny;

  const userId = await getOrCreateUserId(conn, auth);
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM NOTIFICATION WHERE user_id=? AND is_read=0`,
    [userId]
  );
  return json(200, { count: Number(rows[0]?.cnt ?? 0) });
}

async function markNotificationRead(conn, auth, notificationId) {
  const deny = requireRole(auth, ALL_ROLES);
  if (deny) return deny;

  const userId = await getOrCreateUserId(conn, auth);
  await conn.execute(
    `UPDATE NOTIFICATION SET is_read=1 WHERE notification_id=? AND user_id=?`,
    [notificationId, userId]
  );
  return json(200, { success: true });
}

async function markAllNotificationsRead(conn, auth) {
  const deny = requireRole(auth, ALL_ROLES);
  if (deny) return deny;

  const userId = await getOrCreateUserId(conn, auth);
  await conn.execute(
    `UPDATE NOTIFICATION SET is_read=1 WHERE user_id=? AND is_read=0`,
    [userId]
  );
  return json(200, { success: true });
}

// ===================== PUSPAKOM RULES (pure) =====================
//
// Everything between this marker and "END PUSPAKOM RULES" is pure: no DB, no
// S3, no globals from the rest of the file. lambda/scripts/test_puspakom_rules.mjs
// cuts this block out and tests it on its own, so keep it that way.
//
// Dates are "YYYY-MM-DD" strings in Malaysia time (UTC+8): due dates and
// result dates are calendar days, and comparing strings avoids timezone bugs.

const PSP_MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

const PSP_STATUS = Object.freeze({
  NOT_DUE: "NOT_DUE",
  NOT_BOOKED: "NOT_BOOKED",
  OVERDUE_NOT_BOOKED: "OVERDUE_NOT_BOOKED",
  BOOKED: "BOOKED",
  OVERDUE_BOOKED: "OVERDUE_BOOKED",
  PRECHECK_DONE: "PRECHECK_DONE",
  INSPECTED_UPDATE: "INSPECTED_UPDATE",
  FAILED_PENDING: "FAILED_PENDING",
});

const PSP_DEFAULT_SETTINGS = Object.freeze({
  cycleMonths: 6,
  notBookedDays: 60,
  treadMinMm: 6.0,
  pressureTargetPsi: 120,
  pressureLowPct: 90,
  padReplaceMm: 3.0,
  padCheckMm: 5.0,
});

const PSP_NG_REASONS = ["NOT_WORKING", "FLICKERING", "CRACKED", "LOOSE", "OTHER"];
const PSP_DAMAGE_TYPES = ["SCRATCH", "DENT", "CRACK", "PAINT"];
const PSP_ATTENTION_TAGS = ["NG", "REPLACE", "LOW", "CHECK_SOON", "DAMAGE"];

/** Calendar date in Malaysia time of an instant, as "YYYY-MM-DD". */
function pspMytDate(instant) {
  const t = new Date(new Date(instant).getTime() + PSP_MYT_OFFSET_MS);
  return t.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" + n calendar months; a day that doesn't exist becomes the month's last day. */
function pspAddMonths(dateStr, months) {
  const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

function pspAddDays(dateStr, days) {
  const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
function pspDaysBetween(a, b) {
  const ms = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** Next due = last Passed periodic/re-inspection result + the cycle. null when the bus has never passed. */
function pspNextDue(lastPassDate, cycleMonths = PSP_DEFAULT_SETTINGS.cycleMonths) {
  return lastPassDate ? pspAddMonths(lastPassDate, cycleMonths) : null;
}

/**
 * The one status a bus has right now (spec p.24).
 *   nextDue   "YYYY-MM-DD" or null (never passed: the bus starts as Not booked)
 *   open      the open inspection (no result yet) or null:
 *             { type, scheduledAt (Date|ISO), preSubmitted (bool) }
 *   now       Date
 */
function pspBusStatus({ nextDue, open, now, notBookedDays = PSP_DEFAULT_SETTINGS.notBookedDays }) {
  const today = pspMytDate(now);
  if (open) {
    const at = new Date(open.scheduledAt);
    if (now.getTime() >= at.getTime()) return PSP_STATUS.INSPECTED_UPDATE;
    if (open.type === "REINSPECTION") return PSP_STATUS.FAILED_PENDING;
    if (open.preSubmitted) return PSP_STATUS.PRECHECK_DONE;
    const overdue = nextDue != null && (today > nextDue || pspMytDate(at) > nextDue);
    return overdue ? PSP_STATUS.OVERDUE_BOOKED : PSP_STATUS.BOOKED;
  }
  if (!nextDue) return PSP_STATUS.NOT_BOOKED;
  if (today > nextDue) return PSP_STATUS.OVERDUE_NOT_BOOKED;
  if (pspDaysBetween(today, nextDue) <= notBookedDays) return PSP_STATUS.NOT_BOOKED;
  return PSP_STATUS.NOT_DUE;
}

/** The three schedule counts plus the Fleet Manager's home-row count. */
function pspCounts(statuses) {
  const n = (...keys) => statuses.filter((s) => keys.includes(s)).length;
  return {
    overdue: n(PSP_STATUS.OVERDUE_NOT_BOOKED, PSP_STATUS.OVERDUE_BOOKED),
    need_booking: n(PSP_STATUS.NOT_BOOKED),
    booked: n(
      PSP_STATUS.BOOKED,
      PSP_STATUS.OVERDUE_BOOKED,
      PSP_STATUS.PRECHECK_DONE,
      PSP_STATUS.INSPECTED_UPDATE,
      PSP_STATUS.FAILED_PENDING
    ),
    action: n(PSP_STATUS.OVERDUE_NOT_BOOKED, PSP_STATUS.NOT_BOOKED, PSP_STATUS.INSPECTED_UPDATE),
  };
}

/** Technician card pill and tab (spec p.41). kind: "PRE" | "RECHECK". */
function pspTechPill({ kind, answered = 0, submitted = false }) {
  if (kind === "RECHECK") {
    return submitted ? { pill: "RECHECK_SUBMITTED", tab: "DONE" } : { pill: "RECHECK_TODO", tab: "TODO" };
  }
  if (submitted) return { pill: "SUBMITTED", tab: "DONE" };
  if (answered > 0) return { pill: "IN_PROGRESS", tab: "TODO" };
  return { pill: "PRECHECK_TODO", tab: "TODO" };
}

function pspNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Check the numbers on one answer are in range. Throws "Invalid …: Check the
 * number" (→ 400) for anything the phone should already have refused.
 */
function pspValidateNumbers(a) {
  const tread = pspNum(a.tread_mm);
  const psi = pspNum(a.pressure_psi);
  const pad = pspNum(a.pad_mm);
  if (tread !== null && !(tread >= 0 && tread <= 25)) throw new Error(`Invalid tread_mm for ${a.check_id}: Check the number`);
  if (psi !== null && !(Number.isInteger(psi) && psi >= 0 && psi <= 200)) throw new Error(`Invalid pressure_psi for ${a.check_id}: Check the number`);
  if (pad !== null && !(pad >= 0 && pad <= 30)) throw new Error(`Invalid pad_mm for ${a.check_id}: Check the number`);
  return { tread, psi, pad };
}

/** Tag for one answer (spec p.42 number bands). null = nothing entered yet. */
function pspAnswerTag(answerType, a, s = PSP_DEFAULT_SETTINGS) {
  if (answerType === "OK_NG") return a.answer === "NG" ? "NG" : a.answer === "OK" ? "OK" : null;
  if (answerType === "BODY") return a.answer === "DAMAGE" ? "DAMAGE" : a.answer === "NO_DAMAGE" ? "OK" : null;
  if (answerType === "BRAKE") {
    const pad = pspNum(a.pad_mm);
    if (pad === null || Number.isNaN(pad)) return null;
    if (pad < s.padReplaceMm) return "REPLACE";
    if (pad <= s.padCheckMm) return "CHECK_SOON";
    return "OK";
  }
  if (answerType === "TYRE") {
    const tread = pspNum(a.tread_mm);
    const psi = pspNum(a.pressure_psi);
    const hasTread = tread !== null && !Number.isNaN(tread);
    const hasPsi = psi !== null && !Number.isNaN(psi);
    if (!hasTread && !hasPsi) return null;
    if (hasTread && tread < s.treadMinMm) return "REPLACE";
    if (hasPsi && psi < (s.pressureTargetPsi * s.pressureLowPct) / 100) return "LOW";
    return "OK";
  }
  return null;
}

function pspDamageComplete(d) {
  return (
    d &&
    Number.isFinite(Number(d.x_pct)) &&
    Number.isFinite(Number(d.y_pct)) &&
    String(d.where ?? "").trim() !== "" &&
    PSP_DAMAGE_TYPES.includes(d.type) &&
    !!d.photo_s3_key
  );
}

/** Is this row done (spec p.42 "Row is done when")? */
function pspAnswerDone(answerType, a) {
  if (!a || !a.photo_s3_key) return false;
  if (answerType === "OK_NG") {
    if (a.answer === "OK") return true;
    if (a.answer !== "NG" || !PSP_NG_REASONS.includes(a.ng_reason)) return false;
    return a.ng_reason !== "OTHER" || String(a.note ?? "").trim() !== "";
  }
  if (answerType === "TYRE") return pspNum(a.tread_mm) !== null && pspNum(a.pressure_psi) !== null;
  if (answerType === "BRAKE") return pspNum(a.pad_mm) !== null;
  if (answerType === "BODY") {
    if (a.answer === "NO_DAMAGE") return true;
    // Every pin placed must be finished: a half-entered damage is not a record.
    const list = Array.isArray(a.damages) ? a.damages : [];
    return a.answer === "DAMAGE" && list.length > 0 && list.every(pspDamageComplete);
  }
  return false;
}

/** SKSC-PKR-YYYY-MM-DD-XX for the n-th first inspection on that MYT day. */
function pspRefNo(firstInspectionDate, n) {
  return `SKSC-PKR-${String(firstInspectionDate).slice(0, 10)}-${String(n).padStart(2, "0")}`;
}

// ===================== END PUSPAKOM RULES =====================

// ===================== PUSPAKOM =====================
//
// Fleet Manager registers bookings and records results; technicians do the
// 44-check pre-inspection and the re-check after a fail; the R&M Manager can
// only look. Every bus's status is worked out from the rows on each read
// (pspBusStatus above), never stored.

const PSP_FM_ROLES = ["admin", "fleet_manager"];
const PSP_TECH_ROLES = ["admin", "technician"];
const PSP_SCHEDULE_ROLES = ["admin", "fleet_manager", "rm_manager"];
const PSP_VIEW_ROLES = ["admin", "fleet_manager", "rm_manager", "technician"];
const PSP_MEDIA_KINDS = ["selfie", "check", "damage", "slip", "fix"];
const PSP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PSP_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PSP_TYPE_LABEL = { PERIODIC: "Periodic", REINSPECTION: "Re-inspection", SPECIAL: "Special" };

const isPspInspectionPath = (p) => /^\/puspakom\/inspections\/\d+$/.test(p);
const pspInspectionSubPath = (p, sub) => new RegExp(`^/puspakom/inspections/\\d+/${sub}$`).test(p);
const pspInspectionIdFromPath = (params, path) =>
  getIdFromParamsOrPath(params.inspection_id, path, /^\/puspakom\/inspections\/(\d+)/);

/** "Wed, 18 Nov 2026 · 10:30 am" in Malaysia time. */
function pspFmtDateTime(instant) {
  const t = new Date(new Date(instant).getTime() + PSP_MYT_OFFSET_MS);
  const h24 = t.getUTCHours();
  const h = h24 % 12 || 12;
  return `${PSP_DAYS[t.getUTCDay()]}, ${t.getUTCDate()} ${PSP_MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()} · ${h}:${String(t.getUTCMinutes()).padStart(2, "0")} ${h24 >= 12 ? "pm" : "am"}`;
}

/** "Wed, 18 Nov 2026" for a "YYYY-MM-DD" date. */
function pspFmtDate(dateStr) {
  if (!dateStr) return "—";
  const t = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  return `${PSP_DAYS[t.getUTCDay()]}, ${t.getUTCDate()} ${PSP_MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** DATE columns come back as a Date at UTC midnight (the Lambda runs in UTC). */
function pspDateStr(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function pspIso(v) {
  return v == null ? null : new Date(v).toISOString();
}

function pspParseInstant(v, name) {
  const d = new Date(String(v ?? ""));
  if (v == null || v === "" || Number.isNaN(d.getTime())) throw new Error(`Invalid ${name}`);
  return d;
}

function pspParseDate(v, name) {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new Error(`Invalid ${name}`);
  return s;
}

function pspText(v, max, name) {
  const s = String(v ?? "").trim();
  if (s.length > max) throw new Error(`Invalid ${name}: at most ${max} characters`);
  return s || null;
}

function pspKeyPrefix(busId) {
  return `puspakom/${safeFilePart(busId) || "BUS"}/`;
}

/** Only accept S3 keys this bus's presign could have issued. */
function pspCheckKey(key, busId, name) {
  if (key == null || key === "") return null;
  const k = String(key);
  if (!k.startsWith(pspKeyPrefix(busId)) || k.includes("..") || k.length > 512) throw new Error(`Invalid ${name}`);
  return k;
}

function pspSignoff(b, busId) {
  const name = String(b?.verified_name ?? "").trim();
  if (!name) throw new Error("verified_name required");
  if (name.length > 150) throw new Error("Invalid verified_name");
  const key = pspCheckKey(b?.selfie_s3_key, busId, "selfie_s3_key");
  if (!key) throw new Error("selfie_s3_key required");
  return { name, key };
}

function pspJsonArr(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

async function pspSettings(conn) {
  const [rows] = await conn.execute(
    "SELECT setting_key, setting_value FROM APP_SETTING WHERE setting_key LIKE 'puspakom\\_%'"
  );
  const m = Object.fromEntries(rows.map((r) => [r.setting_key, Number(r.setting_value)]));
  const pick = (k, d) => (Number.isFinite(m[k]) ? m[k] : d);
  const D = PSP_DEFAULT_SETTINGS;
  return {
    cycleMonths: pick("puspakom_cycle_months", D.cycleMonths),
    notBookedDays: pick("puspakom_not_booked_days", D.notBookedDays),
    treadMinMm: pick("puspakom_tread_min_mm", D.treadMinMm),
    pressureTargetPsi: pick("puspakom_pressure_target_psi", D.pressureTargetPsi),
    pressureLowPct: pick("puspakom_pressure_low_pct", D.pressureLowPct),
    padReplaceMm: pick("puspakom_pad_replace_mm", D.padReplaceMm),
    padCheckMm: pick("puspakom_pad_check_mm", D.padCheckMm),
  };
}

/** Stops and checks for a bus model: the model's own rows if it has any, else the '*' set. */
async function pspDefs(conn, busModel, cache = null) {
  const model = String(busModel ?? "").trim();
  if (cache?.has(model)) return cache.get(model);
  const [own] = await conn.execute("SELECT COUNT(*) AS n FROM PUSPAKOM_CHECK_DEF WHERE bus_model=?", [model]);
  const use = model && Number(own[0]?.n) > 0 ? model : "*";
  const [stops] = await conn.execute(
    `SELECT stop_no, stop_name, stop_where, helper_top, helper_end, has_drawing
     FROM PUSPAKOM_STOP_DEF WHERE bus_model=? ORDER BY stop_no`,
    [use]
  );
  const [checks] = await conn.execute(
    `SELECT check_id, stop_no, sort_no, answer_type, label, ok_if, photo_hint, puspakom_item, pin_x_pct, pin_y_pct
     FROM PUSPAKOM_CHECK_DEF WHERE bus_model=? ORDER BY sort_no`,
    [use]
  );
  const out = {
    stops: stops.map((s) => ({ ...s, has_drawing: !!s.has_drawing })),
    checks: checks.map((c) => ({
      ...c,
      pin_x_pct: c.pin_x_pct == null ? null : Number(c.pin_x_pct),
      pin_y_pct: c.pin_y_pct == null ? null : Number(c.pin_y_pct),
    })),
    byId: new Map(checks.map((c) => [c.check_id, c])),
  };
  cache?.set(model, out);
  return out;
}

async function pspEvent(conn, { inspectionId, rootId, type, actorId = null, at = null, detail = null }) {
  await conn.execute(
    `INSERT INTO PUSPAKOM_EVENT (inspection_id, root_inspection_id, event_type, actor_user_id, event_at, detail)
     VALUES (?,?,?,?,?,?)`,
    [inspectionId, rootId, type, actorId, at ?? new Date(), detail ? JSON.stringify(detail) : null]
  );
}

function pspPlaceholders(arr) {
  return arr.map(() => "?").join(",");
}

/** Buses the caller may see, optionally one bus or one project. */
async function pspLoadBuses(conn, auth, projectId, busId = null) {
  const userId = await getOrCreateUserId(conn, auth);
  const scope = busProjectScope(auth, userId, "b", projectId);
  const [rows] = await conn.execute(
    `SELECT b.bus_id, b.bus_ev_no, b.bus_model, b.project_id FROM BUS b
     WHERE 1=1 ${busId ? "AND b.bus_id=?" : ""} ${scope.sql}
     ORDER BY b.bus_id`,
    [...(busId ? [busId] : []), ...scope.vals]
  );
  return rows;
}

/**
 * Status, due date and open booking for each bus. Shared by the schedule,
 * the counts, the bus inspection screen and the hourly tick, so every screen
 * agrees on a bus's status.
 */
async function pspStateForBuses(conn, buses, settings, now) {
  if (!buses.length) return [];
  const ids = buses.map((b) => b.bus_id);
  const ph = pspPlaceholders(ids);

  // The due date moves only on a Passed result in a chain that started as a
  // periodic inspection (a Special pass does not change it).
  const [passRows] = await conn.execute(
    `SELECT i.bus_id, MAX(i.result_date) AS last_pass
     FROM PUSPAKOM_INSPECTION i
     JOIN PUSPAKOM_INSPECTION r ON r.inspection_id = COALESCE(i.root_inspection_id, i.inspection_id)
     WHERE i.result='PASSED' AND r.inspection_type='PERIODIC' AND i.bus_id IN (${ph})
     GROUP BY i.bus_id`,
    ids
  );
  const lastPass = new Map(passRows.map((r) => [r.bus_id, pspDateStr(r.last_pass)]));

  const [openRows] = await conn.execute(
    `SELECT i.inspection_id, i.bus_id, i.inspection_type, i.scheduled_at, i.booking_ref,
            COALESCE(i.root_inspection_id, i.inspection_id) AS root_id, i.parent_inspection_id,
            p.precheck_id, p.kind, p.submitted_at,
            (SELECT COUNT(*) FROM PUSPAKOM_ANSWER a WHERE a.precheck_id = p.precheck_id) AS answered
     FROM PUSPAKOM_INSPECTION i
     LEFT JOIN PUSPAKOM_PRECHECK p ON p.inspection_id = i.inspection_id
     WHERE i.result IS NULL AND i.bus_id IN (${ph})
     ORDER BY i.scheduled_at`,
    ids
  );
  const open = new Map();
  for (const r of openRows) if (!open.has(r.bus_id)) open.set(r.bus_id, r);

  // For a re-inspection: when the parent failed and on what.
  const parentIds = [...open.values()].map((o) => o.parent_inspection_id).filter((x) => x != null);
  const failedOn = new Map();
  if (parentIds.length) {
    const [fr] = await conn.execute(
      `SELECT i.inspection_id, i.result_date, f.check_id
       FROM PUSPAKOM_INSPECTION i LEFT JOIN PUSPAKOM_FAILED_ITEM f ON f.inspection_id = i.inspection_id
       WHERE i.inspection_id IN (${pspPlaceholders(parentIds)})`,
      parentIds
    );
    for (const r of fr) {
      const cur = failedOn.get(r.inspection_id) ?? { date: pspDateStr(r.result_date), checks: [] };
      if (r.check_id) cur.checks.push(r.check_id);
      failedOn.set(r.inspection_id, cur);
    }
  }

  const today = pspMytDate(now);
  return buses.map((b) => {
    const last = lastPass.get(b.bus_id) ?? null;
    const nextDue = pspNextDue(last, settings.cycleMonths);
    const o = open.get(b.bus_id) ?? null;
    const status = pspBusStatus({
      nextDue,
      open: o && { type: o.inspection_type, scheduledAt: o.scheduled_at, preSubmitted: o.kind === "PRE" && !!o.submitted_at },
      now,
      notBookedDays: settings.notBookedDays,
    });
    const failed = o?.parent_inspection_id != null ? failedOn.get(o.parent_inspection_id) ?? null : null;
    return {
      bus_id: b.bus_id,
      bus_ev_no: b.bus_ev_no ?? null,
      bus_model: b.bus_model ?? null,
      project_id: b.project_id ?? null,
      last_passed: last,
      next_due: nextDue,
      days_to_due: nextDue ? pspDaysBetween(today, nextDue) : null,
      status,
      open: o
        ? {
            inspection_id: Number(o.inspection_id),
            root_inspection_id: Number(o.root_id),
            inspection_type: o.inspection_type,
            scheduled_at: pspIso(o.scheduled_at),
            booking_ref: o.booking_ref ?? null,
            precheck_kind: o.kind ?? null,
            precheck_answered: Number(o.answered ?? 0),
            precheck_submitted_at: pspIso(o.submitted_at),
            failed_on: failed?.date ?? null,
            failed_checks: failed?.checks ?? [],
          }
        : null,
    };
  });
}

// ----- media -----

async function pspPresignMedia(conn, auth, qs) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "technician"]);
  if (deny) return deny;
  const busId = String(qs?.bus_id ?? "").trim();
  if (!busId) throw new Error("bus_id required");
  const kind = String(qs?.kind ?? "");
  if (!PSP_MEDIA_KINDS.includes(kind)) throw new Error("Invalid kind");
  const mime = String(qs?.mime ?? "").trim();
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error("Invalid mime");
  const scopeDeny = await assertBusInScope(conn, auth, busId);
  if (scopeDeny) return scopeDeny;

  const key = `${pspKeyPrefix(busId)}${kind}/${crypto.randomUUID()}.${extFromMime(mime)}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: mime }),
    { expiresIn: 300 }
  );
  return json(200, { uploadUrl, s3_bucket: S3_BUCKET, s3_key: key });
}

// ----- schedule, counts, config -----

async function pspGetSchedule(conn, auth, qs) {
  const deny = requireRole(auth, PSP_SCHEDULE_ROLES);
  if (deny) return deny;
  const { projectId, deny: pDeny } = await resolveSelectedProject(conn, auth, qs);
  if (pDeny) return pDeny;

  const now = new Date();
  const settings = await pspSettings(conn);
  const buses = await pspLoadBuses(conn, auth, projectId);
  const rows = await pspStateForBuses(conn, buses, settings, now);
  return json(200, {
    today: pspMytDate(now),
    now: now.toISOString(),
    counts: pspCounts(rows.map((r) => r.status)),
    buses: rows,
    can_edit: PSP_FM_ROLES.includes(auth.role),
  });
}

async function pspGetCounts(conn, auth, qs) {
  const deny = requireRole(auth, PSP_VIEW_ROLES);
  if (deny) return deny;
  const { projectId, deny: pDeny } = await resolveSelectedProject(conn, auth, qs);
  if (pDeny) return pDeny;

  const buses = await pspLoadBuses(conn, auth, projectId);
  if (auth.role === "technician") {
    if (!buses.length) return json(200, { technician_todo: 0 });
    const ids = buses.map((b) => b.bus_id);
    const [r] = await conn.execute(
      `SELECT COUNT(*) AS n FROM PUSPAKOM_INSPECTION i
       JOIN PUSPAKOM_PRECHECK p ON p.inspection_id = i.inspection_id
       WHERE i.result IS NULL AND p.submitted_at IS NULL AND i.bus_id IN (${pspPlaceholders(ids)})`,
      ids
    );
    return json(200, { technician_todo: Number(r[0]?.n ?? 0) });
  }
  const rows = await pspStateForBuses(conn, buses, await pspSettings(conn), new Date());
  return json(200, pspCounts(rows.map((r) => r.status)));
}

async function pspGetCheckDefs(conn, auth, qs) {
  const deny = requireRole(auth, PSP_VIEW_ROLES);
  if (deny) return deny;
  const defs = await pspDefs(conn, qs?.bus_model);
  return json(200, { stops: defs.stops, checks: defs.checks, settings: await pspSettings(conn) });
}

// ----- one inspection (every role's bus inspection / checklist screen) -----

function pspShapeInspection(i) {
  return {
    inspection_id: Number(i.inspection_id),
    bus_id: i.bus_id,
    inspection_type: i.inspection_type,
    parent_inspection_id: i.parent_inspection_id == null ? null : Number(i.parent_inspection_id),
    root_inspection_id: Number(i.root_inspection_id ?? i.inspection_id),
    scheduled_at: pspIso(i.scheduled_at),
    booking_ref: i.booking_ref ?? null,
    notes: i.notes ?? null,
    registered_by: i.registered_by_name ?? null,
    registered_at: pspIso(i.registered_at),
    registered_verified_name: i.registered_verified_name ?? null,
    result: i.result ?? null,
    result_date: pspDateStr(i.result_date),
    result_by: i.result_by_name ?? null,
    result_at: pspIso(i.result_at),
    result_verified_name: i.result_verified_name ?? null,
    ref_no: i.ref_no ?? null,
  };
}

async function pspGetInspection(conn, auth, id) {
  const deny = requireRole(auth, PSP_VIEW_ROLES);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT i.inspection_id, i.bus_id, COALESCE(i.root_inspection_id, i.inspection_id) AS root_id
     FROM PUSPAKOM_INSPECTION i WHERE i.inspection_id=?`,
    [id]
  );
  if (!rows.length) return json(404, { message: "Inspection not found" });
  const busId = rows[0].bus_id;
  const rootId = Number(rows[0].root_id);
  const scopeDeny = await assertBusInScope(conn, auth, busId);
  if (scopeDeny) return scopeDeny;

  const now = new Date();
  const settings = await pspSettings(conn);
  const [busRows] = await conn.execute(
    "SELECT bus_id, bus_ev_no, bus_model, project_id FROM BUS WHERE bus_id=?",
    [busId]
  );
  const bus = busRows[0];
  const [state] = await pspStateForBuses(conn, [bus], settings, now);
  const defs = await pspDefs(conn, bus.bus_model);

  const [chainRows] = await conn.execute(
    `SELECT i.*, ru.user_name AS registered_by_name, xu.user_name AS result_by_name
     FROM PUSPAKOM_INSPECTION i
     LEFT JOIN \`USER\` ru ON ru.user_id = i.registered_by
     LEFT JOIN \`USER\` xu ON xu.user_id = i.result_by
     WHERE COALESCE(i.root_inspection_id, i.inspection_id) = ?
     ORDER BY i.scheduled_at, i.inspection_id`,
    [rootId]
  );
  const chainIds = chainRows.map((c) => Number(c.inspection_id));
  const cph = pspPlaceholders(chainIds);

  const [preRows] = await conn.execute(
    `SELECT p.*, su.user_name AS submitted_by_name, st.user_name AS started_by_name
     FROM PUSPAKOM_PRECHECK p
     LEFT JOIN \`USER\` su ON su.user_id = p.submitted_by
     LEFT JOIN \`USER\` st ON st.user_id = p.started_by
     WHERE p.inspection_id IN (${cph})`,
    chainIds
  );

  const shapePrecheck = async (p) =>
    p && {
      precheck_id: Number(p.precheck_id),
      inspection_id: Number(p.inspection_id),
      kind: p.kind,
      started_by: p.started_by_name ?? null,
      started_at: pspIso(p.started_at),
      submitted_by: p.submitted_by_name ?? null,
      submitted_at: pspIso(p.submitted_at),
      remarks: p.remarks ?? null,
      declared: !!p.declared,
      verified_name: p.verified_name ?? null,
      selfie_url: await signS3Url(p.selfie_s3_bucket, p.selfie_s3_key),
    };

  // The 44-check pre-inspection lives on the first booking of the chain.
  const preRow = preRows.find((p) => p.kind === "PRE") ?? null;
  let precheck = null;
  if (preRow) {
    const [ans] = await conn.execute(
      `SELECT a.*, u.user_name AS entered_by_name FROM PUSPAKOM_ANSWER a
       LEFT JOIN \`USER\` u ON u.user_id = a.entered_by
       WHERE a.precheck_id=?`,
      [preRow.precheck_id]
    );
    const answers = await Promise.all(
      ans.map(async (a) => ({
        check_id: a.check_id,
        answer: a.answer ?? null,
        ng_reason: a.ng_reason ?? null,
        note: a.note ?? null,
        tread_mm: a.tread_mm == null ? null : Number(a.tread_mm),
        pressure_psi: a.pressure_psi == null ? null : Number(a.pressure_psi),
        pad_mm: a.pad_mm == null ? null : Number(a.pad_mm),
        tag: a.tag ?? null,
        photo_s3_key: a.photo_s3_key ?? null,
        photo_url: await signS3Url(S3_BUCKET, a.photo_s3_key),
        damages: await Promise.all(
          pspJsonArr(a.damages).map(async (d) => ({ ...d, photo_url: await signS3Url(S3_BUCKET, d.photo_s3_key) }))
        ),
        entered_by: a.entered_by_name ?? null,
        entered_at: pspIso(a.entered_at),
        client_ts: Number(a.client_ts),
      }))
    );
    const byId = new Map(answers.map((a) => [a.check_id, a]));
    const done = defs.checks.filter((d) => pspAnswerDone(d.answer_type, byId.get(d.check_id))).length;
    const attention = answers.filter((a) => PSP_ATTENTION_TAGS.includes(a.tag)).map((a) => a.check_id);
    precheck = {
      ...(await shapePrecheck(preRow)),
      total: defs.checks.length,
      done,
      photos: answers.reduce((n, a) => n + (a.photo_s3_key ? 1 : 0) + a.damages.filter((d) => d.photo_s3_key).length, 0),
      needs_attention: attention,
      answers,
    };
  }

  const [failedRows] = await conn.execute(
    `SELECT f.*, u.user_name AS fixed_by_name FROM PUSPAKOM_FAILED_ITEM f
     LEFT JOIN \`USER\` u ON u.user_id = f.fixed_by
     WHERE f.inspection_id IN (${cph}) ORDER BY f.inspection_id, f.check_id`,
    chainIds
  );
  const failedItems = await Promise.all(
    failedRows.map(async (f) => {
      const keys = pspJsonArr(f.fix_photo_keys);
      return {
        inspection_id: Number(f.inspection_id),
        check_id: f.check_id,
        label: defs.byId.get(f.check_id)?.label ?? f.check_id,
        stop_no: defs.byId.get(f.check_id)?.stop_no ?? null,
        puspakom_found: f.puspakom_found,
        fixed_text: f.fixed_text ?? null,
        fix_photos: await Promise.all(keys.map(async (k) => ({ s3_key: k, url: await signS3Url(S3_BUCKET, k) }))),
        fixed_by: f.fixed_by_name ?? null,
        fixed_at: pspIso(f.fixed_at),
        client_ts: Number(f.client_ts),
      };
    })
  );

  const rechecks = await Promise.all(
    preRows.filter((p) => p.kind === "RECHECK").map(async (p) => {
      const insp = chainRows.find((c) => Number(c.inspection_id) === Number(p.inspection_id));
      const items = failedItems.filter((f) => f.inspection_id === Number(insp?.parent_inspection_id));
      return {
        ...(await shapePrecheck(p)),
        total: items.length,
        done: items.filter((f) => f.fixed_text && f.fix_photos.length > 0).length,
      };
    })
  );

  const [slipRows] = await conn.execute(
    `SELECT m.media_id, m.inspection_id, m.s3_bucket, m.s3_key, m.uploaded_at, u.user_name AS uploaded_by_name
     FROM PUSPAKOM_MEDIA m LEFT JOIN \`USER\` u ON u.user_id = m.uploaded_by
     WHERE m.inspection_id IN (${cph}) ORDER BY m.uploaded_at, m.media_id`,
    chainIds
  );
  const slips = await Promise.all(
    slipRows.map(async (m) => ({
      media_id: Number(m.media_id),
      inspection_id: Number(m.inspection_id),
      url: await signS3Url(m.s3_bucket, m.s3_key),
      uploaded_by: m.uploaded_by_name ?? null,
      uploaded_at: pspIso(m.uploaded_at),
    }))
  );

  const [eventRows] = await conn.execute(
    `SELECT e.event_id, e.inspection_id, e.event_type, e.event_at, e.detail, u.user_name AS actor_name, u.user_role AS actor_role
     FROM PUSPAKOM_EVENT e LEFT JOIN \`USER\` u ON u.user_id = e.actor_user_id
     WHERE e.root_inspection_id=? ORDER BY e.event_at, e.event_id`,
    [rootId]
  );
  const events = eventRows.map((e) => ({
    event_id: Number(e.event_id),
    inspection_id: Number(e.inspection_id),
    type: e.event_type,
    at: pspIso(e.event_at),
    actor: e.actor_name ?? null,
    actor_role: e.actor_role ?? null,
    detail: typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail ?? null,
  }));

  const chain = await Promise.all(
    chainRows.map(async (c) => ({
      ...pspShapeInspection(c),
      registered_selfie_url: await signS3Url(c.registered_selfie_s3_bucket, c.registered_selfie_s3_key),
      result_selfie_url: await signS3Url(c.result_selfie_s3_bucket, c.result_selfie_s3_key),
    }))
  );
  const current = chain.find((c) => c.inspection_id === Number(id));

  return json(200, {
    now: now.toISOString(),
    bus: { bus_id: bus.bus_id, bus_ev_no: bus.bus_ev_no ?? null, bus_model: bus.bus_model ?? null },
    state,
    inspection: current,
    chain,
    precheck,
    rechecks,
    failed_items: failedItems,
    slips,
    events,
    defs: { stops: defs.stops, checks: defs.checks },
    settings,
    can_edit: PSP_FM_ROLES.includes(auth.role),
    can_work: PSP_TECH_ROLES.includes(auth.role),
  });
}

/**
 * The bus inspection screen opened from a schedule card. Shows the open
 * inspection if there is one, otherwise the bus's most recent inspection
 * ("last result only"), otherwise just the bus and its status.
 */
async function pspGetBus(conn, auth, busId) {
  const deny = requireRole(auth, PSP_VIEW_ROLES);
  if (deny) return deny;
  const scopeDeny = await assertBusInScope(conn, auth, busId);
  if (scopeDeny) return scopeDeny;

  const [rows] = await conn.execute(
    `SELECT inspection_id FROM PUSPAKOM_INSPECTION WHERE bus_id=?
     ORDER BY (result IS NULL) DESC, scheduled_at DESC, inspection_id DESC LIMIT 1`,
    [busId]
  );
  if (rows.length) return pspGetInspection(conn, auth, Number(rows[0].inspection_id));

  const now = new Date();
  const [busRows] = await conn.execute("SELECT bus_id, bus_ev_no, bus_model, project_id FROM BUS WHERE bus_id=?", [busId]);
  const bus = busRows[0];
  const settings = await pspSettings(conn);
  const [state] = await pspStateForBuses(conn, [bus], settings, now);
  return json(200, {
    now: now.toISOString(),
    bus: { bus_id: bus.bus_id, bus_ev_no: bus.bus_ev_no ?? null, bus_model: bus.bus_model ?? null },
    state,
    inspection: null,
    chain: [],
    precheck: null,
    rechecks: [],
    failed_items: [],
    slips: [],
    events: [],
    defs: null,
    settings,
    can_edit: PSP_FM_ROLES.includes(auth.role),
    can_work: PSP_TECH_ROLES.includes(auth.role),
  });
}

// ----- Fleet Manager: register, edit booking, record result -----

async function pspNotifyTechnicians(conn, { projectId, excludeUserId, type, title, body, inspectionId }) {
  await notifyUsersByRole(conn, {
    roles: ["technician"],
    projectId,
    excludeUserId,
    type,
    title,
    body,
    puspakomInspectionId: inspectionId,
  });
}

async function pspNotifyFleetManagers(conn, { projectId, excludeUserId, type, title, body, inspectionId }) {
  await notifyUsersByRole(conn, {
    roles: ["fleet_manager"],
    projectId,
    excludeUserId,
    type,
    title,
    body,
    puspakomInspectionId: inspectionId,
  });
}

function pspBusLabel(bus) {
  return bus?.bus_ev_no ? `${bus.bus_id} (${bus.bus_ev_no})` : String(bus?.bus_id ?? "");
}

async function pspRegister(conn, auth, b) {
  const deny = requireRole(auth, PSP_FM_ROLES);
  if (deny) return deny;

  const busId = String(b?.bus_id ?? "").trim();
  if (!busId) throw new Error("bus_id required");
  const scopeDeny = await assertBusInScope(conn, auth, busId);
  if (scopeDeny) return scopeDeny;

  const type = String(b?.inspection_type ?? "");
  if (!["PERIODIC", "SPECIAL"].includes(type)) throw new Error("Invalid inspection_type: PERIODIC or SPECIAL");
  const now = new Date();
  const at = pspParseInstant(b?.scheduled_at, "scheduled_at");
  if (pspMytDate(at) < pspMytDate(now)) throw new Error("Invalid scheduled_at: the date cannot be in the past");
  const bookingRef = pspText(b?.booking_ref, 64, "booking_ref");
  const notes = pspText(b?.notes, 500, "notes");
  const sign = pspSignoff(b, busId);
  const userId = await getOrCreateUserId(conn, auth);

  let inspectionId;
  let bus;
  await conn.beginTransaction();
  try {
    // Lock the bus row so two Fleet Managers can't both book the same bus.
    const [busRows] = await conn.execute(
      "SELECT bus_id, bus_ev_no, project_id FROM BUS WHERE bus_id=? FOR UPDATE",
      [busId]
    );
    bus = busRows[0];
    const [openRows] = await conn.execute(
      "SELECT inspection_id FROM PUSPAKOM_INSPECTION WHERE bus_id=? AND result IS NULL LIMIT 1",
      [busId]
    );
    if (openRows.length) {
      await conn.rollback();
      return json(409, {
        code: "ALREADY_BOOKED",
        message: "This bus already has an open inspection. Edit that booking instead.",
        inspection_id: Number(openRows[0].inspection_id),
      });
    }
    const [res] = await conn.execute(
      `INSERT INTO PUSPAKOM_INSPECTION
         (bus_id, inspection_type, scheduled_at, booking_ref, notes, registered_by, registered_at,
          registered_verified_name, registered_selfie_s3_bucket, registered_selfie_s3_key)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [busId, type, at, bookingRef, notes, userId, now, sign.name, S3_BUCKET, sign.key]
    );
    inspectionId = Number(res.insertId);
    await conn.execute("UPDATE PUSPAKOM_INSPECTION SET root_inspection_id=? WHERE inspection_id=?", [inspectionId, inspectionId]);
    await conn.execute("INSERT INTO PUSPAKOM_PRECHECK (inspection_id, kind) VALUES (?, 'PRE')", [inspectionId]);
    await pspEvent(conn, {
      inspectionId,
      rootId: inspectionId,
      type: "REGISTERED",
      actorId: userId,
      at: now,
      detail: { inspection_type: type, scheduled_at: at.toISOString(), booking_ref: bookingRef },
    });
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }

  const due = pspAddDays(pspMytDate(at), -1);
  await pspNotifyTechnicians(conn, {
    projectId: bus.project_id,
    excludeUserId: userId,
    type: "puspakom_registered",
    title: `PUSPAKOM pre-inspection: ${pspBusLabel(bus)}`,
    body: `${PSP_TYPE_LABEL[type]} inspection ${pspFmtDateTime(at)}. Checklist due ${pspFmtDate(due)}.`,
    inspectionId,
  });
  return json(201, { inspection_id: inspectionId });
}

async function pspUpdateBooking(conn, auth, id, b) {
  const deny = requireRole(auth, PSP_FM_ROLES);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT i.*, b.bus_ev_no, b.project_id FROM PUSPAKOM_INSPECTION i JOIN BUS b ON b.bus_id = i.bus_id
     WHERE i.inspection_id=?`,
    [id]
  );
  if (!rows.length) return json(404, { message: "Inspection not found" });
  const insp = rows[0];
  const scopeDeny = await assertBusInScope(conn, auth, insp.bus_id);
  if (scopeDeny) return scopeDeny;
  if (insp.result) return json(409, { code: "CLOSED", message: "This inspection already has a result." });

  const now = new Date();
  const sets = [];
  const vals = [];
  const changed = {};
  if (b?.scheduled_at !== undefined) {
    const at = pspParseInstant(b.scheduled_at, "scheduled_at");
    if (pspMytDate(at) < pspMytDate(now)) throw new Error("Invalid scheduled_at: the date cannot be in the past");
    if (at.getTime() !== new Date(insp.scheduled_at).getTime()) {
      sets.push("scheduled_at=?");
      vals.push(at);
      changed.scheduled_at = { from: pspIso(insp.scheduled_at), to: at.toISOString() };
    }
  }
  if (b?.booking_ref !== undefined) {
    const v = pspText(b.booking_ref, 64, "booking_ref");
    if (v !== (insp.booking_ref ?? null)) {
      sets.push("booking_ref=?");
      vals.push(v);
      changed.booking_ref = { from: insp.booking_ref ?? null, to: v };
    }
  }
  if (b?.notes !== undefined) {
    const v = pspText(b.notes, 500, "notes");
    if (v !== (insp.notes ?? null)) {
      sets.push("notes=?");
      vals.push(v);
      changed.notes = true;
    }
  }
  if (b?.inspection_type !== undefined && b.inspection_type !== insp.inspection_type) {
    if (insp.inspection_type === "REINSPECTION" || !["PERIODIC", "SPECIAL"].includes(b.inspection_type)) {
      throw new Error("Invalid inspection_type");
    }
    sets.push("inspection_type=?");
    vals.push(b.inspection_type);
    changed.inspection_type = { from: insp.inspection_type, to: b.inspection_type };
  }
  if (!sets.length) return json(200, { inspection_id: Number(id), changed: {} });

  const userId = await getOrCreateUserId(conn, auth);
  const rootId = Number(insp.root_inspection_id ?? insp.inspection_id);
  await conn.execute(
    `UPDATE PUSPAKOM_INSPECTION SET ${sets.join(", ")} WHERE inspection_id=? AND result IS NULL`,
    [...vals, id]
  );
  await pspEvent(conn, { inspectionId: Number(id), rootId, type: "BOOKING_CHANGED", actorId: userId, at: now, detail: changed });

  if (changed.scheduled_at) {
    await pspNotifyTechnicians(conn, {
      projectId: insp.project_id,
      excludeUserId: userId,
      type: "puspakom_booking_changed",
      title: `PUSPAKOM booking changed: ${pspBusLabel(insp)}`,
      body: `Now ${pspFmtDateTime(changed.scheduled_at.to)} (was ${pspFmtDateTime(changed.scheduled_at.from)}).`,
      inspectionId: Number(id),
    });
  }
  return json(200, { inspection_id: Number(id), changed });
}

/** SKSC-PKR-YYYY-MM-DD-XX on the chain's first booking, fixed once given. */
async function pspEnsureRefNo(conn, rootId) {
  const [rows] = await conn.execute(
    "SELECT ref_no, scheduled_at FROM PUSPAKOM_INSPECTION WHERE inspection_id=?",
    [rootId]
  );
  if (!rows.length) return null;
  if (rows[0].ref_no) return rows[0].ref_no;

  const at = new Date(rows[0].scheduled_at);
  const day = pspMytDate(at);
  const startUtc = new Date(Date.parse(`${day}T00:00:00+08:00`));
  const endUtc = new Date(startUtc.getTime() + 86400000);
  const [cnt] = await conn.execute(
    `SELECT COUNT(*) AS n FROM PUSPAKOM_INSPECTION
     WHERE root_inspection_id = inspection_id
       AND scheduled_at >= ? AND scheduled_at < ?
       AND (scheduled_at < ? OR (scheduled_at = ? AND inspection_id <= ?))`,
    [startUtc, endUtc, at, at, rootId]
  );
  const position = Math.max(1, Number(cnt[0]?.n ?? 1));
  for (let n = position; n < position + 99; n++) {
    try {
      const [res] = await conn.execute(
        "UPDATE PUSPAKOM_INSPECTION SET ref_no=? WHERE inspection_id=? AND ref_no IS NULL",
        [pspRefNo(day, n), rootId]
      );
      if (res.affectedRows) return pspRefNo(day, n);
      const [again] = await conn.execute("SELECT ref_no FROM PUSPAKOM_INSPECTION WHERE inspection_id=?", [rootId]);
      return again[0]?.ref_no ?? null;
    } catch (e) {
      if (e?.code !== "ER_DUP_ENTRY") throw e;
    }
  }
  throw new Error("Could not assign a reference number");
}

async function pspRecordResult(conn, auth, id, b) {
  const deny = requireRole(auth, PSP_FM_ROLES);
  if (deny) return deny;

  const [pre] = await conn.execute(
    `SELECT i.bus_id, b.bus_model FROM PUSPAKOM_INSPECTION i JOIN BUS b ON b.bus_id = i.bus_id WHERE i.inspection_id=?`,
    [id]
  );
  if (!pre.length) return json(404, { message: "Inspection not found" });
  const busId = pre[0].bus_id;
  const scopeDeny = await assertBusInScope(conn, auth, busId);
  if (scopeDeny) return scopeDeny;

  const result = String(b?.result ?? "");
  if (!["PASSED", "FAILED"].includes(result)) throw new Error("Invalid result: PASSED or FAILED");
  const now = new Date();
  const today = pspMytDate(now);
  const sign = pspSignoff(b, busId);
  const slipKeys = (Array.isArray(b?.slip_keys) ? b.slip_keys : []).map((k) => pspCheckKey(k, busId, "slip_keys"));
  if (slipKeys.length > 10) throw new Error("Invalid slip_keys: at most 10 photos");

  let failed = [];
  let reAt = null;
  if (result === "FAILED") {
    const defs = await pspDefs(conn, pre[0].bus_model);
    const seen = new Set();
    failed = (Array.isArray(b?.failed) ? b.failed : []).map((f) => {
      const checkId = String(f?.check_id ?? "");
      if (!defs.byId.has(checkId)) throw new Error(`Invalid check_id ${checkId}`);
      if (seen.has(checkId)) throw new Error(`Invalid failed: ${checkId} listed twice`);
      seen.add(checkId);
      const found = pspText(f?.puspakom_found, 300, "puspakom_found");
      if (!found) throw new Error(`puspakom_found required for ${checkId}`);
      return { check_id: checkId, label: defs.byId.get(checkId).label, found };
    });
    if (!failed.length) throw new Error("failed required: pick at least one failed check");
    if (!slipKeys.length) throw new Error("slip_keys required: add a photo of the PUSPAKOM result slip");
    reAt = pspParseInstant(b?.reinspection?.scheduled_at, "reinspection.scheduled_at");
  }

  const userId = await getOrCreateUserId(conn, auth);
  let insp;
  let childId = null;
  let resultDate;
  await conn.beginTransaction();
  try {
    const [rows] = await conn.execute(
      `SELECT i.*, b.bus_ev_no, b.project_id FROM PUSPAKOM_INSPECTION i JOIN BUS b ON b.bus_id = i.bus_id
       WHERE i.inspection_id=? FOR UPDATE`,
      [id]
    );
    insp = rows[0];
    if (insp.result) {
      await conn.rollback();
      return json(409, { code: "CLOSED", message: "A result was already recorded for this inspection." });
    }
    const inspDate = pspMytDate(insp.scheduled_at);
    if (today < inspDate) {
      await conn.rollback();
      return json(409, { code: "NOT_YET", message: `Available from the inspection date (${pspFmtDate(inspDate)}).` });
    }
    resultDate = b?.result_date ? pspParseDate(b.result_date, "result_date") : inspDate;
    if (resultDate > today) throw new Error("Invalid result_date: cannot be in the future");
    if (reAt && pspMytDate(reAt) <= resultDate) throw new Error("Invalid reinspection.scheduled_at: must be after the result date");

    const rootId = Number(insp.root_inspection_id ?? insp.inspection_id);
    await conn.execute(
      `UPDATE PUSPAKOM_INSPECTION
       SET result=?, result_date=?, result_by=?, result_at=?,
           result_verified_name=?, result_selfie_s3_bucket=?, result_selfie_s3_key=?
       WHERE inspection_id=?`,
      [result, resultDate, userId, now, sign.name, S3_BUCKET, sign.key, id]
    );
    for (const k of slipKeys) {
      await conn.execute(
        "INSERT INTO PUSPAKOM_MEDIA (inspection_id, media_kind, s3_bucket, s3_key, uploaded_by) VALUES (?, 'SLIP', ?, ?, ?)",
        [id, S3_BUCKET, k, userId]
      );
    }

    if (result === "FAILED") {
      for (const f of failed) {
        await conn.execute(
          "INSERT INTO PUSPAKOM_FAILED_ITEM (inspection_id, check_id, puspakom_found) VALUES (?,?,?)",
          [id, f.check_id, f.found]
        );
      }
      const [res] = await conn.execute(
        `INSERT INTO PUSPAKOM_INSPECTION
           (bus_id, inspection_type, parent_inspection_id, root_inspection_id, scheduled_at, registered_by, registered_at)
         VALUES (?, 'REINSPECTION', ?, ?, ?, ?, ?)`,
        [insp.bus_id, id, rootId, reAt, userId, now]
      );
      childId = Number(res.insertId);
      await conn.execute("INSERT INTO PUSPAKOM_PRECHECK (inspection_id, kind) VALUES (?, 'RECHECK')", [childId]);
      await pspEvent(conn, {
        inspectionId: Number(id),
        rootId,
        type: "RESULT_FAILED",
        actorId: userId,
        at: now,
        detail: {
          result_date: resultDate,
          slips: slipKeys.length,
          failed: failed.map((f) => ({ check_id: f.check_id, label: f.label, puspakom_found: f.found })),
        },
      });
      await pspEvent(conn, {
        inspectionId: childId,
        rootId,
        type: "REINSPECTION_BOOKED",
        actorId: userId,
        at: now,
        detail: { scheduled_at: reAt.toISOString() },
      });
    } else {
      const [rootRows] = await conn.execute("SELECT inspection_type FROM PUSPAKOM_INSPECTION WHERE inspection_id=?", [rootId]);
      const settings = await pspSettings(conn);
      const movesDue = rootRows[0]?.inspection_type === "PERIODIC";
      await pspEvent(conn, {
        inspectionId: Number(id),
        rootId,
        type: "RESULT_PASSED",
        actorId: userId,
        at: now,
        detail: {
          result_date: resultDate,
          slips: slipKeys.length,
          next_due: movesDue ? pspNextDue(resultDate, settings.cycleMonths) : null,
        },
      });
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }

  const rootId = Number(insp.root_inspection_id ?? insp.inspection_id);
  let refNo = null;
  if (result === "PASSED") {
    refNo = await pspEnsureRefNo(conn, rootId);
    // Make the report PDF now, so the first download is already there. A
    // failed queue write is not fatal: the download endpoint queues it again.
    try {
      await pspQueueReportPdf(conn, rootId);
    } catch (e) {
      console.error("[PUSPAKOM] report PDF queue failed", { rootId, message: e?.message });
    }
  } else {
    const list = failed.map((f) => `${f.check_id} ${f.label}`).join(", ");
    await pspNotifyTechnicians(conn, {
      projectId: insp.project_id,
      excludeUserId: userId,
      type: "puspakom_reinspection",
      title: `PUSPAKOM re-check: ${pspBusLabel(insp)}`,
      body: `Failed at PUSPAKOM: ${list}. Re-inspection ${pspFmtDateTime(reAt)}.`,
      inspectionId: childId,
    });
  }
  return json(200, { inspection_id: Number(id), result, ref_no: refNo, reinspection_id: childId });
}

// ----- Technician: pre-inspection answers, submit, re-check -----

async function pspLoadOpenForTech(conn, auth, id) {
  const [rows] = await conn.execute(
    `SELECT i.*, b.bus_ev_no, b.bus_model, b.project_id FROM PUSPAKOM_INSPECTION i
     JOIN BUS b ON b.bus_id = i.bus_id WHERE i.inspection_id=?`,
    [id]
  );
  if (!rows.length) return { deny: json(404, { message: "Inspection not found" }) };
  const insp = rows[0];
  const scopeDeny = await assertBusInScope(conn, auth, insp.bus_id);
  if (scopeDeny) return { deny: scopeDeny };
  if (insp.result) return { deny: json(409, { code: "CLOSED", message: "The Fleet Manager has already recorded the result." }) };
  return { insp, rootId: Number(insp.root_inspection_id ?? insp.inspection_id) };
}

async function pspGetPrecheckRow(conn, inspectionId, kind) {
  await conn.execute("INSERT IGNORE INTO PUSPAKOM_PRECHECK (inspection_id, kind) VALUES (?, ?)", [inspectionId, kind]);
  const [rows] = await conn.execute(
    "SELECT * FROM PUSPAKOM_PRECHECK WHERE inspection_id=? AND kind=?",
    [inspectionId, kind]
  );
  return rows[0];
}

async function pspMarkStarted(conn, precheckId, userId, at) {
  await conn.execute(
    "UPDATE PUSPAKOM_PRECHECK SET started_by=?, started_at=? WHERE precheck_id=? AND started_at IS NULL",
    [userId, at, precheckId]
  );
}

/** When the phone says an answer was entered; never in the future. */
function pspClientTime(v, now) {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime()) || d.getTime() > now.getTime()) return now;
  return d;
}

async function pspSaveAnswers(conn, auth, id, b) {
  const deny = requireRole(auth, PSP_TECH_ROLES);
  if (deny) return deny;
  const { insp, deny: lDeny } = await pspLoadOpenForTech(conn, auth, id);
  if (lDeny) return lDeny;
  if (insp.inspection_type === "REINSPECTION") {
    return json(400, { message: "A re-inspection has a re-check, not a pre-inspection." });
  }
  const list = Array.isArray(b?.answers) ? b.answers : [];
  if (!list.length) throw new Error("answers required");
  if (list.length > 60) throw new Error("Invalid answers: at most 60 per request");

  const pre = await pspGetPrecheckRow(conn, id, "PRE");
  if (pre.submitted_at) return json(409, { code: "LOCKED", message: "This pre-inspection was already submitted." });

  const defs = await pspDefs(conn, insp.bus_model);
  const settings = await pspSettings(conn);
  const userId = await getOrCreateUserId(conn, auth);
  const now = new Date();
  const busId = insp.bus_id;

  const rows = list.map((a) => {
    const checkId = String(a?.check_id ?? "");
    const def = defs.byId.get(checkId);
    if (!def) throw new Error(`Invalid check_id ${checkId}`);
    const type = def.answer_type;
    const clientTs = Number(a?.client_ts);
    if (!Number.isSafeInteger(clientTs) || clientTs < 0) throw new Error(`Invalid client_ts for ${checkId}`);
    const nums = pspValidateNumbers({ ...a, check_id: checkId });

    let answer = a?.answer ?? null;
    const allowed = type === "OK_NG" ? ["OK", "NG"] : type === "BODY" ? ["NO_DAMAGE", "DAMAGE"] : [];
    if (answer !== null && !allowed.includes(answer)) throw new Error(`Invalid answer for ${checkId}`);
    if (!allowed.length) answer = null;

    const ngReason = type === "OK_NG" && answer === "NG" ? a?.ng_reason ?? null : null;
    if (ngReason !== null && !PSP_NG_REASONS.includes(ngReason)) throw new Error(`Invalid ng_reason for ${checkId}`);
    const note = type === "OK_NG" ? pspText(a?.note, 200, "note") : null;

    let damages = null;
    if (type === "BODY" && answer === "DAMAGE") {
      const raw = Array.isArray(a?.damages) ? a.damages : [];
      if (raw.length > 20) throw new Error(`Invalid damages for ${checkId}: at most 20`);
      damages = raw.map((d, i) => {
        const x = Number(d?.x_pct);
        const y = Number(d?.y_pct);
        if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) throw new Error(`Invalid damage position for ${checkId}`);
        if (d?.type != null && !PSP_DAMAGE_TYPES.includes(d.type)) throw new Error(`Invalid damage type for ${checkId}`);
        return {
          no: Number.isInteger(d?.no) ? d.no : i + 1,
          x_pct: x,
          y_pct: y,
          where: pspText(d?.where, 80, "damage where") ?? "",
          type: d?.type ?? null,
          photo_s3_key: pspCheckKey(d?.photo_s3_key, busId, "damage photo_s3_key"),
        };
      });
    }

    const clean = {
      answer,
      ng_reason: ngReason,
      note,
      tread_mm: type === "TYRE" ? nums.tread : null,
      pressure_psi: type === "TYRE" ? nums.psi : null,
      pad_mm: type === "BRAKE" ? nums.pad : null,
      damages,
      photo_s3_key: pspCheckKey(a?.photo_s3_key, busId, "photo_s3_key"),
    };
    return {
      checkId,
      clientTs,
      enteredAt: pspClientTime(a?.entered_at, now),
      tag: pspAnswerTag(type, clean, settings),
      ...clean,
    };
  });

  // Last write wins by the phone's own timestamp, so a phone that was offline
  // can't overwrite a newer answer someone else has since saved. client_ts is
  // assigned LAST: MySQL evaluates these left to right, and every IF() above
  // it must still compare against the old value.
  const cols = ["answer", "ng_reason", "note", "tread_mm", "pressure_psi", "pad_mm", "tag", "photo_s3_key", "damages", "entered_by", "entered_at"];
  const sql = `
    INSERT INTO PUSPAKOM_ANSWER (precheck_id, check_id, ${cols.join(", ")}, client_ts)
    VALUES (?, ?, ${cols.map(() => "?").join(", ")}, ?)
    ON DUPLICATE KEY UPDATE
      ${cols.map((c) => `${c} = IF(VALUES(client_ts) > client_ts, VALUES(${c}), ${c})`).join(",\n      ")},
      client_ts = IF(VALUES(client_ts) > client_ts, VALUES(client_ts), client_ts)`;
  let applied = 0;
  for (const r of rows) {
    const [res] = await conn.execute(sql, [
      pre.precheck_id,
      r.checkId,
      r.answer,
      r.ng_reason,
      r.note,
      r.tread_mm,
      r.pressure_psi,
      r.pad_mm,
      r.tag,
      r.photo_s3_key,
      r.damages ? JSON.stringify(r.damages) : null,
      userId,
      r.enteredAt,
      r.clientTs,
    ]);
    if (res.affectedRows > 0) applied++;
  }
  await pspMarkStarted(conn, pre.precheck_id, userId, now);

  return json(200, {
    saved: applied,
    results: rows.map((r) => ({ check_id: r.checkId, client_ts: r.clientTs, tag: r.tag })),
  });
}

async function pspSubmitPrecheck(conn, auth, id, b) {
  const deny = requireRole(auth, PSP_TECH_ROLES);
  if (deny) return deny;
  const { insp, rootId, deny: lDeny } = await pspLoadOpenForTech(conn, auth, id);
  if (lDeny) return lDeny;
  if (insp.inspection_type === "REINSPECTION") {
    return json(400, { message: "A re-inspection has a re-check, not a pre-inspection." });
  }
  if (b?.declared !== true) throw new Error("declared required: tick the declaration");
  const remarks = pspText(b?.remarks, 500, "remarks");
  const sign = pspSignoff(b, insp.bus_id);

  const pre = await pspGetPrecheckRow(conn, id, "PRE");
  if (pre.submitted_at) return json(409, { code: "LOCKED", message: "This pre-inspection was already submitted." });

  const defs = await pspDefs(conn, insp.bus_model);
  const [ans] = await conn.execute("SELECT * FROM PUSPAKOM_ANSWER WHERE precheck_id=?", [pre.precheck_id]);
  const byId = new Map(ans.map((a) => [a.check_id, { ...a, damages: pspJsonArr(a.damages) }]));
  const missing = defs.checks.filter((d) => !pspAnswerDone(d.answer_type, byId.get(d.check_id))).map((d) => d.check_id);
  if (missing.length) {
    return json(409, {
      code: "INCOMPLETE",
      message: `${missing.length} check${missing.length === 1 ? "" : "s"} not done yet. Every check needs its answer and photo.`,
      missing,
    });
  }

  const userId = await getOrCreateUserId(conn, auth);
  const now = new Date();
  const [res] = await conn.execute(
    `UPDATE PUSPAKOM_PRECHECK
     SET submitted_by=?, submitted_at=?, remarks=?, declared=1, verified_name=?, selfie_s3_bucket=?, selfie_s3_key=?
     WHERE precheck_id=? AND submitted_at IS NULL`,
    [userId, now, remarks, sign.name, S3_BUCKET, sign.key, pre.precheck_id]
  );
  if (!res.affectedRows) return json(409, { code: "LOCKED", message: "This pre-inspection was already submitted." });

  const attention = ans.filter((a) => PSP_ATTENTION_TAGS.includes(a.tag)).map((a) => a.check_id);
  const photos = ans.reduce(
    (n, a) => n + (a.photo_s3_key ? 1 : 0) + pspJsonArr(a.damages).filter((d) => d.photo_s3_key).length,
    0
  );
  await pspEvent(conn, {
    inspectionId: Number(id),
    rootId,
    type: "PRECHECK_SUBMITTED",
    actorId: userId,
    at: now,
    detail: { checks: defs.checks.length, photos, needs_attention: attention },
  });
  await pspNotifyFleetManagers(conn, {
    projectId: insp.project_id,
    excludeUserId: userId,
    type: "puspakom_precheck_submitted",
    title: `Pre-inspection submitted: ${pspBusLabel(insp)}`,
    body: `${defs.checks.length} of ${defs.checks.length} checks · ${attention.length} need attention. Inspection ${pspFmtDateTime(insp.scheduled_at)}.`,
    inspectionId: Number(id),
  });
  return json(200, { inspection_id: Number(id), submitted_at: now.toISOString(), needs_attention: attention });
}

async function pspSaveRecheck(conn, auth, id, b) {
  const deny = requireRole(auth, PSP_TECH_ROLES);
  if (deny) return deny;
  const { insp, deny: lDeny } = await pspLoadOpenForTech(conn, auth, id);
  if (lDeny) return lDeny;
  if (insp.inspection_type !== "REINSPECTION") return json(400, { message: "Only a re-inspection has a re-check." });

  const pre = await pspGetPrecheckRow(conn, id, "RECHECK");
  if (pre.submitted_at) return json(409, { code: "LOCKED", message: "This re-check was already submitted." });

  const list = Array.isArray(b?.items) ? b.items : [];
  if (!list.length) throw new Error("items required");
  const userId = await getOrCreateUserId(conn, auth);
  const now = new Date();
  let applied = 0;
  for (const it of list) {
    const checkId = String(it?.check_id ?? "");
    const clientTs = Number(it?.client_ts);
    if (!Number.isSafeInteger(clientTs) || clientTs < 0) throw new Error(`Invalid client_ts for ${checkId}`);
    const text = pspText(it?.fixed_text, 300, "fixed_text");
    const keys = (Array.isArray(it?.fix_photo_keys) ? it.fix_photo_keys : []).map((k) =>
      pspCheckKey(k, insp.bus_id, "fix_photo_keys")
    );
    if (keys.length > 5) throw new Error(`Invalid fix_photo_keys for ${checkId}: at most 5 photos`);
    const [res] = await conn.execute(
      `UPDATE PUSPAKOM_FAILED_ITEM
       SET fixed_text=?, fix_photo_keys=?, fixed_by=?, fixed_at=?, client_ts=?
       WHERE inspection_id=? AND check_id=? AND client_ts < ?`,
      [text, JSON.stringify(keys), userId, pspClientTime(it?.entered_at, now), clientTs, insp.parent_inspection_id, checkId, clientTs]
    );
    if (res.affectedRows) applied++;
  }
  await pspMarkStarted(conn, pre.precheck_id, userId, now);
  return json(200, { saved: applied });
}

async function pspSubmitRecheck(conn, auth, id, b) {
  const deny = requireRole(auth, PSP_TECH_ROLES);
  if (deny) return deny;
  const { insp, rootId, deny: lDeny } = await pspLoadOpenForTech(conn, auth, id);
  if (lDeny) return lDeny;
  if (insp.inspection_type !== "REINSPECTION") return json(400, { message: "Only a re-inspection has a re-check." });
  const sign = pspSignoff(b, insp.bus_id);

  const pre = await pspGetPrecheckRow(conn, id, "RECHECK");
  if (pre.submitted_at) return json(409, { code: "LOCKED", message: "This re-check was already submitted." });

  const [items] = await conn.execute(
    "SELECT check_id, fixed_text, fix_photo_keys FROM PUSPAKOM_FAILED_ITEM WHERE inspection_id=?",
    [insp.parent_inspection_id]
  );
  const missing = items
    .filter((f) => !String(f.fixed_text ?? "").trim() || pspJsonArr(f.fix_photo_keys).length < 1)
    .map((f) => f.check_id);
  if (missing.length) {
    return json(409, {
      code: "INCOMPLETE",
      message: "Add what was fixed and at least one photo for every failed check.",
      missing,
    });
  }

  const userId = await getOrCreateUserId(conn, auth);
  const now = new Date();
  const [res] = await conn.execute(
    `UPDATE PUSPAKOM_PRECHECK
     SET submitted_by=?, submitted_at=?, declared=1, verified_name=?, selfie_s3_bucket=?, selfie_s3_key=?
     WHERE precheck_id=? AND submitted_at IS NULL`,
    [userId, now, sign.name, S3_BUCKET, sign.key, pre.precheck_id]
  );
  if (!res.affectedRows) return json(409, { code: "LOCKED", message: "This re-check was already submitted." });

  const defs = await pspDefs(conn, insp.bus_model);
  const fixed = items.map((f) => ({ check_id: f.check_id, label: defs.byId.get(f.check_id)?.label ?? f.check_id }));
  await pspEvent(conn, {
    inspectionId: Number(id),
    rootId,
    type: "RECHECK_SUBMITTED",
    actorId: userId,
    at: now,
    detail: { fixed },
  });
  await pspNotifyFleetManagers(conn, {
    projectId: insp.project_id,
    excludeUserId: userId,
    type: "puspakom_recheck_submitted",
    title: `Re-check submitted: ${pspBusLabel(insp)}`,
    body: `${fixed.map((f) => `${f.check_id} ${f.label}`).join(", ")} fixed. Re-inspection ${pspFmtDateTime(insp.scheduled_at)}.`,
    inspectionId: Number(id),
  });
  return json(200, { inspection_id: Number(id), submitted_at: now.toISOString() });
}

/** The technician's list: every open inspection in their projects (no assignment step). */
async function pspListPrechecks(conn, auth, qs) {
  const deny = requireRole(auth, PSP_TECH_ROLES);
  if (deny) return deny;
  const { projectId, deny: pDeny } = await resolveSelectedProject(conn, auth, qs);
  if (pDeny) return pDeny;

  const buses = await pspLoadBuses(conn, auth, projectId);
  if (!buses.length) return json(200, { items: [] });
  const busById = new Map(buses.map((b) => [b.bus_id, b]));
  const ids = buses.map((b) => b.bus_id);

  const [rows] = await conn.execute(
    `SELECT i.inspection_id, i.bus_id, i.inspection_type, i.scheduled_at, i.booking_ref, i.notes,
            i.parent_inspection_id, i.registered_at, ru.user_name AS registered_by_name,
            p.precheck_id, p.kind, p.started_at, p.submitted_at, su.user_name AS submitted_by_name
     FROM PUSPAKOM_INSPECTION i
     JOIN PUSPAKOM_PRECHECK p ON p.inspection_id = i.inspection_id
     LEFT JOIN \`USER\` ru ON ru.user_id = i.registered_by
     LEFT JOIN \`USER\` su ON su.user_id = p.submitted_by
     WHERE i.result IS NULL AND i.bus_id IN (${pspPlaceholders(ids)})
     ORDER BY i.scheduled_at`,
    ids
  );

  const preIds = rows.filter((r) => r.kind === "PRE").map((r) => r.precheck_id);
  const answersBy = new Map();
  if (preIds.length) {
    const [ans] = await conn.execute(
      `SELECT * FROM PUSPAKOM_ANSWER WHERE precheck_id IN (${pspPlaceholders(preIds)})`,
      preIds
    );
    for (const a of ans) {
      const list = answersBy.get(a.precheck_id) ?? [];
      list.push({ ...a, damages: pspJsonArr(a.damages) });
      answersBy.set(a.precheck_id, list);
    }
  }
  const parentIds = rows.filter((r) => r.kind === "RECHECK").map((r) => r.parent_inspection_id);
  const failedBy = new Map();
  if (parentIds.length) {
    const [fr] = await conn.execute(
      `SELECT f.*, i.result_date FROM PUSPAKOM_FAILED_ITEM f JOIN PUSPAKOM_INSPECTION i ON i.inspection_id = f.inspection_id
       WHERE f.inspection_id IN (${pspPlaceholders(parentIds)})`,
      parentIds
    );
    for (const f of fr) {
      const list = failedBy.get(f.inspection_id) ?? [];
      list.push(f);
      failedBy.set(f.inspection_id, list);
    }
  }

  const cache = new Map();
  const items = [];
  for (const r of rows) {
    const bus = busById.get(r.bus_id);
    const defs = await pspDefs(conn, bus.bus_model, cache);
    let total;
    let done;
    let attention = 0;
    let failed = null;
    if (r.kind === "PRE") {
      const list = answersBy.get(r.precheck_id) ?? [];
      const byId = new Map(list.map((a) => [a.check_id, a]));
      total = defs.checks.length;
      done = defs.checks.filter((d) => pspAnswerDone(d.answer_type, byId.get(d.check_id))).length;
      attention = list.filter((a) => PSP_ATTENTION_TAGS.includes(a.tag)).length;
    } else {
      const list = failedBy.get(r.parent_inspection_id) ?? [];
      total = list.length;
      done = list.filter((f) => String(f.fixed_text ?? "").trim() && pspJsonArr(f.fix_photo_keys).length).length;
      failed = {
        failed_on: pspDateStr(list[0]?.result_date),
        checks: list.map((f) => ({
          check_id: f.check_id,
          label: defs.byId.get(f.check_id)?.label ?? f.check_id,
          puspakom_found: f.puspakom_found,
        })),
      };
    }
    const answered = r.kind === "PRE" ? (answersBy.get(r.precheck_id) ?? []).length : done;
    const { pill, tab } = pspTechPill({ kind: r.kind, answered, submitted: !!r.submitted_at });
    items.push({
      inspection_id: Number(r.inspection_id),
      bus_id: r.bus_id,
      bus_ev_no: bus.bus_ev_no ?? null,
      bus_model: bus.bus_model ?? null,
      inspection_type: r.inspection_type,
      scheduled_at: pspIso(r.scheduled_at),
      checklist_due: pspAddDays(pspMytDate(r.scheduled_at), -1),
      booking_ref: r.booking_ref ?? null,
      notes: r.notes ?? null,
      registered_by: r.registered_by_name ?? null,
      registered_at: pspIso(r.registered_at),
      kind: r.kind,
      pill,
      tab,
      total,
      done,
      needs_attention: attention,
      started_at: pspIso(r.started_at),
      submitted_at: pspIso(r.submitted_at),
      submitted_by: r.submitted_by_name ?? null,
      failed,
    });
  }
  return json(200, { today: pspMytDate(new Date()), items });
}

// ----- hourly tick: reminders and "needs the Fleet Manager" alerts -----

/** True the first time this key is seen (and records it); false ever after. */
async function pspFirstTime(conn, key) {
  const [res] = await conn.execute(
    "INSERT IGNORE INTO NOTIFICATION_DEDUPE (dedupe_key, last_sent_at) VALUES (?, NOW())",
    [key.slice(0, 191)]
  );
  return res.affectedRows === 1;
}

async function runPuspakomTick(conn) {
  const now = new Date();
  const today = pspMytDate(now);
  const settings = await pspSettings(conn);
  const [buses] = await conn.execute("SELECT bus_id, bus_ev_no, bus_model, project_id FROM BUS");
  const states = await pspStateForBuses(conn, buses, settings, now);
  let sent = 0;

  for (const s of states) {
    const label = pspBusLabel(s);
    // A bus that has never passed has no due date, so nothing has "turned"
    // Not booked: it just started that way. Only alert on real transitions.
    if (s.status === PSP_STATUS.NOT_BOOKED && s.next_due && (await pspFirstTime(conn, `psp:nb:${s.bus_id}:${s.next_due}`))) {
      await pspNotifyFleetManagers(conn, {
        projectId: s.project_id,
        type: "puspakom_not_booked",
        title: `PUSPAKOM due soon: ${label}`,
        body: `Due by ${pspFmtDate(s.next_due)} (${s.days_to_due} days). No inspection booked yet.`,
        inspectionId: null,
      });
      sent++;
    }
    if (s.status === PSP_STATUS.OVERDUE_NOT_BOOKED && (await pspFirstTime(conn, `psp:od:${s.bus_id}:${s.next_due}`))) {
      await pspNotifyFleetManagers(conn, {
        projectId: s.project_id,
        type: "puspakom_overdue",
        title: `PUSPAKOM overdue: ${label}`,
        body: `Was due by ${pspFmtDate(s.next_due)}. No inspection booked.`,
        inspectionId: null,
      });
      sent++;
    }
    if (
      s.status === PSP_STATUS.INSPECTED_UPDATE &&
      (await pspFirstTime(conn, `psp:res:${s.open.inspection_id}:${s.open.scheduled_at}`))
    ) {
      await pspNotifyFleetManagers(conn, {
        projectId: s.project_id,
        type: "puspakom_result_needed",
        title: `Record the PUSPAKOM result: ${label}`,
        body: `The inspection on ${pspFmtDateTime(s.open.scheduled_at)} has passed with no result recorded.`,
        inspectionId: s.open.inspection_id,
      });
      sent++;
    }
  }

  // 09:00 reminder on the checklist due day (the day before the inspection).
  const mytHour = new Date(now.getTime() + PSP_MYT_OFFSET_MS).getUTCHours();
  if (mytHour >= 9) {
    for (const s of states) {
      const o = s.open;
      if (!o || o.precheck_submitted_at || o.precheck_kind == null) continue;
      if (pspAddDays(pspMytDate(o.scheduled_at), -1) !== today) continue;
      if (!(await pspFirstTime(conn, `psp:rem:${o.inspection_id}:${today}`))) continue;
      const what = o.precheck_kind === "RECHECK" ? "Re-check" : "Pre-inspection checklist";
      await pspNotifyTechnicians(conn, {
        projectId: s.project_id,
        type: "puspakom_reminder",
        title: `${what} due today: ${pspBusLabel(s)}`,
        body: `PUSPAKOM ${PSP_TYPE_LABEL[o.inspection_type].toLowerCase()} inspection ${pspFmtDateTime(o.scheduled_at)}.`,
        inspectionId: o.inspection_id,
      });
      sent++;
    }
  }
  return { buses: states.length, sent };
}

// ----- reports, KPIs and the inspection report PDF -----
//
// One report per chain (the first booking and any re-inspections), created
// when the chain is recorded as Passed.

const PSP_REPORT_ROLES = ["admin", "fleet_manager", "rm_manager"];

/** Every inspection and failed item for these buses, oldest first. */
async function pspHistory(conn, busIds) {
  if (!busIds.length) return { insp: [], failed: [] };
  const ph = pspPlaceholders(busIds);
  const [insp] = await conn.execute(
    `SELECT inspection_id, bus_id, inspection_type, COALESCE(root_inspection_id, inspection_id) AS root_id,
            parent_inspection_id, scheduled_at, result, result_date, ref_no
     FROM PUSPAKOM_INSPECTION WHERE bus_id IN (${ph}) ORDER BY scheduled_at, inspection_id`,
    busIds
  );
  const [failed] = await conn.execute(
    `SELECT f.inspection_id, f.check_id FROM PUSPAKOM_FAILED_ITEM f
     JOIN PUSPAKOM_INSPECTION i ON i.inspection_id = f.inspection_id
     WHERE i.bus_id IN (${ph})`,
    busIds
  );
  return {
    insp: insp.map((r) => ({
      ...r,
      inspection_id: Number(r.inspection_id),
      root_id: Number(r.root_id),
      result_date: pspDateStr(r.result_date),
      sched_date: pspMytDate(r.scheduled_at),
    })),
    failed: failed.map((f) => ({ inspection_id: Number(f.inspection_id), check_id: f.check_id })),
  };
}

/** Group by chain; a chain is "closed" once an inspection in it passed. */
function pspChains(insp) {
  const chains = new Map();
  for (const r of insp) chains.set(r.root_id, [...(chains.get(r.root_id) ?? []), r]);
  return [...chains.values()].map((list) => {
    const root = list.find((r) => r.inspection_id === r.root_id) ?? list[0];
    const pass = list.find((r) => r.result === "PASSED") ?? null;
    return { root, list, pass };
  });
}

/** The due date a periodic booking was measured against: the previous pass + the cycle. */
function pspDueBefore(chains, busId, beforeDate, cycleMonths) {
  let last = null;
  for (const c of chains) {
    if (c.root.bus_id !== busId || c.root.inspection_type !== "PERIODIC" || !c.pass) continue;
    if (c.pass.result_date < beforeDate && (!last || c.pass.result_date > last)) last = c.pass.result_date;
  }
  return { lastPass: last, due: pspNextDue(last, cycleMonths) };
}

async function pspListReports(conn, auth, qs) {
  const deny = requireRole(auth, PSP_REPORT_ROLES);
  if (deny) return deny;
  const { projectId, deny: pDeny } = await resolveSelectedProject(conn, auth, qs);
  if (pDeny) return pDeny;

  const buses = await pspLoadBuses(conn, auth, projectId);
  const busById = new Map(buses.map((b) => [b.bus_id, b]));
  const { insp, failed } = await pspHistory(conn, buses.map((b) => b.bus_id));
  const reports = pspChains(insp)
    .filter((c) => c.pass)
    .map((c) => {
      const ids = new Set(c.list.map((r) => r.inspection_id));
      const bus = busById.get(c.root.bus_id);
      return {
        root_inspection_id: c.root.inspection_id,
        bus_id: c.root.bus_id,
        bus_ev_no: bus?.bus_ev_no ?? null,
        inspection_type: c.root.inspection_type,
        first_date: c.root.sched_date,
        passed_date: c.pass.result_date,
        attempts: c.list.length,
        first_time: c.list.length === 1,
        ref_no: c.root.ref_no ?? null,
        failed_checks: [...new Set(failed.filter((f) => ids.has(f.inspection_id)).map((f) => f.check_id))],
      };
    })
    .sort((a, b) => b.first_date.localeCompare(a.first_date) || b.root_inspection_id - a.root_inspection_id);
  return json(200, { reports });
}

/** Period for the KPIs: whole calendar months up to the end of last month. */
function pspKpiPeriod(period, today, earliest) {
  const [y, m] = today.split("-").map(Number);
  const monthStart = (yy, mm) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  if (period === "all") {
    const from = earliest ? `${earliest.slice(0, 7)}-01` : monthStart(y, m);
    return { from, to: today };
  }
  const n = period === "12m" ? 12 : 6;
  const to = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10); // last day of last month
  return { from: monthStart(y, m - n), to };
}

async function pspGetKpis(conn, auth, qs) {
  const deny = requireRole(auth, PSP_REPORT_ROLES);
  if (deny) return deny;
  const { projectId, deny: pDeny } = await resolveSelectedProject(conn, auth, qs);
  if (pDeny) return pDeny;
  const period = ["6m", "12m", "all"].includes(qs?.period) ? qs.period : "6m";

  const settings = await pspSettings(conn);
  const buses = await pspLoadBuses(conn, auth, projectId);
  const { insp, failed } = await pspHistory(conn, buses.map((b) => b.bus_id));
  const chains = pspChains(insp);
  const today = pspMytDate(new Date());
  const withResult = insp.filter((r) => r.result);
  const earliest = withResult.reduce((min, r) => (!min || r.result_date < min ? r.result_date : min), null);
  const { from, to } = pspKpiPeriod(period, today, earliest);
  const inRange = (d) => d && d >= from && d <= to;

  const results = withResult.filter((r) => inRange(r.result_date));
  const roots = results.filter((r) => r.inspection_id === r.root_id);
  const firstPass = roots.filter((r) => r.result === "PASSED").length;

  const periodic = roots.filter((r) => r.inspection_type === "PERIODIC");
  let onTimeTotal = 0;
  let onTime = 0;
  for (const r of periodic) {
    const { due } = pspDueBefore(chains, r.bus_id, r.sched_date, settings.cycleMonths);
    if (!due) continue; // first ever inspection: nothing to be on time for
    onTimeTotal++;
    if (r.sched_date <= due) onTime++;
  }

  const fails = results.filter((r) => r.result === "FAILED");
  const failIds = new Set(fails.map((r) => r.inspection_id));
  const defs = await pspDefs(conn, "*");
  const failedByBus = new Map();
  for (const f of failed.filter((x) => failIds.has(x.inspection_id))) {
    const r = fails.find((x) => x.inspection_id === f.inspection_id);
    failedByBus.set(r.bus_id, [...(failedByBus.get(r.bus_id) ?? []), defs.byId.get(f.check_id)?.label ?? f.check_id]);
  }

  // Each check PUSPAKOM has ever failed in these buses, counted in the period.
  const everFailed = [...new Set(failed.map((f) => f.check_id))];
  const failedItems = everFailed
    .map((id) => ({
      check_id: id,
      label: defs.byId.get(id)?.label ?? id,
      count: failed.filter((f) => f.check_id === id && failIds.has(f.inspection_id)).length,
    }))
    .sort((a, b) => b.count - a.count || a.check_id.localeCompare(b.check_id));

  // Average days from a Failed result to its re-inspection date.
  const gaps = fails
    .map((r) => insp.find((c) => c.parent_inspection_id != null && Number(c.parent_inspection_id) === r.inspection_id))
    .map((child, i) => (child ? pspDaysBetween(fails[i].result_date, child.sched_date) : null))
    .filter((x) => x != null);

  const months = [];
  for (let k = from.slice(0, 7); k <= to.slice(0, 7); ) {
    months.push({
      month: k,
      passed: results.filter((r) => r.result === "PASSED" && r.result_date.startsWith(k)).length,
      failed: results.filter((r) => r.result === "FAILED" && r.result_date.startsWith(k)).length,
    });
    const [yy, mm] = k.split("-").map(Number);
    k = new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 7);
    if (months.length > 240) break;
  }

  const byBus = buses
    .map((b) => {
      const mine = results.filter((r) => r.bus_id === b.bus_id);
      const myRoots = roots.filter((r) => r.bus_id === b.bus_id);
      return {
        bus_id: b.bus_id,
        bus_ev_no: b.bus_ev_no ?? null,
        inspections: mine.length,
        fails: mine.filter((r) => r.result === "FAILED").length,
        first_time: myRoots.length ? myRoots.every((r) => r.result === "PASSED") : null,
      };
    })
    .sort((a, b) => b.inspections - a.inspections || a.bus_id.localeCompare(b.bus_id));

  return json(200, {
    period: { key: period, from, to },
    first_time: { passed: firstPass, attempts: roots.length },
    inspections: {
      total: results.length,
      periodic: results.filter((r) => r.inspection_type === "PERIODIC").length,
      reinspection: results.filter((r) => r.inspection_type === "REINSPECTION").length,
      special: results.filter((r) => r.inspection_type === "SPECIAL").length,
    },
    failed: {
      count: fails.length,
      buses: [...failedByBus.entries()].map(([busId, items]) => ({
        bus_id: busId,
        bus_ev_no: buses.find((b) => b.bus_id === busId)?.bus_ev_no ?? null,
        items,
      })),
    },
    on_time: { on_time: onTime, total: onTimeTotal },
    per_month: months,
    failed_items: failedItems,
    avg_fail_to_re_days: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    by_bus: byBus,
  });
}

/** Everything the PUSPAKOM Inspection Report PDF prints (the renderer has no DB). */
async function pspBuildReportData(conn, rootId) {
  const [rootRows] = await conn.execute(
    `SELECT i.*, b.bus_ev_no, b.bus_model FROM PUSPAKOM_INSPECTION i JOIN BUS b ON b.bus_id = i.bus_id
     WHERE i.inspection_id=?`,
    [rootId]
  );
  if (!rootRows.length) return null;
  const root = rootRows[0];
  const settings = await pspSettings(conn);
  const defs = await pspDefs(conn, root.bus_model);
  const label = (id) => defs.byId.get(id)?.label ?? id;
  const stopName = (id) => defs.stops.find((s) => s.stop_no === defs.byId.get(id)?.stop_no)?.stop_name ?? "";

  const [chain] = await conn.execute(
    `SELECT i.*, ru.user_name AS registered_by_name, xu.user_name AS result_by_name
     FROM PUSPAKOM_INSPECTION i
     LEFT JOIN \`USER\` ru ON ru.user_id = i.registered_by
     LEFT JOIN \`USER\` xu ON xu.user_id = i.result_by
     WHERE COALESCE(i.root_inspection_id, i.inspection_id)=? ORDER BY i.scheduled_at, i.inspection_id`,
    [rootId]
  );
  const ids = chain.map((c) => Number(c.inspection_id));
  const ph = pspPlaceholders(ids);
  const pass = chain.find((c) => c.result === "PASSED") ?? null;

  const [pres] = await conn.execute(
    `SELECT p.*, u.user_name AS submitted_by_name FROM PUSPAKOM_PRECHECK p
     LEFT JOIN \`USER\` u ON u.user_id = p.submitted_by WHERE p.inspection_id IN (${ph})`,
    ids
  );
  const pre = pres.find((p) => p.kind === "PRE") ?? null;
  let answers = [];
  if (pre) {
    const [a] = await conn.execute("SELECT * FROM PUSPAKOM_ANSWER WHERE precheck_id=?", [pre.precheck_id]);
    answers = a.map((x) => ({ ...x, damages: pspJsonArr(x.damages) }));
  }
  const [failedRows] = await conn.execute(
    `SELECT f.*, u.user_name AS fixed_by_name FROM PUSPAKOM_FAILED_ITEM f
     LEFT JOIN \`USER\` u ON u.user_id = f.fixed_by WHERE f.inspection_id IN (${ph}) ORDER BY f.inspection_id, f.check_id`,
    ids
  );
  const [slips] = await conn.execute(
    `SELECT m.*, u.user_name AS by_name FROM PUSPAKOM_MEDIA m LEFT JOIN \`USER\` u ON u.user_id = m.uploaded_by
     WHERE m.inspection_id IN (${ph}) ORDER BY m.uploaded_at, m.media_id`,
    ids
  );
  const [events] = await conn.execute(
    `SELECT e.*, u.user_name AS actor_name FROM PUSPAKOM_EVENT e LEFT JOIN \`USER\` u ON u.user_id = e.actor_user_id
     WHERE e.root_inspection_id=? ORDER BY e.event_at, e.event_id`,
    [rootId]
  );

  // Due dates around this chain: the pass before it, and the next due after it.
  const [prev] = await conn.execute(
    `SELECT MAX(i.result_date) AS d FROM PUSPAKOM_INSPECTION i
     JOIN PUSPAKOM_INSPECTION r ON r.inspection_id = COALESCE(i.root_inspection_id, i.inspection_id)
     WHERE i.bus_id=? AND i.result='PASSED' AND r.inspection_type='PERIODIC' AND i.result_date < ?`,
    [root.bus_id, pspMytDate(root.scheduled_at)]
  );
  const lastPassed = pspDateStr(prev[0]?.d);
  const passDate = pspDateStr(pass?.result_date);

  const attention = defs.checks
    .map((d) => ({ def: d, a: answers.find((x) => x.check_id === d.check_id) }))
    .filter(({ a }) => a && PSP_ATTENTION_TAGS.includes(a.tag));

  const answerText = (d, a) => {
    if (d.answer_type === "TYRE") return `${a.tread_mm ?? "—"} mm · ${a.pressure_psi ?? "—"} psi`;
    if (d.answer_type === "BRAKE") return `${a.pad_mm ?? "—"} mm`;
    if (d.answer_type === "BODY") return a.damages.map((x) => `${x.no}. ${x.type ?? ""} ${x.where ?? ""}`.trim()).join("; ");
    return a.answer === "NG" ? `NG${a.ng_reason ? ` · ${a.ng_reason.replace("_", " ").toLowerCase()}` : ""}` : String(a.answer ?? "");
  };
  const TAG_TEXT = { NG: "NG", REPLACE: "REPLACE", LOW: "LOW", CHECK_SOON: "CHECK SOON", DAMAGE: "DAMAGE", OK: "OK" };

  const photo = (key, caption, at) => ({ bucket: S3_BUCKET, key, caption, at });
  const groups = [];
  if (attention.length) {
    groups.push({
      title: "Needs attention",
      indexTitle: "Needs attention (pre-inspection)",
      by: pre?.submitted_by_name ?? null,
      at: pre?.submitted_at ?? null,
      photos: attention.flatMap(({ def, a }) => [
        ...(a.photo_s3_key ? [photo(a.photo_s3_key, `${def.check_id} ${def.label}: ${answerText(def, a)}`, a.entered_at)] : []),
        ...a.damages.filter((x) => x.photo_s3_key).map((x) =>
          photo(x.photo_s3_key, `${def.check_id} damage ${x.no}: ${x.type ?? ""} ${x.where ?? ""}`.trim(), a.entered_at)
        ),
      ]),
      checks: attention.map(({ def }) => def.check_id),
    });
  }
  for (const f of failedRows) {
    const keys = pspJsonArr(f.fix_photo_keys);
    if (!keys.length) continue;
    groups.push({
      title: `Re-check: ${f.check_id} ${label(f.check_id)}`,
      indexTitle: `Re-check: ${f.check_id} ${label(f.check_id)}`,
      by: f.fixed_by_name ?? null,
      at: f.fixed_at,
      photos: keys.map((k, i) => photo(k, `${f.check_id} ${label(f.check_id)}: after the fix (${i + 1})`, f.fixed_at)),
      fix: `${f.inspection_id}:${f.check_id}`,
    });
  }
  for (const c of chain.filter((x) => x.result)) {
    const list = slips.filter((m) => Number(m.inspection_id) === Number(c.inspection_id));
    if (!list.length) continue;
    const res = c.result === "PASSED" ? "Passed" : "Failed";
    groups.push({
      title: `PUSPAKOM result slip (${res})`,
      indexTitle: `PUSPAKOM result slip (${res})`,
      by: c.result_by_name ?? null,
      at: c.result_at,
      photos: list.map((m) => photo(m.s3_key, `PUSPAKOM result slip, ${res}`, m.uploaded_at)),
      slipOf: Number(c.inspection_id),
    });
  }

  const typeLong = { PERIODIC: "Periodic (Berkala)", REINSPECTION: "Re-inspection (Berkala Semula)", SPECIAL: "Special (Khas)" };
  const failedChecks = [...new Set(failedRows.map((f) => f.check_id))];
  const recheckPre = pres.filter((p) => p.kind === "RECHECK" && p.submitted_at);

  return {
    kind: "puspakom",
    ref_no: root.ref_no,
    issued_at: root.report_issued_at ?? new Date(),
    vehicle: { plate: root.bus_id, fleet_no: root.bus_ev_no ?? null, model: root.bus_model ?? null },
    type: typeLong[root.inspection_type],
    is_periodic: root.inspection_type === "PERIODIC",
    registered_by: root.registered_by_name ?? null,
    booking_ref: root.booking_ref ?? null,
    first_inspection: root.scheduled_at,
    result: pass ? "PASSED" : "OPEN",
    attempts: chain.length,
    passed_date: passDate,
    days_to_pass: passDate ? pspDaysBetween(pspMytDate(root.scheduled_at), passDate) : null,
    last_passed: lastPassed,
    due_by: pspNextDue(lastPassed, settings.cycleMonths),
    next_due: pass && root.inspection_type === "PERIODIC" ? pspNextDue(passDate, settings.cycleMonths) : null,
    failed_checks: failedChecks.map((id) => `${id} ${label(id)}`),
    precheck: pre && {
      submitted_by: pre.submitted_by_name ?? null,
      submitted_at: pre.submitted_at,
      declared: !!pre.declared,
      remarks: pre.remarks ?? null,
      total: defs.checks.length,
      stops: defs.stops.length,
      done: defs.checks.filter((d) => pspAnswerDone(d.answer_type, answers.find((x) => x.check_id === d.check_id))).length,
      photos: answers.reduce((n, a) => n + (a.photo_s3_key ? 1 : 0) + a.damages.filter((x) => x.photo_s3_key).length, 0),
      attention: attention.map(({ def, a }) => ({
        check_id: def.check_id,
        label: def.label,
        stop: `${def.stop_no} ${stopName(def.check_id)}`,
        result: `${answerText(def, a)} · ${TAG_TEXT[a.tag]}`,
        note: a.note ?? null,
      })),
    },
    rechecks: failedRows.map((f) => {
      const failInsp = chain.find((c) => Number(c.inspection_id) === Number(f.inspection_id));
      const sub = recheckPre.find((p) => {
        const child = chain.find((c) => Number(c.parent_inspection_id) === Number(f.inspection_id));
        return child && Number(p.inspection_id) === Number(child.inspection_id);
      });
      return {
        key: `${f.inspection_id}:${f.check_id}`,
        check: `${f.check_id} ${label(f.check_id)}`,
        failed_on: pspDateStr(failInsp?.result_date),
        found: f.puspakom_found,
        fixed: f.fixed_text ?? null,
        fixed_by: f.fixed_by_name ?? null,
        done_at: sub?.submitted_at ?? f.fixed_at ?? null,
        slip_inspection_id: Number(f.inspection_id),
      };
    }),
    events: events.map((e) => ({
      inspection_id: Number(e.inspection_id),
      type: e.event_type,
      by: e.actor_name ?? null,
      at: e.event_at,
      detail: typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail ?? {},
    })),
    photo_groups: groups,
  };
}

function pspPdfKey(refNo, plate) {
  return `${PDF_OUT_PREFIX}puspakom/${refNo}_${safeFilePart(plate) || "BUS"}.pdf`;
}

async function pspQueueReportPdf(conn, rootId) {
  const refNo = await pspEnsureRefNo(conn, rootId);
  const data = await pspBuildReportData(conn, rootId);
  if (!data || !refNo) return null;
  const outKey = pspPdfKey(refNo, data.vehicle.plate);
  const issuedAt = data.issued_at instanceof Date ? data.issued_at : new Date(data.issued_at);
  await putQueueFile(`${PDF_QUEUE_PREFIX}puspakom-${rootId}-${Date.now()}.json`, {
    ...data,
    ref_no: refNo,
    issued_at: issuedAt,
    out_bucket: S3_BUCKET,
    out_key: outKey,
  });
  await conn.execute(
    `UPDATE PUSPAKOM_INSPECTION SET report_pdf_s3_key=?, report_issued_at=COALESCE(report_issued_at, ?)
     WHERE inspection_id=?`,
    [outKey, issuedAt, rootId]
  );
  return outKey;
}

const _pspPdfQueuedAt = new Map();

/** GET /puspakom/inspections/{id}/report-pdf: same contract as /jobs/{id}/report-pdf. */
async function pspGetReportPdf(conn, auth, id) {
  const deny = requireRole(auth, PSP_REPORT_ROLES);
  if (deny) return deny;
  const [rows] = await conn.execute(
    `SELECT i.bus_id, COALESCE(i.root_inspection_id, i.inspection_id) AS root_id FROM PUSPAKOM_INSPECTION i WHERE i.inspection_id=?`,
    [id]
  );
  if (!rows.length) return json(404, { message: "Inspection not found" });
  const scopeDeny = await assertBusInScope(conn, auth, rows[0].bus_id);
  if (scopeDeny) return scopeDeny;
  const rootId = Number(rows[0].root_id);
  const [passed] = await conn.execute(
    "SELECT 1 FROM PUSPAKOM_INSPECTION WHERE COALESCE(root_inspection_id, inspection_id)=? AND result='PASSED' LIMIT 1",
    [rootId]
  );
  if (!passed.length) {
    return json(409, { code: "NOT_PASSED", message: "The inspection report is made once the bus passes." });
  }
  const [root] = await conn.execute("SELECT report_pdf_s3_key FROM PUSPAKOM_INSPECTION WHERE inspection_id=?", [rootId]);
  const refNo = await pspEnsureRefNo(conn, rootId);
  const key = root[0]?.report_pdf_s3_key || pspPdfKey(refNo, rows[0].bus_id);
  const filename = key.split("/").pop();

  if (await s3ObjectExists(key)) {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
        ResponseContentType: "application/pdf",
      }),
      { expiresIn: VIEW_URL_TTL_S }
    );
    return json(200, { status: "ready", url, filename, ref_no: refNo });
  }
  const last = _pspPdfQueuedAt.get(rootId) ?? 0;
  if (Date.now() - last > PDF_REQUEUE_AFTER_MS) {
    await pspQueueReportPdf(conn, rootId);
    _pspPdfQueuedAt.set(rootId, Date.now());
  }
  return json(200, { status: "pending", filename, ref_no: refNo });
}
