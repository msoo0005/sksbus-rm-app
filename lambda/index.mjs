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
async function notifyUsers(conn, { userIds, type, title, body = null, reportId = null, jobId = null }) {
  if (!userIds?.length) {
    plog("notify.recipients", { type, title, count: 0, reason: "none" });
    return;
  }
  plog("notify.recipients", { type, title, count: userIds.length, userIds });

  try {
    const rowPlaceholders = [];
    const values = [];
    for (const userId of userIds) {
      rowPlaceholders.push("(?,?,?,?,?,?)");
      values.push(userId, type, title, body, reportId, jobId);
    }
    await conn.execute(
      `INSERT INTO NOTIFICATION (user_id, notification_type, notification_title, notification_body, report_id, job_id)
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
    data: { type, reportId, jobId },
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
    `SELECT notification_id, notification_type, notification_title, notification_body,
            report_id, job_id, is_read, created_at
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
