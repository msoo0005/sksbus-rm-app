// Where each role belongs, in one place.
//
// This map had been written twice — ROLE_HOME in app/(app)/_layout.tsx and
// ROLE_REDIRECT in app/(app)/index.tsx — with the two disagreeing about the
// driver, and the project selector hard-coding a third answer ("./fleet-manager")
// as its fallback destination, which is not where four of the six roles live.

export type RoleKey =
  | "admin"
  | "driver"
  | "fleet_manager"
  | "rm_manager"
  | "technician"
  | "inventory_manager";

/**
 * The screen a role lands on once it has everything it needs to be there —
 * signed in, and (for every role but admin) a project chosen.
 *
 * NOTE the driver: this used to read "/project-selector", because pointing the
 * home at the selector WAS the way a driver got asked to pick a project. The
 * gate in _layout.tsx now does that for every role, so leaving it here would
 * bounce a driver back to the selector the instant they chose — the selector
 * sends them home, and home was the selector. A driver's actual destination is
 * the form.
 */
export const ROLE_HOME: Record<RoleKey, string> = {
  admin: "/",
  fleet_manager: "/fleet-manager-home",
  rm_manager: "/rm-manager-home",
  technician: "/technician-home",
  inventory_manager: "/inventory",
  driver: "/form",
};

export const roleHomeFor = (role?: string | null): string =>
  ROLE_HOME[(role ?? "driver") as RoleKey] ?? ROLE_HOME.driver;

export const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  fleet_manager: "Fleet Manager",
  rm_manager: "R&M Manager",
  technician: "Technician",
  inventory_manager: "Inventory Manager",
  driver: "Driver",
};

// One accent per role, used by the avatar, HomeHeader's role pill and the
// home-screen module cards, so a role reads as the same colour everywhere.
// Lived in app/(app)/_layout.tsx until the project selector needed it too —
// importing colours from a layout file to draw a screen is backwards.
export const ROLE_COLORS: Record<string, { accent: string; light: string }> = {
  admin: { accent: "#4338CA", light: "#EEF2FF" },
  fleet_manager: { accent: "#2563EB", light: "#EFF6FF" },
  rm_manager: { accent: "#16A34A", light: "#F0FDF4" },
  technician: { accent: "#EA580C", light: "#FFF7ED" },
  inventory_manager: { accent: "#7C3AED", light: "#F5F3FF" },
  driver: { accent: "#2563EB", light: "#EFF6FF" },
};

export const DEFAULT_ROLE_COLOR = ROLE_COLORS.driver;

export const roleColorsFor = (role?: string | null) =>
  ROLE_COLORS[role ?? ""] ?? DEFAULT_ROLE_COLOR;

export const roleLabelFor = (role?: string | null) => ROLE_LABEL[role ?? ""] ?? "User";
