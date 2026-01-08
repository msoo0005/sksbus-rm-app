// api.ts
import * as SecureStore from "expo-secure-store";

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

export async function request<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as any),
  };

  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = joinUrl(path);

  const res = await fetch(url, { ...init, headers });
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

// Use ID token when you want Cognito groups reliably
async function requestWithIdToken<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("Missing idToken");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as any),
    Authorization: `Bearer ${idToken}`,
  };

  const url = joinUrl(path);

  const res = await fetch(url, { ...init, headers });
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
  // health
  health: () => request<{ status: string }>("/health"),

  // auth/user
  me: () => requestWithIdToken<DbMe>("/me"),

  // buses
  buses: () => requestWithIdToken<any[]>("/buses"),

  // ===== REPORTS =====
  listReports: (params?: { status?: ReportStatus; mine?: boolean; type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.mine) qs.set("mine", "1");
    if (params?.type) qs.set("type", params.type);

    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<any[]>(`/reports${suffix}`);
  },

  getReport: (reportId: number) => requestWithIdToken<any>(`/reports/${reportId}`),

  // ✅ Ensure report_status defaults to "submitted" for brand new reports
  createReport: (body: any) =>
    request<{ report_id: number }>("/reports", {
      method: "POST",
      body: JSON.stringify({
        report_status: "submitted",
        ...body, // allow caller to override if needed
      }),
    }),

  updateReportStatus: (
    reportId: number,
    body: {
      report_status: ReportStatus;
      report_review_action?: ReviewAction | null;
      report_review_by?: string | null;
      report_review_reason?: string | null;
      report_review_at?: string | null;
    }
  ) =>
    request<{ success: true }>(`/reports/${reportId}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  reviewReport: (
    reportId: number,
    body: { action: ReviewAction; by: string; reason?: string }
  ) =>
    request<{ success: true }>(`/reports/${reportId}/review`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  createJobForReport: (reportId: number, body: { job_desc?: string | null }) =>
    request<{ job_id: number }>(`/reports/${reportId}/job`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // report media
  listReportMedia: (reportId: number) => requestWithIdToken<any[]>(`/reports/${reportId}/media`),

  presignReportMedia: (reportId: number, mime: string) =>
    request<{
      uploadUrl: string;
      s3_bucket: string;
      s3_key: string;
    }>(`/reports/${reportId}/media/presign?mime=${encodeURIComponent(mime)}`),

  confirmReportMedia: (reportId: number, body: any) =>
    request<{ success: true }>(`/reports/${reportId}/media/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ===== JOBS =====
  listJobs: (params?: { status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<any[]>(`/jobs${suffix}`);
  },

  getJob: (jobId: number) => requestWithIdToken<any>(`/jobs/${jobId}`),

  assignJob: (jobId: number) =>
    request<{ success: true }>(`/jobs/${jobId}/assign`, {
      method: "PATCH",
    }),

  listJobParts: (jobId: number) => requestWithIdToken<any[]>(`/jobs/${jobId}/parts`),

  addJobPart: (jobId: number, body: any) =>
    request<{ success: true }>(`/jobs/${jobId}/parts`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateJobStatus: (jobId: number, body: any) =>
    request<{ success: true }>(`/jobs/${jobId}/status`, {
      method: "PATCH",
    }),

  listJobHistory: (jobId: number) => requestWithIdToken<any[]>(`/jobs/${jobId}/history`),

  addJobHistory: (jobId: number, body: any) =>
    request<{ success: true }>(`/jobs/${jobId}/history`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listJobMedia: (jobId: number) => requestWithIdToken<any[]>(`/jobs/${jobId}/media`),

  presignJobMedia: (jobId: number, mime: string) =>
    request<{
      uploadUrl: string;
      s3_bucket: string;
      s3_key: string;
    }>(`/jobs/${jobId}/media/presign?mime=${encodeURIComponent(mime)}`),

  confirmJobMedia: (jobId: number, body: any) =>
    request<{ success: true }>(`/jobs/${jobId}/media/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // parts
  parts: (params?: { limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestWithIdToken<any[]>(`/parts${suffix}`);
  },

  createPart: (body: any) =>
    request<{ success: true }>("/parts", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updatePart: (partId: number, body: any) =>
    request<{ success: true }>(`/parts/${partId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  request,
};
