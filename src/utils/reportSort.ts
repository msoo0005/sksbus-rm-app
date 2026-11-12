// Sorting for report and job lists (the "Sort by" chips).
//
// Each key has a natural order, and tapping the active chip again reverses it:
//   criticality  most critical first; ties broken oldest-first, so the
//                longest-waiting critical job is on top
//   time         oldest first (the queue order: who has waited longest)
//   bus          by plate, A to Z

export type SortKey = "criticality" | "time" | "bus";
export type SortState = { key: SortKey; reversed: boolean };

export const DEFAULT_SORT: SortState = { key: "criticality", reversed: false };

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

type Sortable = {
  severity?: string | null;
  dateIso?: string | null;
  vehicle?: string | null;
  id?: number;
};

function time(x: Sortable) {
  const t = x.dateIso ? new Date(x.dateIso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function sortReports<T extends Sortable>(list: T[], sort: SortState): T[] {
  const sign = sort.reversed ? -1 : 1;
  const oldestFirst = (a: T, b: T) => time(a) - time(b) || (a.id ?? 0) - (b.id ?? 0);

  const cmp = (a: T, b: T): number => {
    if (sort.key === "criticality") {
      const d = (SEVERITY_RANK[String(b.severity)] ?? 0) - (SEVERITY_RANK[String(a.severity)] ?? 0);
      return d * sign || oldestFirst(a, b);
    }
    if (sort.key === "time") return oldestFirst(a, b) * sign;
    const p = String(a.vehicle ?? "").localeCompare(String(b.vehicle ?? ""), undefined, { numeric: true });
    return p * sign || oldestFirst(a, b);
  };
  return [...list].sort(cmp);
}

/** Tapping a chip: a new key starts in its natural order; the same key flips. */
export function nextSort<K extends string>(
  current: { key: K; reversed: boolean },
  key: K,
): { key: K; reversed: boolean } {
  return current.key === key ? { key, reversed: !current.reversed } : { key, reversed: false };
}
