// C7 · the Sort by menu on the R&M jobs list (v2.0.0).
//
//   Option        Default  Ascending ↑                       Descending ↓
//   Status        asc      groups 1→4, open the longest     groups 4→1, newest first
//   Criticality   desc     Low → Critical                   Critical → Low
//   Time          desc     newest first                     open the longest first
//   Bus           asc      plate A → Z                      plate Z → A
//
// Status groups come from the job's state, so a card moves group by itself:
//   1 Awaiting your approval (pending_approval) · 2 Arrived · working ·
//   3 Accepted · on the way · 4 Not accepted yet (approved).

export type JobSortKey = "status" | "criticality" | "time" | "bus";
export type SortDir = "asc" | "desc";
export type JobSort = { key: JobSortKey; dir: SortDir };

export const JOB_SORT_KEYS: JobSortKey[] = ["status", "criticality", "time", "bus"];
export const JOB_SORT_DEFAULT_DIR: Record<JobSortKey, SortDir> = {
  status: "asc",
  criticality: "desc",
  time: "desc",
  bus: "asc",
};
export const DEFAULT_JOB_SORT: JobSort = { key: "status", dir: "asc" };

export const STATUS_GROUPS = [
  { group: 1, state: "pending_approval", color: "#D97706" },
  { group: 2, state: "arrived", color: "#7C3AED" },
  { group: 3, state: "accepted", color: "#EA580C" },
  { group: 4, state: "approved", color: "#9CA3AF" },
] as const;

const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export type JobSortable = {
  id?: number;
  severity?: string | null;
  vehicle?: string | null;
  jobState?: string | null;
  /** Report submitted (breakdowns) or job order issued: the open-time start. */
  clockStart?: string | null;
  dateIso?: string | null;
};

export function statusGroupOf(state?: string | null): number {
  return STATUS_GROUPS.find((g) => g.state === state)?.group ?? 5;
}

function startMs(x: JobSortable) {
  const v = x.clockStart ?? x.dateIso;
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function sortJobs<T extends JobSortable>(list: T[], sort: JobSort): T[] {
  const asc = sort.dir === "asc";
  const longestFirst = (a: T, b: T) => startMs(a) - startMs(b) || (a.id ?? 0) - (b.id ?? 0);
  const newestFirst = (a: T, b: T) => -longestFirst(a, b);

  const cmp = (a: T, b: T): number => {
    switch (sort.key) {
      case "status": {
        const d = statusGroupOf(a.jobState) - statusGroupOf(b.jobState);
        return asc ? d || longestFirst(a, b) : -d || newestFirst(a, b);
      }
      case "criticality": {
        const d = (SEVERITY_RANK[String(a.severity)] ?? 0) - (SEVERITY_RANK[String(b.severity)] ?? 0);
        return (asc ? d : -d) || longestFirst(a, b);
      }
      case "time":
        return asc ? newestFirst(a, b) : longestFirst(a, b);
      case "bus": {
        const p = String(a.vehicle ?? "").localeCompare(String(b.vehicle ?? ""), undefined, { numeric: true });
        return (asc ? p : -p) || longestFirst(a, b);
      }
    }
  };
  return [...list].sort(cmp);
}

/** Picking an option: a new one opens in its own default direction; the same one flips. */
export function pickJobSort(current: JobSort, key: JobSortKey): JobSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: JOB_SORT_DEFAULT_DIR[key] };
}

export function isJobSort(x: any): x is JobSort {
  return !!x && JOB_SORT_KEYS.includes(x.key) && (x.dir === "asc" || x.dir === "desc");
}
