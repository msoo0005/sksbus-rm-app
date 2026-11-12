// PUSPAKOM display rules shared by every role's screens.
//
// The tag / row-done functions mirror the server's PUSPAKOM RULES block in
// lambda/index.mjs (the server stays authoritative; these give the instant
// feedback the technician sees while typing, including offline).

import type {
  PspAnswer,
  PspAnswerType,
  PspDamage,
  PspSettings,
  PspStatus,
  PspTag,
} from "../api/puspakom";

export const PSP_ORANGE = "#F06A25";
export const PSP_BLUE = "#2A9FD8";

type Tone = { bg: string; fg: string; border: string };
const TONES: Record<"red" | "orange" | "blue" | "green" | "grey", Tone> = {
  red: { bg: "#FEF2F2", fg: "#B91C1C", border: "#FECACA" },
  orange: { bg: "#FFF7ED", fg: "#C2410C", border: "#FED7AA" },
  blue: { bg: "#EFF6FF", fg: "#1D4ED8", border: "#BFDBFE" },
  green: { bg: "#F0FDF4", fg: "#15803D", border: "#BBF7D0" },
  grey: { bg: "#F3F4F6", fg: "#4B5563", border: "#E5E7EB" },
};

/**
 * Pill colour per status (spec p.24): red = overdue or failed, orange = the
 * Fleet Manager needs to act, blue = booked, green = pre-inspection done or
 * passed, grey = not due.
 */
export const STATUS_TONE: Record<PspStatus | "PASSED", Tone> = {
  NOT_DUE: TONES.grey,
  NOT_BOOKED: TONES.orange,
  OVERDUE_NOT_BOOKED: TONES.red,
  BOOKED: TONES.blue,
  OVERDUE_BOOKED: TONES.red,
  PRECHECK_DONE: TONES.green,
  INSPECTED_UPDATE: TONES.orange,
  FAILED_PENDING: TONES.red,
  PASSED: TONES.green,
};

/** "Most urgent first" order (spec 2b). */
export const STATUS_URGENCY: PspStatus[] = [
  "OVERDUE_NOT_BOOKED",
  "OVERDUE_BOOKED",
  "FAILED_PENDING",
  "INSPECTED_UPDATE",
  "NOT_BOOKED",
  "BOOKED",
  "PRECHECK_DONE",
  "NOT_DUE",
];

export const TECH_PILL_TONE = {
  PRECHECK_TODO: TONES.orange,
  IN_PROGRESS: TONES.orange,
  SUBMITTED: TONES.green,
  RECHECK_TODO: TONES.red,
  RECHECK_SUBMITTED: TONES.green,
} as const;

export const TAG_TONE: Record<PspTag, Tone> = {
  OK: TONES.green,
  NG: TONES.red,
  REPLACE: TONES.red,
  DAMAGE: TONES.red,
  LOW: TONES.orange,
  CHECK_SOON: TONES.orange,
};

export const ATTENTION_TAGS: PspTag[] = ["NG", "REPLACE", "LOW", "CHECK_SOON", "DAMAGE"];

// ----- dates (always Malaysia time, whatever the phone's zone) -----

const MYT_MS = 8 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function myt(instant: string | number | Date) {
  return new Date(new Date(instant).getTime() + MYT_MS);
}

/** "YYYY-MM-DD" in Malaysia time. */
export function mytDate(instant: string | number | Date = Date.now()): string {
  return myt(instant).toISOString().slice(0, 10);
}

function time12(t: Date) {
  const h24 = t.getUTCHours();
  return `${h24 % 12 || 12}:${String(t.getUTCMinutes()).padStart(2, "0")} ${h24 >= 12 ? "pm" : "am"}`;
}

/** "Wed, 18 Nov 2026 · 10:30 am" */
export function fmtDateTime(instant: string | null | undefined): string {
  if (!instant) return "—";
  const t = myt(instant);
  return `${DAYS[t.getUTCDay()]}, ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()} · ${time12(t)}`;
}

/** "Wed, 18 Nov · 10:30 am" (cards). */
export function fmtShortDateTime(instant: string | null | undefined): string {
  if (!instant) return "—";
  const t = myt(instant);
  return `${DAYS[t.getUTCDay()]}, ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} · ${time12(t)}`;
}

function dateParts(dateStr: string) {
  return new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
}

/** "13 Nov 2026" for a "YYYY-MM-DD" date. */
export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const t = dateParts(dateStr);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** "Fri, 13 Nov 2026" for a "YYYY-MM-DD" date. */
export function fmtDayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const t = dateParts(dateStr);
  return `${DAYS[t.getUTCDay()]}, ${fmtDate(dateStr)}`;
}

/** "4 Nov" */
export function fmtDayMonth(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const t = dateParts(dateStr);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function monthLabel(key: string, withYear = true): string {
  const [y, m] = key.split("-").map(Number);
  return withYear ? `${MONTH_NAMES[m - 1]} ${y}` : MONTHS[m - 1].toUpperCase();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function addDays(dateStr: string, days: number): string {
  const t = dateParts(dateStr);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" + n calendar months, clamped to the month's last day (server's pspAddMonths). */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

/**
 * Combine a picked calendar day and a picked time (both read in Malaysia
 * time) into an ISO instant.
 */
export function mytInstant(dateStr: string, hours: number, minutes: number): string {
  return new Date(Date.parse(`${dateStr}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+08:00`)).toISOString();
}

export function mytHourMinute(instant: string): { h: number; m: number } {
  const t = myt(instant);
  return { h: t.getUTCHours(), m: t.getUTCMinutes() };
}

// ----- answers (mirror of the server rules) -----

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function answerTag(type: PspAnswerType, a: Partial<PspAnswer> | undefined, s: PspSettings): PspTag | null {
  if (!a) return null;
  if (type === "OK_NG") return a.answer === "NG" ? "NG" : a.answer === "OK" ? "OK" : null;
  if (type === "BODY") return a.answer === "DAMAGE" ? "DAMAGE" : a.answer === "NO_DAMAGE" ? "OK" : null;
  if (type === "BRAKE") {
    const pad = num(a.pad_mm);
    if (pad === null) return null;
    if (pad < s.padReplaceMm) return "REPLACE";
    if (pad <= s.padCheckMm) return "CHECK_SOON";
    return "OK";
  }
  const tread = num(a.tread_mm);
  const psi = num(a.pressure_psi);
  if (tread === null && psi === null) return null;
  if (tread !== null && tread < s.treadMinMm) return "REPLACE";
  if (psi !== null && psi < (s.pressureTargetPsi * s.pressureLowPct) / 100) return "LOW";
  return "OK";
}

/** Per-field tags for a tyre row: tread and pressure each get their own. */
export function tyreFieldTags(a: Partial<PspAnswer> | undefined, s: PspSettings) {
  const tread = num(a?.tread_mm);
  const psi = num(a?.pressure_psi);
  return {
    tread: tread === null ? null : tread < s.treadMinMm ? ("REPLACE" as const) : ("OK" as const),
    pressure:
      psi === null ? null : psi < (s.pressureTargetPsi * s.pressureLowPct) / 100 ? ("LOW" as const) : ("OK" as const),
  };
}

export function damageComplete(d: Partial<PspDamage> | undefined): boolean {
  return (
    !!d &&
    Number.isFinite(Number(d.x_pct)) &&
    Number.isFinite(Number(d.y_pct)) &&
    String(d.where ?? "").trim() !== "" &&
    !!d.type &&
    !!d.photo_s3_key
  );
}

/**
 * Row is done (spec p.42). `hasPhoto` lets the phone count a photo that is
 * taken but not uploaded yet; the server only counts uploaded keys.
 */
export function answerDone(
  type: PspAnswerType,
  a: Partial<PspAnswer> | undefined,
  hasPhoto: (a: Partial<PspAnswer>) => boolean = (x) => !!x.photo_s3_key,
  damageHasPhoto: (d: Partial<PspDamage>) => boolean = (d) => !!d.photo_s3_key,
): boolean {
  if (!a || !hasPhoto(a)) return false;
  if (type === "OK_NG") {
    if (a.answer === "OK") return true;
    if (a.answer !== "NG" || !a.ng_reason) return false;
    return a.ng_reason !== "OTHER" || String(a.note ?? "").trim() !== "";
  }
  if (type === "TYRE") return num(a.tread_mm) !== null && num(a.pressure_psi) !== null;
  if (type === "BRAKE") return num(a.pad_mm) !== null;
  if (a.answer === "NO_DAMAGE") return true;
  const list = a.damages ?? [];
  return (
    a.answer === "DAMAGE" &&
    list.length > 0 &&
    list.every(
      (d) =>
        Number.isFinite(Number(d.x_pct)) &&
        Number.isFinite(Number(d.y_pct)) &&
        String(d.where ?? "").trim() !== "" &&
        !!d.type &&
        damageHasPhoto(d),
    )
  );
}

export function busLabel(busId: string, evNo?: string | null): string {
  return evNo ? `${busId} (${evNo})` : busId;
}
