// The 29 EV bus system categories ("EV Bus – System Category & Description
// Master List"). Every report and every task is filed under one; they group
// jobs in Performance & KPIs and head each task on the Job Completion Report.
//
// The KEY is what is stored, so the list can be renumbered (it already has
// been once) without touching saved data. The number shown is the position
// here. Names and "components covered" are in i18n under busSystems.<key> and
// busSystems.<key>_desc. Mirrors BUS_SYSTEMS in lambda/index.mjs; keep the two
// lists in step.

export const BUS_SYSTEM_KEYS = [
  "axle_braking",
  "suspension",
  "steering",
  "air_compressor",
  "pneumatic",
  "wheels_tyres",
  "transmission_driveline",
  "chassis_frame",
  "hv_battery",
  "hv_electrical",
  "electric_drive",
  "charging",
  "low_voltage_electrical",
  "thermal_management",
  "auxiliary_thermal",
  "communication_telematics",
  "body_structure",
  "hvac",
  "doors_access",
  "interior_seating",
  "lighting_signalling",
  "windscreen_glass_wipers",
  "dashboard_instrumentation",
  "fire_suppression",
  "brake_control_safety",
  "driver_controls",
  "mirrors",
  "cctv",
  "accessibility_emergency",
] as const;

export type BusSystemKey = (typeof BUS_SYSTEM_KEYS)[number];

// Reports filed before categories (or under an old type with no clear match).
export const UNCATEGORISED = "uncategorised";

export function normaliseBusSystem(raw: unknown): BusSystemKey | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (BUS_SYSTEM_KEYS as readonly string[]).includes(v) ? (v as BusSystemKey) : null;
}

/** 1-based number shown beside the name, or null for no category. */
export function busSystemNo(raw: unknown): number | null {
  const k = normaliseBusSystem(raw);
  return k ? BUS_SYSTEM_KEYS.indexOf(k) + 1 : null;
}

/** "Low-Voltage Electrical & Control System" (or "Uncategorised"). */
export function busSystemName(raw: unknown, t: (key: string) => string): string {
  const k = normaliseBusSystem(raw);
  return k ? t(`busSystems.${k}`) : t("busSystems.uncategorised");
}

/** "13 · Low-Voltage Electrical & Control System" (or "Uncategorised"). */
export function busSystemLabel(raw: unknown, t: (key: string) => string): string {
  const no = busSystemNo(raw);
  return no ? `${no} · ${busSystemName(raw, t)}` : busSystemName(raw, t);
}
