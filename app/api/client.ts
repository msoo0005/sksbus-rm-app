// api/client.ts
import * as SecureStore from "expo-secure-store";

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

const RAW_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
if (!RAW_BASE_URL) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");

// Trim whitespace + remove trailing slashes
const BASE_URL = RAW_BASE_URL.trim().replace(/\/+$/, "");

async function getAccessToken() {
  return await SecureStore.getItemAsync("accessToken");
}

async function getIdToken() {
  return await SecureStore.getItemAsync("idToken");
}

async function getRefreshToken() {
  return await SecureStore.getItemAsync("refreshToken");
}

async function storeTokens(tokens: {
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
}) {
  const ops: Promise<void>[] = [];
  if (tokens.accessToken)
    ops.push(SecureStore.setItemAsync("accessToken", tokens.accessToken));
  if (tokens.idToken)
    ops.push(SecureStore.setItemAsync("idToken", tokens.idToken));
  if (tokens.refreshToken)
    ops.push(SecureStore.setItemAsync("refreshToken", tokens.refreshToken));
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
    SecureStore.deleteItemAsync("accessToken"),
    SecureStore.deleteItemAsync("idToken"),
    SecureStore.deleteItemAsync("refreshToken"),
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
      }[]
    >("/projects"),

  myProjects: () =>
    requestWithIdToken<
      {
        project_id: string;
        project_name: string;
        project_desc?: string | null;
      }[]
    >("/me/projects"),

  // buses (protected)
  buses: (params?: { project_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.project_id) qs.set("project_id", params.project_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<any[]>(`/buses${suffix}`);
  },

  createBus: (body: {
    bus_id: string;
    bus_route?: string;
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
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.mine) qs.set("mine", "1");
    if (params?.type) qs.set("type", params.type);

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
  updateReportStatus: (
    reportId: number,
    body: {
      report_status: ReportStatus;
      report_review_action?: ReviewAction | null;
      report_review_by?: string | null;
      report_review_reason?: string | null;
      report_review_at?: string | null;
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

  // ===== JOBS =====
  listJobs: (params?: { status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<any[]>(`/jobs${suffix}`);
  },

  getJob: (jobId: number) => requestWithIdToken<any>(`/jobs/${jobId}`),

  // ✅ FIX: protected → use ID token
  assignJob: (jobId: number) =>
    requestWithIdToken<{ success: true }>(`/jobs/${jobId}/assign`, {
      method: "PATCH",
    }),

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

  listJobMedia: (jobId: number) =>
    requestWithIdToken<any[]>(`/jobs/${jobId}/media`),

  // ✅ FIX: protected → use ID token
  presignJobMedia: (jobId: number, mime: string) =>
    requestWithIdToken<{
      uploadUrl: string;
      s3_bucket: string;
      s3_key: string;
    }>(`/jobs/${jobId}/media/presign?mime=${encodeURIComponent(mime)}`),

  // ✅ FIX: protected → use ID token
  confirmJobMedia: (jobId: number, body: any) =>
    requestWithIdToken<{ success: true }>(`/jobs/${jobId}/media/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ===== PARTS =====
  parts: (params?: { limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<any[]>(`/parts${suffix}`);
  },

  // ✅ FIX: protected → use ID token
  createPart: (body: any) =>
    requestWithIdToken<{ success: true }>("/parts", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ✅ FIX: protected → use ID token
  updatePart: (partId: number, body: any) =>
    requestWithIdToken<{ success: true }>(`/parts/${partId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // Expose request for any special cases
  request,

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

  // PATCH /jobs/{job_id} (odometer)
  patchJob: (jobId: number, body: { job_odometer: number }) =>
    requestWithIdToken<{ success: true; job_odometer: number }>(
      `/jobs/${jobId}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),
};
