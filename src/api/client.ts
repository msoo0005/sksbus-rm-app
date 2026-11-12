// api/client.ts
import { deleteStoredItem, getStoredItem, setStoredItem } from "../utils/storage";

export type ReportMedia = {
  media_id: number;
  report_id: number;
  media_type: "image" | "video";
  mime_type: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes?: number | null;
  uploaded_at?: string | null;

  viewUrl?: string; // ✅ add this
};

export type JobMedia = {
  media_id: number;
  job_id: number;
  task_id?: number | null;
  media_type: "image" | "video";
  mime_type: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes?: number | null;
  uploaded_at?: string | null;

  viewUrl?: string;
};

export type TaskPart = {
  task_id: number;
  part_id: number;
  qty: number;
  line_cost: number | null;
  part_name: string;
  part_code: string;
  part_brand?: string | null;
  part_unit?: PartUnit | null;
  part_cost: number | null;
  part_stock: number | null;
};

// Units a part is counted in. "pc" and "set" are whole numbers; the others
// may be fractional (1.5 L of coolant).
export type PartUnit = "pc" | "set" | "L" | "kg" | "m";
export const PART_UNITS: PartUnit[] = ["pc", "set", "L", "kg", "m"];
export const isWholeUnit = (u?: string | null) => !u || u === "pc" || u === "set";

// A row of the parts catalogue (GET /parts). part_stock is the quantity on
// hand — shown and edited in Parts Admin, not yet deducted by jobs.
export type CatalogPart = {
  part_id: number;
  part_name: string;
  part_code: string;
  part_brand: string | null;
  part_unit?: PartUnit | null;
  part_cost: number | string | null;
  part_stock: number | null;
};

export type PartInput = {
  part_name: string;
  part_code: string;
  part_brand: string | null;
  part_unit: PartUnit;
  part_cost: number | null;
  part_stock: number;
};

// Categories are the 29 bus systems (src/utils/busSystems.ts); counts may
// also include "uncategorised".
export type IssueType = string;
export type TaskJobType = "repair" | "maintenance";

export type KpiBucket = { start: string; end: string; opened: number; closed: number };
export type KpiIssueCount = { issue_type: IssueType; count: number };

export type KpiOverview = {
  from: string;
  to: string;
  jobs_closed: number;
  prev_jobs_closed: number;
  jobs_opened: number;
  avg_turnaround_ms: number | null;
  prev_avg_turnaround_ms: number | null;
  avg_approval_ms: number | null;
  avg_accept_ms: number | null;
  avg_travel_ms: number | null;
  avg_repair_ms: number | null;
  bucket_unit: "day" | "week" | "month";
  buckets: KpiBucket[];
  issues: KpiIssueCount[];
  top_buses: { bus_id: string; bus_ev_no: string | null; jobs: number }[];
};

export type KpiBusRow = {
  bus_id: string;
  bus_ev_no: string | null;
  bus_model: string | null;
  jobs: number;
  downtime_ms: number;
  last_issue: string | null;
  last_report_at: string | null;
};

export type KpiBuses = { from: string; to: string; buses: KpiBusRow[]; total_jobs: number };

export type KpiReportRow = {
  report_id: number;
  job_id: number | null;
  job_ref_no: string | null;
  report_type: string;
  issue_type: IssueType;
  issue: string | null;
  priority: string | null;
  status: string;
  reported_at: string;
  completed_at: string | null;
  technician_name: string | null;
  turnaround_ms: number | null;
};

export type KpiBusHistory = {
  from: string;
  to: string;
  bus: Bus & { latest_odometer: number | null; reports_all_time: number };
  jobs: number;
  downtime_ms: number;
  avg_turnaround_ms: number | null;
  issues: KpiIssueCount[];
  reports: KpiReportRow[];
};

export type PdfStatus =
  | { status: "pending"; filename?: string; ref_no?: string }
  | { status: "ready"; url: string; filename: string; ref_no?: string };

export type ExportRequest =
  | {
      kind: "range";
      from: string;
      to: string;
      project_id?: string | null;
      bus_ids?: string[];
      status?: "all" | "open" | "closed";
    }
  | { kind: "bus"; bus_id: string; from?: string | null; to?: string | null; project_id?: string | null };

// The two sign-offs whose selfie is uploaded ahead of the action itself.
export type VerificationKind = "report-review" | "job-accept";

// The BUS row as every branch of the lambda's getBuses returns it.
/**
 * bus_id is the registration plate (VHG3340).
 *
 * The two codes beside it are NOT interchangeable, and conflating them is what
 * made two different buses on the same route look like the same vehicle:
 *   bus_ev_no         the fleet's own sequential number for THIS vehicle
 *                     (EV006) — unique: 83 buses, 83 values. How the depot
 *                     identifies a bus, and what the paper inspection form
 *                     prints as "EV004 - VHG 3294".
 *   bus_route_number  the ROUTE it runs (GOKL 03) — only 16 values across
 *                     those same 83 buses, shared by 3 to 9 vehicles each,
 *                     and 'GOKL 03 / GOKL 04' for the one bus running two.
 */
export type Bus = {
  bus_id: string;
  bus_route?: string | null;
  bus_route_colour?: string | null;
  bus_route_number?: string | null;
  bus_ev_no?: string | null;
  bus_model?: string | null;
  project_id?: string | null;
};

// Bus detail denormalised onto a tyre/inspection row, so a list can render a
// route badge without separately fetching the bus directory.
export type BusRouteInfo = {
  current_bus_route?: string | null;
  current_bus_route_colour?: string | null;
  current_bus_route_number?: string | null;
  current_bus_ev_no?: string | null;
  current_bus_model?: string | null;
  current_project_id?: string | null;
};

export type TyreStatus = "spare" | "mounted" | "rejected" | "retreading" | "retired";
export type TyreAxleSide = "left" | "right";
export type TyreWheelPosition = "single" | "inner" | "outer";
export type TyreInspectionResult = "pass" | "monitor" | "reject";
export type TyreSidewallCondition = "ok" | "not_ok";

export type Tyre = {
  tyre_id: number;
  tyre_serial_number: string;
  tyre_brand?: string | null;
  tyre_model?: string | null;
  tyre_retread_count: number;
  // The sticker backing the count above, captured by whichever form last set
  // it. Null on casings recorded before migration 017.
  retread_sticker_s3_key?: string | null;
  // How many circumferential grooves this tyre model has — 3 or 4 on the
  // current fleet. Drives how many thickness readings are taken for it.
  tyre_tread_count: number;
  tyre_status: TyreStatus;
  tyre_bought_date?: string | null;
  // Groove readings (mm) taken when the tyre was added to stock (migration
  // 023). Null on tyres added before then. See intakeReadings().
  intake_thickness_1?: number | string | null;
  intake_thickness_2?: number | string | null;
  intake_thickness_3?: number | string | null;
  intake_thickness_4?: number | string | null;
  intake_measured_at?: string | null;
  intake_measured_by?: number | null;
  created_at: string;
  updated_at: string;

  current_mounting_id?: number | null;
  current_bus_id?: string | null;
  axle_number?: number | null;
  axle_side?: TyreAxleSide | null;
  wheel_position?: TyreWheelPosition | null;
  mounted_at?: string | null;

  // The most recent inspection's finding, so a tyre carries its wear
  // classification wherever it is listed rather than only inside a diagram.
  // All null on a tyre that has never been inspected.
  latest_uneven_wear_type?: UnevenWearType | null;
  latest_tread_spread_mm?: number | null;
  latest_min_tread_mm?: number | null;
  latest_inspection_datetime?: string | null;
} & BusRouteInfo;

export type TyreMounting = {
  tyre_mounting_id: number;
  tyre_id: number;
  bus_id: string;
  bus_ev_no?: string | null;
  axle_number: number;
  axle_side: TyreAxleSide;
  wheel_position: TyreWheelPosition;
  mounted_at: string;
  mounted_by?: number | null;
  unmounted_at?: string | null;
  unmounted_by?: number | null;
  unmount_reason?: string | null;
};

// Mirrors the ENUM as widened by migration 015 and the classifier in
// src/utils/tyreWear.ts. Declared here rather than imported so client.ts stays
// dependency-free.
//
// 'irregular' names no cause — it is the shape that matched none of the four.
// 'alignment' and 'imbalance' are legacy: never sent by the current Lambda, but
// still returned from rows written before 015, so they have to be assignable.
export type UnevenWearType =
  | "toe_in"
  | "toe_out"
  | "under_inflation"
  | "over_inflation"
  | "irregular"
  | "alignment"
  | "imbalance";

export type TyreInspectionHistoryEntry = {
  tyre_inspection_id: number;
  tyre_id: number;
  session_id: number;
  tyre_pressure?: number | null;
  // Recorded by both forms since migration 011 and returned by the lambda all
  // along — it was simply missing from this type, so it never reached the UI.
  sidewall_condition?: TyreSidewallCondition | null;
  // What the technician saw, required whenever the sidewall is NC.
  sidewall_note?: string | null;
  sidewall_photo_s3_key?: string | null;
  retread_count_observed?: number | null;
  inspection_result: TyreInspectionResult;
  // 'derived' since migration 014 — the verdict is computed from the readings
  // rather than picked by the technician. Older rows read 'manual'.
  result_source?: "manual" | "derived" | null;
  reject_reason?: string | null;
  // Detected from the spread between grooves, classified by cause. Null means
  // the tyre is wearing evenly.
  uneven_wear_type?: UnevenWearType | null;
  tread_spread_mm?: number | null;
  bus_id: string;
  inspection_datetime: string;
  odometer_reading?: number | null;
  // Shallowest groove recorded in this inspection, for an at-a-glance history.
  min_tread_mm?: number | null;
  // The ordered groove readings as a comma-separated string, so the tread
  // diagram can be drawn from a history row without a round trip per entry.
  tread_readings?: string | null;
  bus_route?: string | null;
  bus_route_colour?: string | null;
  bus_route_number?: string | null;
  bus_ev_no?: string | null;
};

export type TyreDetail = Tyre & {
  mounting_history: TyreMounting[];
  inspection_history: TyreInspectionHistoryEntry[];
};

export type TyreTread = {
  tyre_tread_id: number;
  tyre_inspection_id: number;
  tread_position: number;
  tread_thickness_mm: number;
};

export type TyreInspectionSession = {
  tyre_inspection_session_id: number;
  bus_id: string;
  technician_user_id: number;
  technician_name?: string | null;
  inspection_datetime: string;
  odometer_reading?: number | null;
  created_at: string;
  bus_route?: string | null;
  bus_route_colour?: string | null;
  bus_route_number?: string | null;
  bus_ev_no?: string | null;
  bus_model?: string | null;
  project_id?: string | null;
};

export type TyreInspectionDetail = TyreInspectionSession & {
  tyres: (TyreInspectionHistoryEntry & {
    tyre_serial_number: string;
    tyre_brand?: string | null;
    tyre_model?: string | null;
    // Where the tyre is fitted now. Needed to read tread_position 1 as the
    // outboard or the inboard shoulder — see classifyUnevenWear.
    axle_number?: number | null;
    axle_side?: TyreAxleSide | null;
    wheel_position?: TyreWheelPosition | null;
    treads: TyreTread[];
  })[];
};

export type OverdueBus = {
  bus_id: string;
  bus_route?: string | null;
  bus_route_colour?: string | null;
  bus_route_number?: string | null;
  bus_ev_no?: string | null;
  bus_model?: string | null;
  project_id?: string | null;
  last_inspected_at: string | null;
  days_since_inspection: number | null;
};

export type LowTreadTyre = {
  tyre_id: number;
  tyre_serial_number: string;
  tyre_brand?: string | null;
  tyre_model?: string | null;
  tyre_status: TyreStatus;
  current_bus_id?: string | null;
  axle_number?: number | null;
  axle_side?: TyreAxleSide | null;
  wheel_position?: TyreWheelPosition | null;
  min_tread_mm: number;
  inspection_datetime: string;
} & BusRouteInfo;

// ---- Fleet tyre summary (GET /tyres/summary) ----
// Everything below is derived from the LATEST inspection of each MOUNTED tyre.
// Swap readings never reach TYRE_TREAD, so a tyre measured only during a
// replacement counts as unmeasured here.

export type TyreTreadBandKey =
  | "past_limit"
  | "critical"
  | "watch"
  | "mid_life"
  | "good"
  | "near_new";

export type TyreTreadBand = {
  key: TyreTreadBandKey;
  min_mm: number | null;
  max_mm: number | null;
  front: number;
  rear: number;
  total: number;
  pct_of_fleet: number;
};

export type TyreTreadStats = {
  count: number;
  shallowest: number | null;
  deepest: number | null;
  mean: number | null;
  median: number | null;
};

export type TyreSummaryBus = {
  bus_id: string;
  bus_model?: string | null;
  project_id?: string | null;
  fitted_count: number;
  measured_count: number;
  past_limit_count: number;
  uneven_wear_count: number;
  shallowest_mm: number | null;
  shallowest_axle_number?: number | null;
  shallowest_axle_side?: TyreAxleSide | null;
  shallowest_wheel_position?: TyreWheelPosition | null;
  shallowest_tyre_id?: number | null;
  shallowest_serial?: string | null;
  last_inspected_at?: string | null;
  // Plain column names, not BusRouteInfo's current_* shape — these rows come
  // from BUS directly rather than from a tyre's current mounting.
  bus_route?: string | null;
  bus_route_colour?: string | null;
  bus_route_number?: string | null;
  bus_ev_no?: string | null;
};

export type TyreSummaryUnevenWear = {
  tyre_id: number;
  tyre_serial_number: string;
  bus_id: string;
  bus_route?: string | null;
  bus_route_number?: string | null;
  bus_ev_no?: string | null;
  axle_number?: number | null;
  axle_side?: TyreAxleSide | null;
  wheel_position?: TyreWheelPosition | null;
  uneven_wear_type: UnevenWearType;
  tread_spread_mm: number | null;
  min_tread_mm: number;
};

export type TyreSummary = {
  threshold_mm: number;
  fitted_count: number;
  measured_count: number;
  /** Fitted but never inspected — the gap in the denominator. */
  unmeasured_count: number;
  bus_count: number;
  bands: TyreTreadBand[];
  stats: { front: TyreTreadStats; rear: TyreTreadStats; fleet: TyreTreadStats };
  buses: TyreSummaryBus[];
  uneven_wear: TyreSummaryUnevenWear[];
};

// One row per completed swap in the rm-manager "Tyre Replacement" popup —
// the outgoing tyre's final readings + sidewall check, and the incoming
// tyre's readings, pressure, and install photo.
export type TyreSwapRecord = {
  tyre_swap_id: number;
  tyre_mounting_id: number;
  axle_number: number;
  axle_side: TyreAxleSide;
  wheel_position: TyreWheelPosition;
  mounted_at: string;
  incoming_tyre_id: number;
  incoming_serial?: string | null;
  outgoing_tyre_id?: number | null;
  outgoing_serial?: string | null;
  outgoing_thickness_1?: number | null;
  outgoing_thickness_2?: number | null;
  outgoing_thickness_3?: number | null;
  outgoing_thickness_4?: number | null;
  outgoing_sidewall_condition?: TyreSidewallCondition | null;
  outgoing_sidewall_photo_s3_key?: string | null;
  outgoing_sidewall_photo_view_url?: string | null;
  incoming_thickness_1?: number | null;
  incoming_thickness_2?: number | null;
  incoming_thickness_3?: number | null;
  incoming_thickness_4?: number | null;
  incoming_tyre_pressure?: number | null;
  incoming_sidewall_condition?: TyreSidewallCondition | null;
  incoming_sidewall_photo_s3_key?: string | null;
  incoming_sidewall_photo_view_url?: string | null;
  // Retread count read off the tyre at fitment, evidenced by the sticker photo.
  incoming_retread_count?: number | null;
  retread_sticker_s3_bucket?: string | null;
  retread_sticker_s3_key?: string | null;
  retread_sticker_view_url?: string | null;
  install_photo_s3_bucket?: string | null;
  install_photo_s3_key?: string | null;
  install_photo_view_url?: string | null;
  performed_by_name?: string | null;
  created_at: string;
};

export type NotificationType =
  | "new_report"
  | "new_job"
  | "job_progress"
  // The outcome of a report, sent to whoever filed it.
  | "report_reviewed"
  // Scheduled daily digest of overdue inspections / low tread.
  | "tyre_digest";

export type AppNotification = {
  notification_id: number;
  notification_type: NotificationType;
  notification_title: string;
  notification_body?: string | null;
  report_id?: number | null;
  job_id?: number | null;
  is_read: number | boolean;
  created_at: string;
};

const RAW_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
if (!RAW_BASE_URL) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");

// Trim whitespace + remove trailing slashes
const BASE_URL = RAW_BASE_URL.trim().replace(/\/+$/, "");

async function getAccessToken() {
  return await getStoredItem("accessToken");
}

async function getIdToken() {
  return await getStoredItem("idToken");
}

async function getRefreshToken() {
  return await getStoredItem("refreshToken");
}

async function storeTokens(tokens: {
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
}) {
  const ops: Promise<void>[] = [];
  if (tokens.accessToken)
    ops.push(setStoredItem("accessToken", tokens.accessToken));
  if (tokens.idToken)
    ops.push(setStoredItem("idToken", tokens.idToken));
  if (tokens.refreshToken)
    ops.push(setStoredItem("refreshToken", tokens.refreshToken));
  await Promise.all(ops);
}

// Cognito token endpoint, used to silently refresh expired access/ID tokens.
const cognitoRegion = (process.env.EXPO_PUBLIC_COGNITO_REGION || "").trim();
const cognitoDomain = (process.env.EXPO_PUBLIC_COGNITO_DOMAIN || "").trim();
const cognitoClientId = (
  process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || ""
).trim();
const COGNITO_TOKEN_ENDPOINT =
  cognitoRegion && cognitoDomain
    ? `https://${cognitoDomain}.auth.${cognitoRegion}.amazoncognito.com/oauth2/token`
    : null;

// Dedupe concurrent refreshes so parallel 401s don't each spend the refresh token.
let _refreshPromise: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (!COGNITO_TOKEN_ENDPOINT || !cognitoClientId) return false;
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return false;

      const res = await fetch(COGNITO_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: cognitoClientId,
          refresh_token: refreshToken,
        }).toString(),
      });

      if (!res.ok) return false;

      const data = await res.json();
      if (!data.access_token || !data.id_token) return false;

      // Cognito only returns a new refresh_token if refresh-token rotation is enabled.
      await storeTokens({
        accessToken: data.access_token,
        idToken: data.id_token,
        refreshToken: data.refresh_token,
      });

      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await _refreshPromise;
  } finally {
    _refreshPromise = null;
  }
}

// Minimal base64url decoder — no atob/Buffer dependency assumed on RN.
function base64UrlDecode(input: string): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");

  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const c of normalized) {
    const val = chars.indexOf(c);
    if (val === -1) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

// Reads the `exp` claim off a JWT without verifying its signature — used only
// to decide client-side whether it's worth proactively refreshing.
function getTokenExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(base64UrlDecode(payload));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

const EXPIRY_BUFFER_MS = 60_000;

/**
 * Proactively checks the stored ID token and refreshes it if it's missing,
 * unreadable, or close to expiry. Call this on app foreground/launch so an
 * expired session bounces the user to sign-in immediately rather than
 * waiting for the next failed request.
 */
export async function ensureValidSession(): Promise<boolean> {
  const idToken = await getIdToken();
  if (!idToken) return false;

  const expiryMs = getTokenExpiryMs(idToken);
  const isExpiringSoon = expiryMs == null || Date.now() >= expiryMs - EXPIRY_BUFFER_MS;

  if (!isExpiringSoon) return true;

  const refreshed = await refreshTokens();
  if (!refreshed) {
    _unauthorizedHandler?.();
    return false;
  }
  return true;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function joinUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_URL}${p}`;
}

export async function clearStoredTokens() {
  await Promise.all([
    deleteStoredItem("accessToken"),
    deleteStoredItem("idToken"),
    deleteStoredItem("refreshToken"),
  ]);
}

let _unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  _unauthorizedHandler = fn;
}

/**
 * Access-token request (kept for future use if you reconfigure the authoriser).
 * NOTE: your current API Gateway authoriser accepts ID tokens (because /me works with idToken).
 */
export async function request<T = any>(
  path: string,
  init: RequestInit = {},
  _isRetry = false,
): Promise<T> {
  const token = await getAccessToken();
  const usingOwnToken = !!token && !(init.headers as any)?.Authorization;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as any),
  };

  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = joinUrl(path);

  const res = await fetch(url, { ...init, headers });

  if (res.status === 401 && usingOwnToken) {
    if (!_isRetry) {
      const refreshed = await refreshTokens();
      if (refreshed) return request<T>(path, init, true);
    }
    _unauthorizedHandler?.();
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error || JSON.stringify(data))) ||
      text ||
      res.statusText ||
      "Request failed";
    throw new Error(msg);
  }

  return data as T;
}

/**
 * ID-token request (your authoriser expects this right now).
 * Use this for all protected endpoints.
 */
async function requestWithIdToken<T = any>(
  path: string,
  init: RequestInit = {},
  _isRetry = false,
): Promise<T> {
  const idToken = await getIdToken();
  if (!idToken) {
    _unauthorizedHandler?.();
    throw new Error("Missing idToken");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as any),
    Authorization: `Bearer ${idToken}`,
  };

  const url = joinUrl(path);

  const res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    if (!_isRetry) {
      const refreshed = await refreshTokens();
      if (refreshed) return requestWithIdToken<T>(path, init, true);
    }
    _unauthorizedHandler?.();
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error || JSON.stringify(data))) ||
      text ||
      res.statusText ||
      "Request failed";
    throw new Error(msg);
  }

  return data as T;
}

export type DbMe = {
  user_id: number;
  user_role: string;
  user_name: string;
  user_email: string;
};

export type ReportStatus = "submitted" | "open" | "closed";
export type ReviewAction = "approved" | "declined";

function kpiQuery(p: { from: string; to: string; project_id?: string | null }) {
  const qs = new URLSearchParams({ from: p.from, to: p.to });
  if (p.project_id) qs.set("project_id", p.project_id);
  return qs.toString();
}

/** `?project_id=…`, or nothing at all when no project is selected. */
const projectQuery = (projectId?: string | null) =>
  projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";

export const api = {
  // health (public)
  health: () => request<{ status: string }>("/health"),

  // auth/user (protected)
  me: () => requestWithIdToken<DbMe>("/me"),

  // projects (protected)
  projects: () =>
    requestWithIdToken<
      {
        project_id: string;
        project_name: string;
        project_desc?: string | null;
        pending_count?: number;
        open_count?: number;
      }[]
    >("/projects"),

  myProjects: () =>
    requestWithIdToken<
      {
        project_id: string;
        project_name: string;
        project_desc?: string | null;
        pending_count?: number;
        open_count?: number;
      }[]
    >("/me/projects"),

  // buses (protected)
  buses: (params?: { project_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.project_id) qs.set("project_id", params.project_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<Bus[]>(`/buses${suffix}`);
  },

  createBus: (body: {
    bus_id: string;
    bus_route?: string;
    bus_route_colour?: string;
    bus_route_number?: string;
    bus_ev_no?: string;
    bus_model?: string;
    project_id?: string;
  }) =>
    requestWithIdToken<{ bus_id: number }>("/buses", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateBus: (
    busId: string | number,
    body: {
      bus_id?: string;
      bus_route?: string;
      bus_route_colour?: string;
      bus_route_number?: string;
      bus_ev_no?: string;
      bus_model?: string;
      project_id?: string;
    },
  ) =>
    requestWithIdToken<{ success: true }>(`/buses/${busId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteBus: (busId: string | number) =>
    requestWithIdToken<{ success: true }>(`/buses/${busId}`, {
      method: "DELETE",
    }),

  // ===== REPORTS =====
  listReports: (params?: {
    status?: ReportStatus;
    mine?: boolean;
    type?: string;
    project_id?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.mine) qs.set("mine", "1");
    if (params?.type) qs.set("type", params.type);
    if (params?.project_id) qs.set("project_id", params.project_id);

    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<any[]>(`/reports${suffix}`);
  },

  getReport: (reportId: number) =>
    requestWithIdToken<any>(`/reports/${reportId}`),

  // ✅ FIX: this endpoint is protected by your authoriser → use ID token
  createReport: (body: any) =>
    requestWithIdToken<{ report_id: number }>("/reports", {
      method: "POST",
      body: JSON.stringify({
        report_status: "submitted",
        ...body,
      }),
    }),

  // ✅ FIX: protected → use ID token
  // Promotes a finished draft to 'submitted'. Reports are created as drafts so
  // that a submission which dies part-way through its uploads never reaches a
  // reviewer's queue — call this last, once the selfie and every photo are up.
  submitReport: (reportId: number) =>
    requestWithIdToken<{ success: true; already_submitted?: boolean }>(
      `/reports/${reportId}/submit`,
      { method: "POST" },
    ),

  updateReportStatus: (
    reportId: number,
    body: {
      report_status: ReportStatus;
      report_review_action?: ReviewAction | null;
      report_review_by?: string | null;
      report_review_reason?: string | null;
      report_review_at?: string | null;
      // Approval sign-off: required when report_review_action is "approved".
      review_verified_name?: string;
      review_selfie_s3_key?: string;
    },
  ) =>
    requestWithIdToken<{ success: true }>(`/reports/${reportId}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * NOTE:
   * Your Lambda router currently does NOT implement POST /reports/{id}/review.
   * Keeping this function is fine, but it will 404 unless you add the route.
   */
  reviewReport: (
    reportId: number,
    body: { action: ReviewAction; by: string; reason?: string },
  ) =>
    requestWithIdToken<{ success: true }>(`/reports/${reportId}/review`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ✅ FIX: protected → use ID token
  createJobForReport: (reportId: number, body: { job_desc?: string | null }) =>
    requestWithIdToken<{ job_id: number }>(`/reports/${reportId}/job`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // report media (protected)
  listReportMedia: (reportId: number) =>
    requestWithIdToken<any[]>(`/reports/${reportId}/media`),

  // ✅ FIX: protected → use ID token
  presignReportMedia: (reportId: number, mime: string) =>
    requestWithIdToken<{
      uploadUrl: string;
      s3_bucket: string;
      s3_key: string;
    }>(`/reports/${reportId}/media/presign?mime=${encodeURIComponent(mime)}`),

  // ✅ FIX: protected → use ID token
  confirmReportMedia: (reportId: number, body: any) =>
    requestWithIdToken<{ success: true }>(
      `/reports/${reportId}/media/confirm`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  // Identity-verification selfie, separate from the gallery-style report
  // media above — one per report, stored directly on the REPORT row.
  presignReportSelfie: (reportId: number, mime: string) =>
    requestWithIdToken<{
      uploadUrl: string;
      s3_bucket: string;
      s3_key: string;
    }>(`/reports/${reportId}/selfie/presign?mime=${encodeURIComponent(mime)}`),

  confirmReportSelfie: (
    reportId: number,
    body: { s3_key: string; mime_type: string; size_bytes?: number; verified_name: string },
  ) =>
    requestWithIdToken<{ success: true }>(`/reports/${reportId}/selfie/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ===== JOBS =====
  // job_id returns just that job (as a one-row list) — used by the job
  // screens instead of searching the whole list for it.
  listJobs: (params?: { status?: string; project_id?: string; job_id?: number }) => {
    const qs = new URLSearchParams();
    if (params?.job_id != null) qs.set("job_id", String(params.job_id));
    if (params?.status) qs.set("status", params.status);
    if (params?.project_id) qs.set("project_id", params.project_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<any[]>(`/jobs${suffix}`);
  },

  getJob: (jobId: number) => requestWithIdToken<any>(`/jobs/${jobId}`),

  // Accepting is a sign-off: the technician's typed name plus the key of a
  // selfie uploaded via presignVerificationSelfie("job-accept", ...).
  assignJob: (jobId: number, body: { verified_name: string; selfie_s3_key: string }) =>
    requestWithIdToken<{ success: true; already?: boolean }>(`/jobs/${jobId}/assign`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  presignVerificationSelfie: (kind: VerificationKind, id: number, mime: string) =>
    requestWithIdToken<{
      uploadUrl: string;
      s3_bucket: string;
      s3_key: string;
    }>(
      `/verification/selfie/presign?kind=${kind}&id=${id}&mime=${encodeURIComponent(mime)}`,
    ),

  listJobParts: (jobId: number) =>
    requestWithIdToken<any[]>(`/jobs/${jobId}/parts`),

  // ✅ FIX: protected → use ID token
  addJobPart: (jobId: number, body: any) =>
    requestWithIdToken<{ success: true }>(`/jobs/${jobId}/parts`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ✅ FIX: protected → use ID token
  updateJobStatus: (jobId: number, body: any) =>
    requestWithIdToken<{ success: true }>(`/jobs/${jobId}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listJobHistory: (jobId: number) =>
    requestWithIdToken<any[]>(`/jobs/${jobId}/history`),

  // ✅ FIX: protected → use ID token
  addJobHistory: (jobId: number, body: any) =>
    requestWithIdToken<{ success: true }>(`/jobs/${jobId}/history`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listJobMedia: (
    jobId: number,
    params?: { taskId?: number; untaggedOnly?: boolean },
  ) => {
    const qs = new URLSearchParams();
    if (params?.taskId != null) qs.set("task_id", String(params.taskId));
    else if (params?.untaggedOnly) qs.set("task_id", "none");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<JobMedia[]>(`/jobs/${jobId}/media${suffix}`);
  },

  // ✅ FIX: protected → use ID token
  presignJobMedia: (jobId: number, mime: string, params?: { taskId?: number }) => {
    const qs = new URLSearchParams({ mime });
    if (params?.taskId != null) qs.set("task_id", String(params.taskId));
    return requestWithIdToken<{
      uploadUrl: string;
      s3_bucket: string;
      s3_key: string;
    }>(`/jobs/${jobId}/media/presign?${qs.toString()}`);
  },

  // ✅ FIX: protected → use ID token
  confirmJobMedia: (
    jobId: number,
    body: { s3_key: string; mime_type: string; size_bytes?: number; task_id?: number },
  ) =>
    requestWithIdToken<{ success: true }>(`/jobs/${jobId}/media/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Identity-verification selfie taken at job completion — one per job,
  // stored directly on the JOB row (same pattern as the report selfie above).
  presignJobSelfie: (jobId: number, mime: string) =>
    requestWithIdToken<{
      uploadUrl: string;
      s3_bucket: string;
      s3_key: string;
    }>(`/jobs/${jobId}/selfie/presign?mime=${encodeURIComponent(mime)}`),

  confirmJobSelfie: (
    jobId: number,
    body: { s3_key: string; mime_type: string; size_bytes?: number; verified_name: string },
  ) =>
    requestWithIdToken<{ success: true }>(`/jobs/${jobId}/selfie/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ===== PARTS =====
  parts: (params?: { limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<CatalogPart[]>(`/parts${suffix}`);
  },

  createPart: (body: PartInput) =>
    requestWithIdToken<{ success: true; part_id: number }>("/parts", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updatePart: (partId: number, body: Partial<PartInput>) =>
    requestWithIdToken<{ success: true }>(`/parts/${partId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // Expose request for any special cases
  request,

  // ===== JOB ORDERS =====
  // A job a technician logs directly for any bus, saved as completed (see
  // createJobOrder in the Lambda). Tasks, photos and the close then go
  // through the normal job endpoints.
  createJobOrder: (body: {
    bus_id: string;
    // The first task's category (bus system key).
    category: string;
    // The first task's issue; empty for maintenance (the server names it).
    description: string;
    odometer: number;
    location?: string | null;
    lat?: number | null;
    lng?: number | null;
  }) =>
    requestWithIdToken<{ success: true; report_id: number; job_id: number }>("/job-orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // R&M correcting a report's issue type.
  setReportIssueType: (reportId: number, issueType: IssueType) =>
    requestWithIdToken<{ success: true }>(`/reports/${reportId}`, {
      method: "PATCH",
      body: JSON.stringify({ report_issue_type: issueType }),
    }),

  // ===== PERFORMANCE & KPIs =====
  kpiOverview: (p: { from: string; to: string; project_id?: string | null }) =>
    requestWithIdToken<KpiOverview>(`/kpis/overview?${kpiQuery(p)}`),

  kpiBuses: (p: { from: string; to: string; project_id?: string | null; issue_type?: IssueType | null }) =>
    requestWithIdToken<KpiBuses>(
      `/kpis/buses?${kpiQuery(p)}${p.issue_type ? `&issue_type=${encodeURIComponent(p.issue_type)}` : ""}`,
    ),

  kpiBus: (busId: string, p: { from: string; to: string; project_id?: string | null }) =>
    requestWithIdToken<KpiBusHistory>(`/kpis/buses/${encodeURIComponent(busId)}?${kpiQuery(p)}`),

  // ===== PDF REPORTS =====
  // The Job Completion Report for a closed job. "pending" while the server
  // renders it; poll until "ready".
  jobReportPdf: (jobId: number) =>
    requestWithIdToken<PdfStatus>(`/jobs/${jobId}/report-pdf`),

  createExport: (body: ExportRequest) =>
    requestWithIdToken<{ export_id: string; filename: string }>("/exports", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getExport: (exportId: string, filename: string) =>
    requestWithIdToken<PdfStatus>(`/exports/${exportId}?filename=${encodeURIComponent(filename)}`),

  // ===== JOB TASKS =====
  listJobTasks: (jobId: number) =>
    requestWithIdToken<any[]>(`/jobs/${jobId}/tasks`),

  createJobTask: (jobId: number, body: any) =>
    requestWithIdToken<{ task_id: number }>(`/jobs/${jobId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateJobTask: (taskId: number, body: any) =>
    requestWithIdToken<{ success: true }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  addTaskPart: (taskId: number, body: { part_id: number; qty: number }) =>
    requestWithIdToken<{ success: true }>(`/tasks/${taskId}/parts`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listTaskParts: (taskId: number) =>
    requestWithIdToken<TaskPart[]>(`/tasks/${taskId}/parts`),

  // PATCH /jobs/{job_id} (odometer)
  patchJob: (jobId: number, body: { job_odometer: number }) =>
    requestWithIdToken<{ success: true; job_odometer: number }>(
      `/jobs/${jobId}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

  // ===== NOTIFICATIONS =====
  listNotifications: (params?: { unread?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.unread) qs.set("unread", "1");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<AppNotification[]>(`/notifications${suffix}`);
  },

  unreadNotificationCount: () =>
    requestWithIdToken<{ count: number }>("/notifications/unread-count"),

  markNotificationRead: (notificationId: number) =>
    requestWithIdToken<{ success: true }>(
      `/notifications/${notificationId}/read`,
      { method: "PATCH" },
    ),

  markAllNotificationsRead: () =>
    requestWithIdToken<{ success: true }>("/notifications/read-all", {
      method: "POST",
    }),

  registerPushToken: (expoPushToken: string) =>
    requestWithIdToken<{ success: true }>("/me/push-token", {
      method: "POST",
      body: JSON.stringify({ expo_push_token: expoPushToken }),
    }),

  unregisterPushToken: (expoPushToken: string) =>
    requestWithIdToken<{ success: true }>("/me/push-token", {
      method: "DELETE",
      body: JSON.stringify({ expo_push_token: expoPushToken }),
    }),

  // ===== TYRES =====
  // `project_id` narrows every tyre endpoint to the project the user selected.
  // Omitting it keeps the caller's full permitted scope, which is what admin
  // (the one role not asked to pick a project) sees.
  //
  // Spare stock is deliberately NOT filtered by project — an unmounted tyre is
  // on no bus and so in no project, and hiding it would leave the replacement
  // flow with nothing to fit. See mountedTyreProjectScope in lambda/index.mjs.
  listTyres: (params?: { status?: TyreStatus; unmounted?: boolean; project_id?: string | null }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.unmounted) qs.set("unmounted", "1");
    if (params?.project_id) qs.set("project_id", params.project_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<Tyre[]>(`/tyres${suffix}`);
  },

  getTyre: (tyreId: number) => requestWithIdToken<TyreDetail>(`/tyres/${tyreId}`),

  createTyre: (body: {
    tyre_serial_number: string;
    tyre_brand?: string;
    tyre_model?: string;
    tyre_retread_count?: number;
    /** Required by the server whenever the retread count is 1 or more. */
    retread_sticker_s3_key?: string;
    tyre_tread_count?: number;
    tyre_bought_date?: string;
    /** One reading per groove (mm), required: the tyre is measured as it enters stock. */
    intake_thickness: number[];
  }) =>
    requestWithIdToken<{ tyre_id: number }>("/tyres", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateTyre: (
    tyreId: number,
    body: {
      tyre_serial_number?: string;
      tyre_brand?: string;
      tyre_model?: string;
      tyre_retread_count?: number;
      /** Required by the server whenever the retread count is 1 or more. */
      retread_sticker_s3_key?: string;
      tyre_tread_count?: number;
      tyre_bought_date?: string;
      tyre_status?: Exclude<TyreStatus, "mounted">;
      /** Corrects the readings taken when the tyre was added to stock. */
      intake_thickness?: number[];
    },
  ) =>
    requestWithIdToken<{ success: true }>(`/tyres/${tyreId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  unmountTyre: (tyreId: number, body?: { reason?: string; new_status?: Exclude<TyreStatus, "mounted"> }) =>
    requestWithIdToken<{ success: true }>(`/tyres/${tyreId}/unmount`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  swapTyre: (body: {
    bus_id: string;
    axle_number: number;
    axle_side: TyreAxleSide;
    wheel_position?: TyreWheelPosition;
    incoming_tyre_id: number;
    outgoing_status?: Exclude<TyreStatus, "mounted">;
    // Tyre Replacement popup detail — omit any of these for a bare swap.
    outgoing_thickness?: number[];
    outgoing_sidewall_condition?: TyreSidewallCondition;
    /** Required by the server whenever the matching condition is "not_ok". */
    outgoing_sidewall_photo_s3_key?: string;
    incoming_thickness?: number[];
    incoming_tyre_pressure?: number;
    incoming_sidewall_condition?: TyreSidewallCondition;
    incoming_sidewall_photo_s3_key?: string;
    incoming_retread_count?: number;
    retread_sticker_s3_key?: string;
    install_photo_s3_key?: string;
  }) =>
    requestWithIdToken<{ success: true; tyre_mounting_id: number }>("/tyres/swap", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Upload target for the tyre forms' photos — requested before the record they
  // belong to exists, same presign-then-confirm shape as job/report media (see
  // presignJobMedia above), except the "confirm" here is just passing the key
  // into swapTyre() or createTyreInspectionSession() itself.
  //
  // `kind` separates the three photos these forms take: the wheel after install
  // and the retread sticker (replacement), and sidewall damage (inspection).
  presignTyrePhoto: (
    mime: string,
    kind: "install" | "retread_sticker" | "sidewall" = "install",
  ) =>
    requestWithIdToken<{
      uploadUrl: string;
      s3_bucket: string;
      s3_key: string;
    }>(`/tyres/photo/presign?mime=${encodeURIComponent(mime)}&kind=${kind}`),

  listBusTyres: (busId: string) => requestWithIdToken<Tyre[]>(`/buses/${busId}/tyres`),

  listBusTyreSwaps: (busId: string) =>
    requestWithIdToken<TyreSwapRecord[]>(`/buses/${busId}/tyre-swaps`),

  getTyreSettings: () =>
    requestWithIdToken<{ inspection_interval_days: number }>("/tyres/settings"),

  updateTyreSettings: (body: { inspection_interval_days: number }) =>
    requestWithIdToken<{ success: true; inspection_interval_days: number }>(
      "/tyres/settings",
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  getOverdueTyreInspections: (projectId?: string | null) =>
    requestWithIdToken<{
      inspection_interval_days: number;
      overdue_buses: OverdueBus[];
      all_buses: OverdueBus[];
    }>(`/tyres/overdue${projectQuery(projectId)}`),

  getLowTreadTyres: (projectId?: string | null) =>
    requestWithIdToken<{ threshold_mm: number; low_tread_tyres: LowTreadTyre[] }>(
      `/tyres/low-tread${projectQuery(projectId)}`,
    ),

  // Fleet tread analytics behind the Tyre Summary and Data screen. Everything
  // it returns is aggregated server-side — there is no client-side equivalent,
  // because /tyres carries no tread data at all.
  getTyreSummary: (projectId?: string | null) =>
    requestWithIdToken<TyreSummary>(`/tyres/summary${projectQuery(projectId)}`),

  createTyreInspectionSession: (
    busId: string,
    body: {
      odometer_reading?: number;
      // inspection_result and reject_reason are deliberately absent: the server
      // derives the verdict from the readings, the sidewall and the wear
      // pattern. It ignores them if an older build still sends them.
      tyres: {
        tyre_id: number;
        tyre_pressure?: number;
        sidewall_condition?: TyreSidewallCondition;
        /** Both required by the server whenever sidewall_condition is "not_ok". */
        sidewall_note?: string;
        sidewall_photo_s3_key?: string;
        retread_count_observed?: number;
        /** Required by the server whenever retread_count_observed is 1 or more. */
        retread_sticker_s3_key?: string;
        treads?: { tread_position: number; tread_thickness_mm: number }[];
      }[];
    },
  ) =>
    requestWithIdToken<{ session_id: number }>(`/buses/${busId}/tyre-inspections`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listBusTyreInspections: (busId: string) =>
    requestWithIdToken<TyreInspectionSession[]>(`/buses/${busId}/tyre-inspections`),

  getTyreInspectionSession: (sessionId: number) =>
    requestWithIdToken<TyreInspectionDetail>(`/tyre-inspections/${sessionId}`),
};

/** The readings taken when a tyre entered stock, in groove order, or null. */
export function intakeReadings(t: Partial<Tyre> | null | undefined): number[] | null {
  if (!t) return null;
  const count = Number(t.tyre_tread_count) || 4;
  const vals = [t.intake_thickness_1, t.intake_thickness_2, t.intake_thickness_3, t.intake_thickness_4]
    .slice(0, count)
    .map((v) => (v == null || v === "" ? NaN : Number(v)));
  return vals.every((n) => Number.isFinite(n)) ? vals : null;
}
