// Maps the route colour names stored on BUS.bus_route_colour (e.g. "RED",
// "PARROT GREEN") to an actual swatch colour, so a bus's route reads as a
// dot you can recognise at a glance instead of just a word. Named after the
// GOKL route livery colours (see migrations/019_restore_gokl_route_colours.sql);
// falls back to a neutral grey for anything not in this list.
const ROUTE_COLOUR_HEX: Record<string, string> = {
  RED: "#DC2626",
  BLUE: "#2563EB",
  // GREEN is deliberately darker than PARROT GREEN so GOKL 01 and GOKL 10
  // stay distinguishable side by side.
  GREEN: "#15803D",
  "PARROT GREEN": "#22C55E",
  PURPLE: "#7C3AED",
  ORANGE: "#EA580C",
  MAROON: "#7F1D1D",
  // Darker than FALLBACK_HEX, so a GREY route never looks like "no colour".
  GREY: "#4B5563",
  "SOFT PEACH": "#F7A98C",
  CREAM: "#E8D5A8",
  TURQUOISE: "#14B8A6",
  CHOCOLATE: "#7B3F00",
  MAGENTA: "#C026D3",
  WHITE: "#FFFFFF",
};

const FALLBACK_HEX = "#9CA3AF";

export function getRouteColourHex(name: string | null | undefined): string {
  if (!name) return FALLBACK_HEX;
  return ROUTE_COLOUR_HEX[name.trim().toUpperCase()] ?? FALLBACK_HEX;
}

// Colours light enough to disappear against a white swatch background need
// a visible border — everything else can render border-free.
const NEEDS_BORDER = new Set(["WHITE", "CREAM"]);

export function routeColourNeedsBorder(name: string | null | undefined): boolean {
  if (!name) return true;
  return NEEDS_BORDER.has(name.trim().toUpperCase());
}
