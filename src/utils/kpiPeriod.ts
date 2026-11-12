// The period switch on the Performance & KPIs screens: 7 days, a calendar
// month, or a calendar year, stepped back with ‹ and forward with › (never
// past the current one). Dates are the device's local calendar, which for
// this fleet is Malaysia time.

export type PeriodKind = "week" | "month" | "year";

export type Period = { kind: PeriodKind; offset: number; from: Date; to: Date };

export function periodFor(kind: PeriodKind, offset: number, now = new Date()): Period {
  if (kind === "week") {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // start of tomorrow
    const to = new Date(end.getTime() + offset * 7 * 86400000);
    const from = new Date(to.getTime() - 7 * 86400000);
    return { kind, offset, from, to };
  }
  if (kind === "month") {
    const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    return { kind, offset, from, to };
  }
  const from = new Date(now.getFullYear() + offset, 0, 1);
  const to = new Date(now.getFullYear() + offset + 1, 0, 1);
  return { kind, offset, from, to };
}

export function periodLabel(p: Period, locale?: string): string {
  if (p.kind === "month") return p.from.toLocaleDateString(locale, { month: "long", year: "numeric" });
  if (p.kind === "year") return String(p.from.getFullYear());
  const last = new Date(p.to.getTime() - 1);
  const a = p.from.toLocaleDateString(locale, { day: "numeric", month: "short" });
  const b = last.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return `${a} – ${b}`;
}

/** The previous period's name, for "▲ 4 vs September". */
export function previousPeriodLabel(p: Period, locale?: string): string {
  const prev = periodFor(p.kind, p.offset - 1);
  if (p.kind === "month") return prev.from.toLocaleDateString(locale, { month: "long" });
  return periodLabel(prev, locale);
}

/** 9h 40m · 46m · 1d 16h — compact durations for KPI tiles and rows. */
export function fmtDur(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${String(mm).padStart(2, "0")}m`;
}

export const pct = (part: number | null | undefined, whole: number | null | undefined) =>
  part != null && whole ? Math.round((part / whole) * 100) : null;
