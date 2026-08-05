// index.mjs (ESM)

import mysql from "mysql2/promise";
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
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

    if (method === "POST" && path === "/reports") {
      return await withConn((c) => createReport(c, auth, mustJson(event)));
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
      return await withConn((c) => assignJobToMe(c, auth, jobId));
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
      return await withConn((c) => getOverdueTyreInspections(c, auth));
    }

    if (method === "GET" && path === "/tyres/low-tread") {
      return await withConn((c) => getLowTreadTyres(c, auth));
    }

    if (method === "GET" && path === "/tyres/settings") {
      return await withConn((c) => getTyreSettings(c, auth));
    }

    if (method === "PATCH" && path === "/tyres/settings") {
      return await withConn((c) => updateTyreSettings(c, auth, mustJson(event)));
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
    console.error("Lambda error:", e);
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

async function withConn(fn) {
  const c = await pool.getConnection();
  try {
    return await fn(c);
  } finally {
    c.release();
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
const isReportsMediaListPath = (p) => /^\/reports\/\d+\/media$/.test(p);
const isReportsMediaPresignPath = (p) => /^\/reports\/\d+\/media\/presign$/.test(p);
const isReportsMediaConfirmPath = (p) => /^\/reports\/\d+\/media\/confirm$/.test(p);

const isJobIdPath = (p) => /^\/jobs\/\d+$/.test(p);
const isJobsAssignPath = (p) => /^\/jobs\/\d+\/assign$/.test(p);
const isJobsPartsPath = (p) => /^\/jobs\/\d+\/parts$/.test(p);
const isJobsStatusPath = (p) => /^\/jobs\/\d+\/status$/.test(p);
const isJobsHistoryPath = (p) => /^\/jobs\/\d+\/history$/.test(p);
const isJobsMediaListPath = (p) => /^\/jobs\/\d+\/media$/.test(p);
const isJobsMediaPresignPath = (p) => /^\/jobs\/\d+\/media\/presign$/.test(p);
const isJobsMediaConfirmPath = (p) => /^\/jobs\/\d+\/media\/confirm$/.test(p);

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
    email: claims.email ?? "",
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

// Best-effort: a push failure (bad token, Expo outage) must never break the
// primary operation, same contract as the in-app NOTIFICATION insert below.
async function sendExpoPushNotifications(conn, { userIds, title, body, data }) {
  try {
    if (!userIds?.length) return;

    const placeholders = userIds.map(() => "?").join(",");
    const [rows] = await conn.execute(
      `SELECT DISTINCT expo_push_token FROM PUSH_TOKEN WHERE user_id IN (${placeholders})`,
      userIds
    );
    const tokens = (rows || [])
      .map((r) => r.expo_push_token)
      .filter((t) => EXPO_PUSH_TOKEN_RE.test(t));
    if (!tokens.length) return;

    const messages = tokens.map((to) => ({
      to,
      title,
      body: body ?? undefined,
      data: data ?? {},
      sound: "default",
    }));

    // Expo's push API caps each request at 100 messages.
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        console.error("Expo push send failed", res.status, await res.text().catch(() => ""));
      }
    }
  } catch (e) {
    console.error("Failed to send push notifications", { title, e: e?.message });
  }
}

// Best-effort: a notification failure (e.g. the NOTIFICATION table hasn't
// been migrated in yet) must never break the primary operation it's attached to.
async function notifyUsersByRole(conn, { roles, type, title, body = null, reportId = null, jobId = null }) {
  try {
    if (!roles?.length) return;

    const rolePlaceholders = roles.map(() => "?").join(",");
    const [users] = await conn.execute(
      `SELECT user_id FROM \`USER\` WHERE user_role IN (${rolePlaceholders})`,
      roles
    );
    if (!users.length) return;

    const rowPlaceholders = [];
    const values = [];
    for (const u of users) {
      rowPlaceholders.push("(?,?,?,?,?,?)");
      values.push(u.user_id, type, title, body, reportId, jobId);
    }

    await conn.execute(
      `INSERT INTO NOTIFICATION (user_id, notification_type, notification_title, notification_body, report_id, job_id)
       VALUES ${rowPlaceholders.join(",")}`,
      values
    );

    await sendExpoPushNotifications(conn, {
      userIds: users.map((u) => u.user_id),
      title,
      body,
      data: { type, reportId, jobId },
    });
  } catch (e) {
    console.error("Failed to create notifications", { type, title, e: e?.message });
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

  const userId = await getOrCreateUserId(conn, auth);
  // A device's token is unique — if it's re-registered under a different
  // signed-in user (e.g. shared device, logout/login), reassign it rather
  // than erroring on the unique constraint.
  await conn.execute(
    `INSERT INTO PUSH_TOKEN (user_id, expo_push_token) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), updated_at = NOW()`,
    [userId, token]
  );
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

async function listMyProjects(conn, auth) {
  const deny = requireRole(auth, [
    "admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver",
  ]);
  if (deny) return deny;

  const userId = await getOrCreateUserId(conn, auth);

  const [rows] = await conn.execute(
    `SELECT p.project_id, p.project_name, p.project_desc
     FROM USER_PROJECT up
     JOIN PROJECT p ON p.project_id = up.project_id
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
    `SELECT project_id, project_name, project_desc
     FROM PROJECT
     ORDER BY project_name ASC, project_id ASC`
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
      `SELECT bus_id, bus_route, bus_model, project_id
       FROM BUS WHERE project_id=? ORDER BY bus_id ASC`,
      [projectId]
    );
    return json(200, rows);
  }

  if (auth.role === "admin") {
    const [rows] = await conn.execute(
      "SELECT bus_id, bus_route, bus_model, project_id FROM BUS ORDER BY bus_id ASC"
    );
    return json(200, rows);
  }

  const userId = await getOrCreateUserId(conn, auth);

  const [rows] = await conn.execute(
    `SELECT b.bus_id, b.bus_route, b.bus_model, b.project_id
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
    `INSERT INTO BUS (bus_id, bus_route, bus_model, project_id) VALUES (?, ?, ?, ?)`,
    [
      String(b.bus_id).trim(),
      b.bus_route ? String(b.bus_route).trim() : null,
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

  if (b.bus_id != null)          { updates.push("bus_id=?");     vals.push(String(b.bus_id).trim()); }
  if (b.bus_route !== undefined)  { updates.push("bus_route=?");  vals.push(b.bus_route ? String(b.bus_route).trim() : null); }
  if (b.bus_model !== undefined)  { updates.push("bus_model=?");  vals.push(b.bus_model ? String(b.bus_model).trim() : null); }
  if (b.project_id !== undefined) { updates.push("project_id=?"); vals.push(b.project_id ? String(b.project_id).trim() : null); }

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

async function getParts(conn, auth, qs) {
  const deny = requireRole(auth, [
    "admin", "inventory_manager", "technician", "fleet_manager", "rm_manager",
  ]);
  if (deny) return deny;

  const raw = qs?.limit;
  let limit = 200;
  if (raw != null) {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n > 0) limit = Math.min(n, 200);
  }

  const [rows] = await conn.query(
    `SELECT part_id, part_name, part_code, part_cost, part_stock FROM PART ORDER BY part_name ASC LIMIT ${limit}`
  );
  return json(200, rows);
}

async function createPart(conn, auth, b) {
  const deny = requireRole(auth, ["admin", "inventory_manager"]);
  if (deny) return deny;

  if (!b.part_name) throw new Error("part_name is required");
  if (!b.part_code) throw new Error("part_code is required");

  const cost = b.part_cost == null ? null : Number(b.part_cost);
  if (cost != null && !Number.isFinite(cost)) throw new Error("Invalid part_cost");

  const stock = b.part_stock == null ? 0 : Number(b.part_stock);
  if (!Number.isFinite(stock)) throw new Error("Invalid part_stock");

  await conn.execute(
    "INSERT INTO PART (part_name, part_code, part_cost, part_stock) VALUES (?,?,?,?)",
    [String(b.part_name), String(b.part_code), cost, stock]
  );

  return json(200, { success: true });
}

async function updatePart(conn, auth, partId, b) {
  const deny = requireRole(auth, ["admin", "inventory_manager"]);
  if (deny) return deny;

  const updates = [];
  const vals = [];

  if (b.part_name != null) { updates.push("part_name=?"); vals.push(String(b.part_name)); }
  if (b.part_code != null) { updates.push("part_code=?"); vals.push(String(b.part_code)); }
  if (b.part_cost != null) {
    const cost = Number(b.part_cost);
    if (!Number.isFinite(cost)) throw new Error("Invalid part_cost");
    updates.push("part_cost=?"); vals.push(cost);
  }
  if (b.part_stock != null) {
    const stock = Number(b.part_stock);
    if (!Number.isFinite(stock)) throw new Error("Invalid part_stock");
    updates.push("part_stock=?"); vals.push(stock);
  }

  if (!updates.length) return json(200, { success: true });

  vals.push(partId);
  await conn.execute(`UPDATE PART SET ${updates.join(", ")} WHERE part_id=?`, vals);
  return json(200, { success: true });
}

// ===================== REPORTS =====================

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

  const sql = `
    SELECT
      r.report_id, r.report_type, r.report_desc, r.report_location,
      r.report_lat, r.report_lng, r.report_priority, r.report_status,
      r.report_uploaded_at, r.user_id, r.bus_id, r.job_id,
      r.report_review_action, r.report_review_reason, r.report_review_by, r.report_review_at,
      u.user_name AS reporter_name, u.user_email AS reporter_email,
      b.bus_route, b.bus_model
    FROM REPORT r
    LEFT JOIN \`USER\` u ON u.user_id = r.user_id
    LEFT JOIN BUS b ON b.bus_id = r.bus_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY r.report_uploaded_at DESC, r.report_id DESC
    LIMIT 200
  `;

  const [rows] = await conn.execute(sql, vals);
  return json(200, rows);
}

async function getReport(conn, auth, reportId) {
  const deny = requireRole(auth, [
    "admin", "fleet_manager", "rm_manager", "technician", "inventory_manager", "driver",
  ]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT r.*, u.user_name AS reporter_name, u.user_email AS reporter_email
     FROM REPORT r LEFT JOIN \`USER\` u ON u.user_id=r.user_id
     WHERE r.report_id=?`,
    [reportId]
  );

  if (!rows.length) return json(404, { message: "Report not found" });

  if (auth.role === "driver") {
    const userId = await getOrCreateUserId(conn, auth);
    if (Number(rows[0].user_id) !== userId) return json(403, { message: "Forbidden" });
  }

  return json(200, rows[0]);
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

  const [res] = await conn.execute(
    `INSERT INTO REPORT
     (project_id, report_type, report_desc, report_location, report_lat, report_lng,
      report_priority, report_status, user_id, bus_id, report_uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, NOW())`,
    [
      projectId, b.report_type, b.report_desc ?? null,
      b.report_location ?? null, b.report_lat ?? null, b.report_lng ?? null,
      b.report_priority ?? "medium", userId, b.bus_id,
    ]
  );

  const reportId = res.insertId;

  const reporterName = await getDisplayName(conn, auth);
  await notifyUsersByRole(conn, {
    roles: ["admin", "rm_manager"],
    type: "new_report",
    title: "New report submitted",
    body: `${reporterName} submitted a ${b.report_type} report for bus ${b.bus_id}.`,
    reportId,
  });

  return json(200, { report_id: reportId });
}

async function updateReportStatus(conn, auth, reportId, b) {
  if (!b.report_status) throw new Error("report_status is required");

  const nextStatus = String(b.report_status).trim().toLowerCase();
  const action = b.report_review_action != null ? String(b.report_review_action).trim().toLowerCase() : null;

  if (auth.role === "technician") {
    // Technicians may only close the report tied to their own job when completing it —
    // approve/decline stays exclusive to admin/fleet_manager/rm_manager below.
    if (nextStatus !== "closed" || action != null) {
      return json(403, { code: "FORBIDDEN", message: "Forbidden" });
    }
    const techUserId = await getOrCreateUserId(conn, auth);
    const [chk] = await conn.execute(
      `SELECT r.report_id FROM REPORT r JOIN JOB j ON j.job_id = r.job_id
       WHERE r.report_id=? AND j.technician_user_id=? LIMIT 1`,
      [reportId, techUserId]
    );
    if (!chk.length) return json(403, { code: "FORBIDDEN", message: "Forbidden" });
  } else {
    const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager"]);
    if (deny) return deny;
  }

  const shouldCreateJob = action === "approved" || nextStatus === "open";

  await conn.beginTransaction();
  try {
    const [rRows] = await conn.execute(
      `SELECT report_id, job_id FROM REPORT WHERE report_id=? FOR UPDATE`,
      [reportId]
    );

    if (!rRows.length) { await conn.rollback(); return json(404, { message: "Report not found" }); }

    let jobId = rRows[0].job_id ? Number(rRows[0].job_id) : null;
    const jobWasCreated = shouldCreateJob && !jobId;

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

    if (b.report_review_action != null)    { updates.push("report_review_action=?");  values.push(b.report_review_action); }
    if (b.report_review_reason !== undefined) { updates.push("report_review_reason=?"); values.push(b.report_review_reason ?? null); }
    if (b.report_review_by != null)        { updates.push("report_review_by=?");      values.push(b.report_review_by); }
    if (b.report_review_at != null)        { updates.push("report_review_at=?");      values.push(b.report_review_at); }

    values.push(reportId);
    await conn.execute(`UPDATE REPORT SET ${updates.join(", ")} WHERE report_id=?`, values);
    await conn.commit();

    if (jobWasCreated) {
      await notifyUsersByRole(conn, {
        roles: ["technician"],
        type: "new_job",
        title: "New job available",
        body: `A new job is available to accept (from report #${reportId}).`,
        reportId,
        jobId,
      });
    }

    return json(200, { success: true, job_id: jobId });
  } catch (e) {
    await conn.rollback();
    throw e;
  }
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
    `SELECT technician_user_id, job_odometer FROM JOB WHERE job_id=? LIMIT 1`,
    [jobId]
  );

  if (!rows.length) throw new Error("job_id not found");
  if (rows[0].technician_user_id == null) return json(409, { code: "JOB_NOT_ACCEPTED", message: "Job not accepted yet" });
  if (Number(rows[0].technician_user_id) !== techUserId) return json(403, { code: "FORBIDDEN", message: "Forbidden" });
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
      `UPDATE JOB SET job_odometer=?, job_updated_at=NOW() WHERE job_id=? AND technician_user_id=? AND job_odometer IS NULL`,
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

  await conn.execute(`UPDATE JOB SET job_odometer=?, job_updated_at=NOW() WHERE job_id=?`, [odo, jobId]);
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

async function assignJobToMe(conn, auth, jobId) {
  const deny = requireRole(auth, ["technician", "admin"]);
  if (deny) return deny;

  const techUserId = await getOrCreateUserId(conn, auth);
  const [res] = await conn.execute(
    `UPDATE JOB SET technician_user_id=?, job_accepted_at=NOW(), job_updated_at=NOW() WHERE job_id=? AND technician_user_id IS NULL`,
    [techUserId, jobId]
  );
  if (!res.affectedRows) return json(409, { message: "Job already assigned (or not found)" });

  const technicianName = await getDisplayName(conn, auth);
  await notifyUsersByRole(conn, {
    roles: ["admin", "rm_manager"],
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
  const where = [];
  const vals = [];
  if (status) { where.push("j.job_status=?"); vals.push(status); }
  if (projectId) { where.push("r.project_id=?"); vals.push(projectId); }

  const sql = `
    SELECT
      j.job_id, j.job_desc, j.job_status, j.technician_user_id,
      tech.user_name AS technician_name,
      j.job_odometer, j.job_created_at, j.job_accepted_at, j.job_updated_at, j.job_completed_at,
      r.report_id, r.report_type, r.report_priority, r.report_desc,
      r.report_location, r.report_uploaded_at, r.bus_id, r.project_id,
      reporter.user_name AS reporter_name
    FROM JOB j
    LEFT JOIN REPORT r ON r.job_id = j.job_id
    LEFT JOIN \`USER\` reporter ON reporter.user_id = r.user_id
    LEFT JOIN \`USER\` tech ON tech.user_id = j.technician_user_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY j.job_created_at DESC, j.job_id DESC
    LIMIT 200
  `;

  const [rows] = await conn.execute(sql, vals);
  return json(200, rows);
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
    `SELECT t.task_id, t.task_name, tp.part_id, tp.qty AS jp_qty, tp.line_cost AS jp_linecost, p.part_name, p.part_code, p.part_cost
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

  const lock = await assertTechJobUnlocked(conn, auth, jobId);
  if (lock) return lock;

  if (!b.to_status) throw new Error("to_status is required");
  const toStatus = String(b.to_status);
  const isTerminal = toStatus === "closed" || toStatus === "completed" || toStatus === "done";
  if (isTerminal) {
    await conn.execute(
      "UPDATE JOB SET job_status=?, job_updated_at=NOW(), job_completed_at=NOW() WHERE job_id=?",
      [toStatus, jobId]
    );
  } else {
    await conn.execute(
      "UPDATE JOB SET job_status=?, job_updated_at=NOW() WHERE job_id=?",
      [toStatus, jobId]
    );
  }

  await notifyUsersByRole(conn, {
    roles: ["admin", "rm_manager"],
    type: "job_progress",
    title: isTerminal ? "Job completed" : "Job status updated",
    body: `Job #${jobId} status changed to "${toStatus}".`,
    jobId,
  });

  return json(200, { success: true });
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

  if (!b.task_name) throw new Error("task_name is required");

  const taskStatus = b.task_status ?? "pending";
  const [res] = await conn.execute(
    `INSERT INTO JOB_TASK (job_id, task_name, task_desc, task_status, task_order, completed_at, created_at) VALUES (?,?,?,?,?,NOW(),NOW())`,
    [jobId, b.task_name, b.task_desc ?? null, taskStatus, b.task_order ?? 1]
  );

  if (taskStatus === "done") {
    const technicianName = await getDisplayName(conn, auth);
    await notifyUsersByRole(conn, {
      roles: ["admin", "rm_manager"],
      type: "job_progress",
      title: "Job progress update",
      body: `${technicianName} completed a task on Job #${jobId}: ${b.task_name}.`,
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

  const lock = await assertTechTaskUnlocked(conn, auth, taskId);
  if (lock) return lock;

  const [rows] = await conn.execute(
    `SELECT tp.task_id, tp.part_id, tp.qty, tp.line_cost, p.part_name, p.part_code, p.part_cost, p.part_stock
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
  const rawQty = b.qty ?? b.jp_qty ?? 1;
  const qty = toWholeNumber(rawQty, "qty");
  if (qty <= 0) throw new Error("qty must be a whole number > 0");

  let lineCost = null;
  if (b.line_cost != null || b.jp_linecost != null) {
    const lc = Number(b.line_cost ?? b.jp_linecost);
    if (!Number.isFinite(lc)) throw new Error("Invalid line_cost");
    lineCost = lc;
  } else {
    const [pRows] = await conn.execute(`SELECT part_cost FROM PART WHERE part_id=? LIMIT 1`, [partId]);
    const unit = pRows?.length ? Number(pRows[0].part_cost) : NaN;
    if (Number.isFinite(unit)) lineCost = unit * qty;
  }

  await conn.execute(
    `INSERT INTO JOB_TASK_PART (task_id, part_id, qty, line_cost) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty), line_cost = COALESCE(line_cost, 0) + COALESCE(VALUES(line_cost), 0)`,
    [taskId, partId, qty, lineCost]
  );
  return json(200, { success: true });
}

// ===================== TYRES =====================

const TYRE_AXLE_SIDES = ["left", "right"];
const TYRE_WHEEL_POSITIONS = ["single", "inner", "outer"];
const TYRE_INSPECTION_RESULTS = ["pass", "monitor", "reject"];
// Statuses a tyre may be moved to directly via PATCH/unmount — "mounted" is
// only ever set by swapTyre, so it's excluded here to keep TYRE_MOUNTING the
// single source of truth for "is this tyre currently on a bus".
const TYRE_MANUAL_STATUSES = ["spare", "rejected", "retreading", "retired"];
const TYRE_UNMOUNTABLE_STATUSES = ["rejected", "retired", "retreading"];
// Any tyre whose most recently recorded groove reading is below this is
// surfaced by getLowTreadTyres() regardless of the technician's pass/monitor/
// reject call on that inspection — it's an independent safety threshold.
const TYRE_LOW_TREAD_THRESHOLD_MM = 5;

function requireOneOf(value, allowed, name) {
  const v = (value ?? "").toString().trim().toLowerCase();
  if (!allowed.includes(v)) throw new Error(`Invalid ${name}`);
  return v;
}

async function getTyreInspectionIntervalDays(conn) {
  const [rows] = await conn.execute(
    `SELECT setting_value FROM APP_SETTING WHERE setting_key='tyre_inspection_interval_days' LIMIT 1`
  );
  const days = rows?.length ? Number(rows[0].setting_value) : NaN;
  return Number.isFinite(days) && days > 0 ? days : 30;
}

async function listTyres(conn, auth, qs) {
  const deny = requireRole(auth, ["admin", "rm_manager", "fleet_manager", "technician"]);
  if (deny) return deny;

  const where = [];
  const vals = [];
  if (qs?.status) { where.push("t.tyre_status=?"); vals.push(requireOneOf(qs.status, [...TYRE_MANUAL_STATUSES, "mounted"], "status")); }
  if (qs?.unmounted === "1") where.push("m.tyre_mounting_id IS NULL");

  const [rows] = await conn.execute(
    `SELECT t.*, m.tyre_mounting_id AS current_mounting_id, m.bus_id AS current_bus_id,
            m.axle_number, m.axle_side, m.wheel_position, m.mounted_at
     FROM TYRE t
     LEFT JOIN TYRE_MOUNTING m ON m.tyre_id = t.tyre_id AND m.unmounted_at IS NULL
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY t.tyre_serial_number ASC
     LIMIT 500`,
    vals
  );
  return json(200, rows);
}

async function getTyre(conn, auth, tyreId) {
  const deny = requireRole(auth, ["admin", "rm_manager", "fleet_manager", "technician"]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT t.*, m.tyre_mounting_id AS current_mounting_id, m.bus_id AS current_bus_id,
            m.axle_number, m.axle_side, m.wheel_position, m.mounted_at
     FROM TYRE t
     LEFT JOIN TYRE_MOUNTING m ON m.tyre_id = t.tyre_id AND m.unmounted_at IS NULL
     WHERE t.tyre_id=?`,
    [tyreId]
  );
  if (!rows.length) return json(404, { message: "Tyre not found" });

  const [mountingHistory] = await conn.execute(
    `SELECT * FROM TYRE_MOUNTING WHERE tyre_id=? ORDER BY mounted_at DESC, tyre_mounting_id DESC`,
    [tyreId]
  );

  const [inspectionHistory] = await conn.execute(
    `SELECT ti.tyre_inspection_id, ti.session_id, ti.tyre_pressure, ti.retread_count_observed,
            ti.inspection_result, ti.reject_reason,
            s.bus_id, s.inspection_datetime
     FROM TYRE_INSPECTION ti
     JOIN TYRE_INSPECTION_SESSION s ON s.tyre_inspection_session_id = ti.session_id
     WHERE ti.tyre_id=?
     ORDER BY s.inspection_datetime DESC
     LIMIT 50`,
    [tyreId]
  );

  return json(200, { ...rows[0], mounting_history: mountingHistory, inspection_history: inspectionHistory });
}

async function createTyre(conn, auth, b) {
  const deny = requireRole(auth, ["admin", "rm_manager"]);
  if (deny) return deny;

  if (!b.tyre_serial_number) throw new Error("tyre_serial_number is required");

  const retreadCount = b.tyre_retread_count != null ? toWholeNumber(b.tyre_retread_count, "tyre_retread_count") : 0;
  const treadCount = b.tyre_tread_count != null ? toWholeNumber(b.tyre_tread_count, "tyre_tread_count") : 4;
  if (treadCount <= 0) throw new Error("tyre_tread_count must be a whole number > 0");

  const [res] = await conn.execute(
    `INSERT INTO TYRE (tyre_serial_number, tyre_brand, tyre_model, tyre_retread_count, tyre_tread_count, tyre_bought_date)
     VALUES (?,?,?,?,?,?)`,
    [
      String(b.tyre_serial_number).trim(),
      b.tyre_brand ? String(b.tyre_brand).trim() : null,
      b.tyre_model ? String(b.tyre_model).trim() : null,
      retreadCount,
      treadCount,
      b.tyre_bought_date ?? null,
    ]
  );
  return json(200, { tyre_id: res.insertId });
}

async function updateTyre(conn, auth, tyreId, b) {
  const deny = requireRole(auth, ["admin", "rm_manager"]);
  if (deny) return deny;

  const updates = [];
  const vals = [];

  if (b.tyre_serial_number != null) { updates.push("tyre_serial_number=?"); vals.push(String(b.tyre_serial_number).trim()); }
  if (b.tyre_brand !== undefined)   { updates.push("tyre_brand=?");         vals.push(b.tyre_brand ? String(b.tyre_brand).trim() : null); }
  if (b.tyre_model !== undefined)   { updates.push("tyre_model=?");         vals.push(b.tyre_model ? String(b.tyre_model).trim() : null); }
  if (b.tyre_retread_count != null) { updates.push("tyre_retread_count=?"); vals.push(toWholeNumber(b.tyre_retread_count, "tyre_retread_count")); }
  if (b.tyre_bought_date !== undefined) { updates.push("tyre_bought_date=?"); vals.push(b.tyre_bought_date ?? null); }
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
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT t.*, m.tyre_mounting_id AS current_mounting_id, m.axle_number, m.axle_side, m.wheel_position, m.mounted_at
     FROM TYRE_MOUNTING m
     JOIN TYRE t ON t.tyre_id = m.tyre_id
     WHERE m.bus_id=? AND m.unmounted_at IS NULL
     ORDER BY m.axle_number ASC, m.axle_side ASC, m.wheel_position ASC`,
    [busId]
  );
  return json(200, rows);
}

async function swapTyre(conn, auth, b) {
  const deny = requireRole(auth, ["admin", "rm_manager"]);
  if (deny) return deny;

  if (!b.bus_id) throw new Error("bus_id is required");
  const busId = String(b.bus_id).trim();
  const axleNumber = toWholeNumber(b.axle_number, "axle_number");
  if (axleNumber <= 0) throw new Error("axle_number must be a whole number > 0");
  const axleSide = requireOneOf(b.axle_side, TYRE_AXLE_SIDES, "axle_side");
  const wheelPosition = b.wheel_position != null ? requireOneOf(b.wheel_position, TYRE_WHEEL_POSITIONS, "wheel_position") : "single";
  const incomingTyreId = toId(b.incoming_tyre_id, "incoming_tyre_id");
  const outgoingStatus = b.outgoing_status != null ? requireOneOf(b.outgoing_status, TYRE_MANUAL_STATUSES, "outgoing_status") : "spare";

  const userId = await getOrCreateUserId(conn, auth);

  await conn.beginTransaction();
  try {
    const [busRows] = await conn.execute("SELECT bus_id FROM BUS WHERE bus_id=? LIMIT 1", [busId]);
    if (!busRows.length) throw new Error("bus_id not found");

    const [incomingRows] = await conn.execute(
      "SELECT tyre_id, tyre_status FROM TYRE WHERE tyre_id=? FOR UPDATE",
      [incomingTyreId]
    );
    if (!incomingRows.length) throw new Error("incoming_tyre_id not found");
    if (TYRE_UNMOUNTABLE_STATUSES.includes(incomingRows[0].tyre_status)) {
      await conn.rollback();
      return json(409, { code: "TYRE_NOT_MOUNTABLE", message: `Tyre is ${incomingRows[0].tyre_status} and cannot be mounted` });
    }

    const [incomingOpenMount] = await conn.execute(
      "SELECT tyre_mounting_id FROM TYRE_MOUNTING WHERE tyre_id=? AND unmounted_at IS NULL FOR UPDATE",
      [incomingTyreId]
    );
    if (incomingOpenMount.length) {
      await conn.rollback();
      return json(409, { code: "TYRE_ALREADY_MOUNTED", message: "Tyre is already mounted elsewhere — unmount it first" });
    }

    const [existingAtPosition] = await conn.execute(
      `SELECT tyre_mounting_id, tyre_id FROM TYRE_MOUNTING
       WHERE bus_id=? AND axle_number=? AND axle_side=? AND wheel_position=? AND unmounted_at IS NULL
       FOR UPDATE`,
      [busId, axleNumber, axleSide, wheelPosition]
    );

    if (existingAtPosition.length) {
      const outgoing = existingAtPosition[0];
      await conn.execute(
        `UPDATE TYRE_MOUNTING SET unmounted_at=NOW(), unmounted_by=?, unmount_reason='swapped out' WHERE tyre_mounting_id=?`,
        [userId, outgoing.tyre_mounting_id]
      );
      await conn.execute(`UPDATE TYRE SET tyre_status=? WHERE tyre_id=?`, [outgoingStatus, outgoing.tyre_id]);
    }

    const [mountRes] = await conn.execute(
      `INSERT INTO TYRE_MOUNTING (tyre_id, bus_id, axle_number, axle_side, wheel_position, mounted_by)
       VALUES (?,?,?,?,?,?)`,
      [incomingTyreId, busId, axleNumber, axleSide, wheelPosition, userId]
    );
    await conn.execute(`UPDATE TYRE SET tyre_status='mounted' WHERE tyre_id=?`, [incomingTyreId]);

    await conn.commit();
    return json(200, { success: true, tyre_mounting_id: mountRes.insertId });
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

async function unmountTyre(conn, auth, tyreId, b) {
  const deny = requireRole(auth, ["admin", "rm_manager"]);
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

async function getOverdueTyreInspections(conn, auth) {
  const deny = requireRole(auth, ["admin", "rm_manager"]);
  if (deny) return deny;

  const intervalDays = await getTyreInspectionIntervalDays(conn);

  // Every bus, not just overdue ones — the tyre management home screen uses
  // the full list to show each bus card's last-inspection / days-remaining
  // status, while overdue_buses (a filtered view of the same rows) keeps
  // backing the existing overdue banner.
  const [rows] = await conn.execute(
    `SELECT b.bus_id, b.bus_route, b.bus_model, s.last_inspected_at,
            CASE WHEN s.last_inspected_at IS NULL THEN NULL ELSE DATEDIFF(NOW(), s.last_inspected_at) END AS days_since_inspection
     FROM BUS b
     LEFT JOIN (
       SELECT bus_id, MAX(inspection_datetime) AS last_inspected_at
       FROM TYRE_INSPECTION_SESSION
       GROUP BY bus_id
     ) s ON s.bus_id = b.bus_id
     ORDER BY (s.last_inspected_at IS NULL) DESC, s.last_inspected_at ASC`
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

async function getLowTreadTyres(conn, auth) {
  const deny = requireRole(auth, ["admin", "rm_manager", "fleet_manager", "technician"]);
  if (deny) return deny;

  // For each tyre, find its most recent inspection (by session datetime) and
  // the shallowest groove reading recorded in that inspection, then keep only
  // tyres whose latest reading is below the threshold.
  const [rows] = await conn.execute(
    `SELECT t.tyre_id, t.tyre_serial_number, t.tyre_brand, t.tyre_model, t.tyre_status,
            m.bus_id AS current_bus_id, m.axle_number, m.axle_side, m.wheel_position,
            latest.min_tread_mm, latest.inspection_datetime
     FROM TYRE t
     JOIN (
       SELECT x.tyre_id, x.min_tread_mm, x.inspection_datetime
       FROM (
         SELECT ti.tyre_id, s.inspection_datetime, MIN(tt.tread_thickness_mm) AS min_tread_mm
         FROM TYRE_INSPECTION ti
         JOIN TYRE_INSPECTION_SESSION s ON s.tyre_inspection_session_id = ti.session_id
         JOIN TYRE_TREAD tt ON tt.tyre_inspection_id = ti.tyre_inspection_id
         GROUP BY ti.tyre_inspection_id, ti.tyre_id, s.inspection_datetime
       ) x
       JOIN (
         SELECT ti2.tyre_id, MAX(s2.inspection_datetime) AS max_dt
         FROM TYRE_INSPECTION ti2
         JOIN TYRE_INSPECTION_SESSION s2 ON s2.tyre_inspection_session_id = ti2.session_id
         GROUP BY ti2.tyre_id
       ) d ON d.tyre_id = x.tyre_id AND d.max_dt = x.inspection_datetime
     ) latest ON latest.tyre_id = t.tyre_id
     LEFT JOIN TYRE_MOUNTING m ON m.tyre_id = t.tyre_id AND m.unmounted_at IS NULL
     WHERE latest.min_tread_mm < ?
     ORDER BY latest.min_tread_mm ASC`,
    [TYRE_LOW_TREAD_THRESHOLD_MM]
  );

  return json(200, { threshold_mm: TYRE_LOW_TREAD_THRESHOLD_MM, low_tread_tyres: rows });
}

async function getTyreSettings(conn, auth) {
  const deny = requireRole(auth, ["admin", "rm_manager"]);
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
  const deny = requireRole(auth, ["admin", "technician"]);
  if (deny) return deny;

  const tyres = Array.isArray(b.tyres) ? b.tyres : [];
  if (!tyres.length) throw new Error("tyres is required and must be a non-empty array");

  const odometer = b.odometer_reading != null ? toWholeNumber(b.odometer_reading, "odometer_reading") : null;
  const userId = await getOrCreateUserId(conn, auth);

  await conn.beginTransaction();
  try {
    const [busRows] = await conn.execute("SELECT bus_id FROM BUS WHERE bus_id=? LIMIT 1", [busId]);
    if (!busRows.length) throw new Error("bus_id not found");

    const [mountedRows] = await conn.execute(
      `SELECT tyre_id FROM TYRE_MOUNTING WHERE bus_id=? AND unmounted_at IS NULL`,
      [busId]
    );
    const mountedTyreIds = new Set(mountedRows.map((r) => Number(r.tyre_id)));

    const [sessionRes] = await conn.execute(
      `INSERT INTO TYRE_INSPECTION_SESSION (bus_id, technician_user_id, odometer_reading) VALUES (?,?,?)`,
      [busId, userId, odometer]
    );
    const sessionId = sessionRes.insertId;

    for (const entry of tyres) {
      const tyreId = toId(entry.tyre_id, "tyre_id");
      if (!mountedTyreIds.has(tyreId)) throw new Error(`tyre_id ${tyreId} is not currently mounted on this bus`);

      const result = entry.inspection_result != null ? requireOneOf(entry.inspection_result, TYRE_INSPECTION_RESULTS, "inspection_result") : "pass";
      const pressure = entry.tyre_pressure != null ? Number(entry.tyre_pressure) : null;
      if (pressure != null && !Number.isFinite(pressure)) throw new Error("Invalid tyre_pressure");
      const retreadCountObserved = entry.retread_count_observed != null
        ? toWholeNumber(entry.retread_count_observed, "retread_count_observed")
        : null;

      const [inspRes] = await conn.execute(
        `INSERT INTO TYRE_INSPECTION (session_id, tyre_id, tyre_pressure, retread_count_observed, inspection_result, reject_reason)
         VALUES (?,?,?,?,?,?)`,
        [
          sessionId,
          tyreId,
          pressure,
          retreadCountObserved,
          result,
          result === "reject" ? (entry.reject_reason ? String(entry.reject_reason).trim() : null) : null,
        ]
      );
      const inspectionId = inspRes.insertId;

      // The technician's observed retread count during a routine inspection is
      // the most up-to-date read on the physical tyre — keep TYRE in sync with
      // it the same way a "reject" result updates tyre_status below.
      if (retreadCountObserved != null) {
        await conn.execute(`UPDATE TYRE SET tyre_retread_count=? WHERE tyre_id=?`, [retreadCountObserved, tyreId]);
      }

      const treads = Array.isArray(entry.treads) ? entry.treads : [];
      for (const tread of treads) {
        const pos = toWholeNumber(tread.tread_position, "tread_position");
        if (pos < 1 || pos > 4) throw new Error("tread_position must be between 1 and 4");
        const thickness = Number(tread.tread_thickness_mm);
        if (!Number.isFinite(thickness) || thickness < 0) throw new Error("Invalid tread_thickness_mm");
        await conn.execute(
          `INSERT INTO TYRE_TREAD (tyre_inspection_id, tread_position, tread_thickness_mm) VALUES (?,?,?)`,
          [inspectionId, pos, thickness]
        );
      }

      if (result === "reject") {
        await conn.execute(`UPDATE TYRE SET tyre_status='rejected' WHERE tyre_id=?`, [tyreId]);
      }
    }

    await conn.commit();
    return json(200, { session_id: sessionId });
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}

async function listBusTyreInspections(conn, auth, busId) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const [rows] = await conn.execute(
    `SELECT s.*, u.user_name AS technician_name
     FROM TYRE_INSPECTION_SESSION s
     LEFT JOIN \`USER\` u ON u.user_id = s.technician_user_id
     WHERE s.bus_id=?
     ORDER BY s.inspection_datetime DESC, s.tyre_inspection_session_id DESC`,
    [busId]
  );
  return json(200, rows);
}

async function getTyreInspectionSession(conn, auth, sessionId) {
  const deny = requireRole(auth, ["admin", "fleet_manager", "rm_manager", "technician"]);
  if (deny) return deny;

  const [sessionRows] = await conn.execute(
    `SELECT s.*, u.user_name AS technician_name, b.bus_route, b.bus_model
     FROM TYRE_INSPECTION_SESSION s
     LEFT JOIN \`USER\` u ON u.user_id = s.technician_user_id
     LEFT JOIN BUS b ON b.bus_id = s.bus_id
     WHERE s.tyre_inspection_session_id=?`,
    [sessionId]
  );
  if (!sessionRows.length) return json(404, { message: "Inspection session not found" });

  const [tyreRows] = await conn.execute(
    `SELECT ti.*, t.tyre_serial_number, t.tyre_brand, t.tyre_model
     FROM TYRE_INSPECTION ti
     JOIN TYRE t ON t.tyre_id = ti.tyre_id
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
        const viewUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
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
        const viewUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
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
