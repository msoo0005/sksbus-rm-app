// Date formatting shared across screens. These were copy-pasted into three
// tyre screens with identical bodies; keeping one copy means a change to how
// dates read happens once.

/** "14 Sept 2026, 09:00" — full timestamp for a recorded event. */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "14 Sept 2026" — date only, for list rows where the time adds nothing. */
export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Whole days since `iso`, or null when there's no usable date. */
export function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}
