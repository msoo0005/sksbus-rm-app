// PUSPAKOM inspections: types and API calls (backend: the PUSPAKOM section of
// lambda/index.mjs, tables from migration 024).

import { PdfStatus, requestWithIdToken } from "./client";

export type PspStatus =
  | "NOT_DUE"
  | "NOT_BOOKED"
  | "OVERDUE_NOT_BOOKED"
  | "BOOKED"
  | "OVERDUE_BOOKED"
  | "PRECHECK_DONE"
  | "INSPECTED_UPDATE"
  | "FAILED_PENDING";

export type PspInspectionType = "PERIODIC" | "REINSPECTION" | "SPECIAL";
export type PspAnswerType = "OK_NG" | "TYRE" | "BRAKE" | "BODY";
export type PspTag = "OK" | "NG" | "REPLACE" | "LOW" | "CHECK_SOON" | "DAMAGE";
export type PspNgReason = "NOT_WORKING" | "FLICKERING" | "CRACKED" | "LOOSE" | "OTHER";
export type PspDamageType = "SCRATCH" | "DENT" | "CRACK" | "PAINT";
export type PspMediaKind = "selfie" | "check" | "damage" | "slip" | "fix";

export type PspCounts = { overdue: number; need_booking: number; booked: number; action: number };

export type PspOpen = {
  inspection_id: number;
  root_inspection_id: number;
  inspection_type: PspInspectionType;
  scheduled_at: string;
  booking_ref: string | null;
  precheck_kind: "PRE" | "RECHECK" | null;
  precheck_answered: number;
  precheck_submitted_at: string | null;
  failed_on: string | null;
  failed_checks: string[];
};

export type PspBusState = {
  bus_id: string;
  bus_ev_no: string | null;
  bus_model: string | null;
  project_id: string | null;
  last_passed: string | null;
  next_due: string | null;
  days_to_due: number | null;
  status: PspStatus;
  open: PspOpen | null;
};

export type PspSchedule = {
  today: string;
  now: string;
  counts: PspCounts;
  buses: PspBusState[];
  can_edit: boolean;
};

export type PspSettings = {
  cycleMonths: number;
  notBookedDays: number;
  treadMinMm: number;
  pressureTargetPsi: number;
  pressureLowPct: number;
  padReplaceMm: number;
  padCheckMm: number;
};

export type PspStopDef = {
  stop_no: number;
  stop_name: string;
  stop_where: string;
  helper_top: string | null;
  helper_end: string | null;
  has_drawing: boolean;
};

export type PspCheckDef = {
  check_id: string;
  stop_no: number;
  sort_no: number;
  answer_type: PspAnswerType;
  label: string;
  ok_if: string;
  photo_hint: string;
  puspakom_item: string;
  pin_x_pct: number | null;
  pin_y_pct: number | null;
};

export type PspDefs = { stops: PspStopDef[]; checks: PspCheckDef[] };

export type PspDamage = {
  no: number;
  x_pct: number;
  y_pct: number;
  where: string;
  type: PspDamageType | null;
  photo_s3_key: string | null;
  photo_url?: string | null;
};

export type PspAnswer = {
  check_id: string;
  answer: "OK" | "NG" | "NO_DAMAGE" | "DAMAGE" | null;
  ng_reason: PspNgReason | null;
  note: string | null;
  tread_mm: number | null;
  pressure_psi: number | null;
  pad_mm: number | null;
  tag: PspTag | null;
  photo_s3_key: string | null;
  photo_url?: string | null;
  damages: PspDamage[];
  entered_by?: string | null;
  entered_at?: string | null;
  client_ts: number;
};

export type PspInspection = {
  inspection_id: number;
  bus_id: string;
  inspection_type: PspInspectionType;
  parent_inspection_id: number | null;
  root_inspection_id: number;
  scheduled_at: string;
  booking_ref: string | null;
  notes: string | null;
  registered_by: string | null;
  registered_at: string | null;
  registered_verified_name: string | null;
  registered_selfie_url?: string | null;
  result: "PASSED" | "FAILED" | null;
  result_date: string | null;
  result_by: string | null;
  result_at: string | null;
  result_verified_name: string | null;
  result_selfie_url?: string | null;
  ref_no: string | null;
};

export type PspPrecheck = {
  precheck_id: number;
  inspection_id: number;
  kind: "PRE" | "RECHECK";
  started_by: string | null;
  started_at: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  remarks: string | null;
  declared: boolean;
  verified_name: string | null;
  selfie_url: string | null;
  total: number;
  done: number;
};

export type PspFailedItem = {
  inspection_id: number;
  check_id: string;
  label: string;
  stop_no: number | null;
  puspakom_found: string;
  fixed_text: string | null;
  fix_photos: { s3_key: string; url: string | null }[];
  fixed_by: string | null;
  fixed_at: string | null;
  client_ts: number;
};

export type PspEvent = {
  event_id: number;
  inspection_id: number;
  type:
    | "REGISTERED"
    | "BOOKING_CHANGED"
    | "PRECHECK_SUBMITTED"
    | "RESULT_FAILED"
    | "REINSPECTION_BOOKED"
    | "RECHECK_SUBMITTED"
    | "RESULT_PASSED";
  at: string;
  actor: string | null;
  actor_role: string | null;
  detail: any;
};

export type PspDetail = {
  now: string;
  bus: { bus_id: string; bus_ev_no: string | null; bus_model: string | null };
  state: PspBusState;
  inspection: PspInspection | null;
  chain: PspInspection[];
  precheck:
    | (PspPrecheck & { photos: number; needs_attention: string[]; answers: PspAnswer[] })
    | null;
  rechecks: PspPrecheck[];
  failed_items: PspFailedItem[];
  slips: { media_id: number; inspection_id: number; url: string | null; uploaded_by: string | null; uploaded_at: string }[];
  events: PspEvent[];
  defs: PspDefs | null;
  settings: PspSettings;
  can_edit: boolean;
  can_work: boolean;
};

export type PspTechItem = {
  inspection_id: number;
  bus_id: string;
  bus_ev_no: string | null;
  bus_model: string | null;
  inspection_type: PspInspectionType;
  scheduled_at: string;
  checklist_due: string;
  booking_ref: string | null;
  notes: string | null;
  registered_by: string | null;
  registered_at: string | null;
  kind: "PRE" | "RECHECK";
  pill: "PRECHECK_TODO" | "IN_PROGRESS" | "SUBMITTED" | "RECHECK_TODO" | "RECHECK_SUBMITTED";
  tab: "TODO" | "DONE";
  total: number;
  done: number;
  needs_attention: number;
  started_at: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  failed: { failed_on: string | null; checks: { check_id: string; label: string; puspakom_found: string }[] } | null;
};

export type PspSignoff = { verified_name: string; selfie_s3_key: string };

export type PspReport = {
  root_inspection_id: number;
  bus_id: string;
  bus_ev_no: string | null;
  inspection_type: PspInspectionType;
  first_date: string;
  passed_date: string;
  attempts: number;
  first_time: boolean;
  ref_no: string | null;
  failed_checks: string[];
};

export type PspKpis = {
  period: { key: "6m" | "12m" | "all"; from: string; to: string };
  first_time: { passed: number; attempts: number };
  inspections: { total: number; periodic: number; reinspection: number; special: number };
  failed: { count: number; buses: { bus_id: string; bus_ev_no: string | null; items: string[] }[] };
  on_time: { on_time: number; total: number };
  per_month: { month: string; passed: number; failed: number }[];
  failed_items: { check_id: string; label: string; count: number }[];
  avg_fail_to_re_days: number | null;
  by_bus: { bus_id: string; bus_ev_no: string | null; inspections: number; fails: number; first_time: boolean | null }[];
};

const pq = (projectId?: string | null) => (projectId ? `?project_id=${encodeURIComponent(projectId)}` : "");
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const puspakomApi = {
  schedule: (projectId?: string | null) => requestWithIdToken<PspSchedule>(`/puspakom/schedule${pq(projectId)}`),

  counts: (projectId?: string | null) =>
    requestWithIdToken<Partial<PspCounts> & { technician_todo?: number }>(`/puspakom/counts${pq(projectId)}`),

  checkDefs: (busModel?: string | null) =>
    requestWithIdToken<PspDefs & { settings: PspSettings }>(
      `/puspakom/check-defs${busModel ? `?bus_model=${encodeURIComponent(busModel)}` : ""}`,
    ),

  bus: (busId: string) => requestWithIdToken<PspDetail>(`/puspakom/buses/${encodeURIComponent(busId)}`),

  inspection: (id: number) => requestWithIdToken<PspDetail>(`/puspakom/inspections/${id}`),

  prechecks: (projectId?: string | null) =>
    requestWithIdToken<{ today: string; items: PspTechItem[] }>(`/puspakom/prechecks${pq(projectId)}`),

  register: (
    body: {
      bus_id: string;
      inspection_type: "PERIODIC" | "SPECIAL";
      scheduled_at: string;
      booking_ref?: string | null;
      notes?: string | null;
    } & PspSignoff,
  ) => requestWithIdToken<{ inspection_id: number }>("/puspakom/inspections", post(body)),

  updateBooking: (
    id: number,
    body: { scheduled_at?: string; booking_ref?: string | null; notes?: string | null; inspection_type?: "PERIODIC" | "SPECIAL" },
  ) =>
    requestWithIdToken<{ inspection_id: number; changed: Record<string, unknown> }>(`/puspakom/inspections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  recordResult: (
    id: number,
    body: {
      result: "PASSED" | "FAILED";
      result_date: string;
      slip_keys: string[];
      failed?: { check_id: string; puspakom_found: string }[];
      reinspection?: { scheduled_at: string };
    } & PspSignoff,
  ) =>
    requestWithIdToken<{ inspection_id: number; result: string; ref_no: string | null; reinspection_id: number | null }>(
      `/puspakom/inspections/${id}/result`,
      post(body),
    ),

  saveAnswers: (id: number, answers: (Omit<PspAnswer, "photo_url" | "entered_by"> & { entered_at?: string })[]) =>
    requestWithIdToken<{ saved: number; results: { check_id: string; client_ts: number; tag: PspTag | null }[] }>(
      `/puspakom/inspections/${id}/answers`,
      post({ answers }),
    ),

  submitPrecheck: (id: number, body: { remarks?: string | null; declared: true } & PspSignoff) =>
    requestWithIdToken<{ inspection_id: number; submitted_at: string; needs_attention: string[] }>(
      `/puspakom/inspections/${id}/precheck/submit`,
      post(body),
    ),

  saveRecheck: (
    id: number,
    items: { check_id: string; fixed_text: string | null; fix_photo_keys: string[]; client_ts: number; entered_at?: string }[],
  ) => requestWithIdToken<{ saved: number }>(`/puspakom/inspections/${id}/recheck`, post({ items })),

  submitRecheck: (id: number, body: PspSignoff) =>
    requestWithIdToken<{ inspection_id: number; submitted_at: string }>(`/puspakom/inspections/${id}/recheck/submit`, post(body)),

  reports: (projectId?: string | null) => requestWithIdToken<{ reports: PspReport[] }>(`/puspakom/reports${pq(projectId)}`),

  kpis: (period: "6m" | "12m" | "all", projectId?: string | null) =>
    requestWithIdToken<PspKpis>(`/puspakom/kpis?period=${period}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ""}`),

  reportPdf: (inspectionId: number) => requestWithIdToken<PdfStatus>(`/puspakom/inspections/${inspectionId}/report-pdf`),

  presign: (busId: string, kind: PspMediaKind, mime: string) =>
    requestWithIdToken<{ uploadUrl: string; s3_bucket: string; s3_key: string }>(
      `/puspakom/media/presign?bus_id=${encodeURIComponent(busId)}&kind=${kind}&mime=${encodeURIComponent(mime)}`,
    ),
};

/** Presign → PUT to S3. Returns the S3 key to send with the action that uses the photo. */
export async function uploadPuspakomPhoto(
  busId: string,
  kind: PspMediaKind,
  media: { localUri: string; mime_type: string },
): Promise<string> {
  const presign = await puspakomApi.presign(busId, kind, media.mime_type);
  const blob = await (await fetch(media.localUri)).blob();
  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": media.mime_type },
    body: blob,
  });
  if (!put.ok) throw new Error(`Photo upload failed (${put.status})`);
  return presign.s3_key;
}
