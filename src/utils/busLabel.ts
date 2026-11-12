// How the depot names a bus: plate, then its own fleet number in brackets,
// "VMQ6372 (EV012)". The bracket holds bus_ev_no, never bus_route_number
// (see the note on the Bus type in api/client.ts). A bus with no EV number
// shows just its plate, never an empty "()".
export function formatBusLabel(
  plate: string | number | null | undefined,
  evNo?: string | null,
): string {
  if (plate == null || String(plate).trim() === "") return "—";
  const ev = evNo == null ? "" : String(evNo).trim();
  return ev ? `${plate} (${ev})` : String(plate);
}
