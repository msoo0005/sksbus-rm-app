import type { TyreStatus } from "../api/client";

/**
 * Joins the optional bits of a row's meta line, falling back to a placeholder
 * when a tyre or bus has no details recorded. This exact expression had been
 * written out at five call sites.
 */
export function detailLine(parts: (string | null | undefined | false)[], empty = "No details"): string {
  return parts.filter(Boolean).join(" · ") || empty;
}

export function formatReading(v?: number | null): string {
  return v == null ? "—" : `${v}mm`;
}

/**
 * A 3-groove tyre (e.g. LM 668) leaves its fourth thickness column NULL, so
 * drop the empties rather than trailing a meaningless "—" after every reading.
 */
export function formatReadings(values: (number | null | undefined)[]): string {
  return values.filter((v) => v != null).map(formatReading).join(", ");
}

export const TYRE_STATUS_STYLE: Record<TyreStatus, { label: string; color: string; bg: string }> = {
  mounted: { label: "In use", color: "#15803D", bg: "#F0FDF4" },
  spare: { label: "Spare", color: "#1D4ED8", bg: "#EFF6FF" },
  retreading: { label: "Retreading", color: "#B45309", bg: "#FFFBEB" },
  rejected: { label: "Rejected", color: "#DC2626", bg: "#FEF2F2" },
  retired: { label: "Retired", color: "#6B7280", bg: "#F3F4F6" },
};

/**
 * The colour for a tread reading, on the fleet's own bands.
 *
 * Mirrors TYRE_TREAD_BANDS in lambda/index.mjs, which is what the Tyre Summary
 * screen buckets by — so a tyre shown on the wheel diagram and the same tyre in
 * the summary cannot disagree about whether it is in trouble.
 *
 *   <= 5mm  past limit  |  <= 7mm  critical  -> red
 *   <= 9mm  watch                            -> amber
 *   >  9mm  mid-life and better              -> green
 *
 * The bounds are INCLUSIVE at the top, matching treadBandKey server-side
 * (`if (mm <= b.max_mm) return b.key`). Exclusive `<` here would put exactly
 * 7.0mm and exactly 9.0mm one band lower than the summary screen does — the
 * precise disagreement this helper exists to prevent.
 *
 * NOTE: TyreTreadProfile colours its own per-groove labels on a different pair
 * (5 / 8), so a 6mm reading is red here and amber there. Two band systems
 * genuinely exist; reconciling them would change colours on screens already in
 * use, so it has been left alone deliberately rather than overlooked.
 */
export function treadBandColour(mm?: number | null): string | null {
  if (mm == null || !Number.isFinite(mm)) return null;
  if (mm <= 7) return "#DC2626";
  if (mm <= 9) return "#B45309";
  return "#16A34A";
}
