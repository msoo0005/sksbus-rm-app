// Formats used on every SKS Chassis PDF report. Spec: "SKSC Job Completion
// Report Template Spec v1.1", section 12 (formats) and section 11 (times).
//
// All times are printed in Malaysia time (UTC+8), whatever the server's zone.

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DASH = "—";

function myt(d) {
  if (d == null || d === "") return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + MYT_OFFSET_MS);
}

const pad2 = (n) => String(n).padStart(2, "0");

/** 07 Nov 2026 */
export function fmtDate(d) {
  const t = myt(d);
  if (!t) return DASH;
  return `${pad2(t.getUTCDate())} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** 07 Nov 2026 12:06 */
export function fmtDateTime(d) {
  const t = myt(d);
  if (!t) return DASH;
  return `${fmtDate(d)} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** 07 Nov 2026, 13:02 (the "Generated on" line) */
export function fmtGenerated(d) {
  const t = myt(d);
  if (!t) return DASH;
  return `${fmtDate(d)}, ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** 06 Nov 19:10 (photo index: no year) */
export function fmtShortDateTime(d) {
  const t = myt(d);
  if (!t) return DASH;
  return `${pad2(t.getUTCDate())} ${MONTHS[t.getUTCMonth()]} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** Nov 2026 */
export function fmtMonthYear(d) {
  const t = myt(d);
  if (!t) return DASH;
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

function minutesOf(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60000));
}

/**
 * Event-log elapsed time: hours and minutes only, even past a day.
 *   0m · 7m · 47m · 16h 24m · 25h 08m · 42h 30m
 */
export function fmtElapsed(ms) {
  const m = minutesOf(ms);
  if (m == null) return DASH;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
}

/**
 * Job Summary durations.
 *   short: under an hour → "7 min" (or "7m" when compact, e.g. beside a %)
 *   16h 58m · 3d 2h 27m (24 hours or more)
 */
export function fmtDuration(ms, { compact = false } = {}) {
  const m = minutesOf(ms);
  if (m == null) return DASH;
  if (m < 60) return compact ? `${m}m` : `${m} min`;
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return `${days}d ${hours}h ${pad2(mins)}m`;
  return `${hours}h ${pad2(mins)}m`;
}

/** 325,689 km */
export function fmtOdometer(n) {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return DASH;
  return `${Math.round(Number(n)).toLocaleString("en-US")} km`;
}

/** Whole-number percentage of a part of a whole: 97% */
export function fmtPercent(part, whole) {
  if (part == null || whole == null || !(whole > 0)) return null;
  return `${Math.round((part / whole) * 100)}%`;
}

/** Part quantities: 1 · 1.5 · 2 */
export function fmtQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return DASH;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** "Fig. 4–8", or "Fig. 4" for one photo. */
export function fmtFigRange(first, last) {
  if (first == null) return DASH;
  return first === last ? `Fig. ${first}` : `Fig. ${first}–${last}`;
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Text or an em dash, HTML-escaped. */
export function val(s) {
  const v = s == null ? "" : String(s).trim();
  return v ? escapeHtml(v) : DASH;
}

/**
 * Work-done text as lines: one per line, with a leading "- " / "• " / "1. "
 * dropped. A single line stays plain text; several become a numbered list.
 */
export function workDoneLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}
