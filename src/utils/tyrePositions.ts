import type { Tyre, TyreAxleSide, TyreWheelPosition } from "../api/client";

// The wheel layout every bus in the fleet runs: a single-tyre front axle and a
// dual-wheel rear axle, six tyres in total. This lived duplicated byte-for-byte
// in the replacement screen and the inspection screen; both now read it here so
// the two flows can never disagree about what a wheel is called.
//
// axle_number/axle_side/wheel_position are stored flexibly server-side, so a
// different configuration is only a different position list.

export type TyrePosition = {
  axle_number: number;
  axle_side: TyreAxleSide;
  wheel_position: TyreWheelPosition;
  label: string;
  shortLabel: string;
};

export const FRONT_POSITIONS: TyrePosition[] = [
  { axle_number: 1, axle_side: "left", wheel_position: "single", label: "Front Left Tyre", shortLabel: "Front L" },
  { axle_number: 1, axle_side: "right", wheel_position: "single", label: "Front Right Tyre", shortLabel: "Front R" },
];

// Left outer, left inner, right inner, right outer — outboard first on the
// left, so the array reads left-to-right across the axle as the diagram draws it.
export const REAR_POSITIONS: TyrePosition[] = [
  { axle_number: 2, axle_side: "left", wheel_position: "outer", label: "Rear Left Outer Tyre", shortLabel: "Rear L Out" },
  { axle_number: 2, axle_side: "left", wheel_position: "inner", label: "Rear Left Inner Tyre", shortLabel: "Rear L In" },
  { axle_number: 2, axle_side: "right", wheel_position: "inner", label: "Rear Right Inner Tyre", shortLabel: "Rear R In" },
  { axle_number: 2, axle_side: "right", wheel_position: "outer", label: "Rear Right Outer Tyre", shortLabel: "Rear R Out" },
];

export const ALL_POSITIONS: TyrePosition[] = [...FRONT_POSITIONS, ...REAR_POSITIONS];

/** Stable identity for a wheel, used as a map key and a selection key. */
export const positionKey = (p: {
  axle_number: number;
  axle_side: TyreAxleSide | string;
  wheel_position: TyreWheelPosition | string;
}) => `${p.axle_number}-${p.axle_side}-${p.wheel_position}`;

/**
 * The same key from a row that merely carries the three columns — a mounted
 * Tyre, a TyreMounting, a TyreSwapRecord — where the position fields are
 * nullable. Returns null when the row isn't mounted anywhere.
 */
export function tyreKey(t: {
  axle_number?: number | null;
  axle_side?: TyreAxleSide | null;
  wheel_position?: TyreWheelPosition | null;
}): string | null {
  if (t.axle_number == null || !t.axle_side || !t.wheel_position) return null;
  return positionKey({
    axle_number: t.axle_number,
    axle_side: t.axle_side,
    wheel_position: t.wheel_position,
  });
}

export function findPosition(t: {
  axle_number?: number | null;
  axle_side?: TyreAxleSide | null;
  wheel_position?: TyreWheelPosition | null;
}): TyrePosition | null {
  const key = tyreKey(t);
  if (!key) return null;
  return ALL_POSITIONS.find((p) => positionKey(p) === key) ?? null;
}

/**
 * One vocabulary for naming a wheel, replacing the two that had grown up
 * ("Rear L In" on the replacement screen vs "Axle 2 · Left inner" on the
 * inspection one). Falls back to a generic axle description so a bus with a
 * layout outside ALL_POSITIONS degrades gracefully instead of reading
 * "Unknown position".
 */
export function positionLabelFor(
  t: {
    axle_number?: number | null;
    axle_side?: TyreAxleSide | null;
    wheel_position?: TyreWheelPosition | null;
  },
  variant: "long" | "short" = "long",
): string {
  const found = findPosition(t);
  if (found) return variant === "short" ? found.shortLabel : found.label;
  if (t.axle_number == null || !t.axle_side) return "Unknown position";
  const side = t.axle_side === "left" ? "Left" : "Right";
  const wheel = t.wheel_position && t.wheel_position !== "single" ? ` ${t.wheel_position}` : "";
  return `Axle ${t.axle_number} ${side}${wheel}`;
}

/** Index the tyres currently on a bus by wheel, for the diagram's `tyreAt`. */
export function indexTyresByPosition(tyres: Tyre[]): Map<string, Tyre> {
  const map = new Map<string, Tyre>();
  for (const t of tyres) {
    const key = tyreKey(t);
    if (key) map.set(key, t);
  }
  return map;
}
