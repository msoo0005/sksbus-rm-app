import { useMemo } from "react";
import { pendingCount, useInspectionDraft } from "../offline/puspakomDrafts";
import { localDone, needsAttention } from "../utils/puspakomLocal";

/** One pre-inspection's draft, with progress worked out per stop. */
export function usePrecheck(id: number) {
  const base = useInspectionDraft(id, "PRE");
  const { detail, draft } = base;

  const stats = useMemo(() => {
    const defs = detail?.defs;
    const settings = detail?.settings;
    if (!defs || !settings) return null;
    const answers = draft?.answers ?? {};
    const stops = defs.stops.map((st) => {
      const checks = defs.checks.filter((c) => c.stop_no === st.stop_no);
      const done = checks.filter((c) => localDone(c, answers[c.check_id])).length;
      const started = checks.some((c) => !!answers[c.check_id]);
      const attention = checks.filter((c) => localDone(c, answers[c.check_id]) && needsAttention(c, answers[c.check_id], settings));
      return { stop: st, checks, done, total: checks.length, started, attention };
    });
    const done = stops.reduce((n, x) => n + x.done, 0);
    const total = stops.reduce((n, x) => n + x.total, 0);
    const carryOn = stops.find((x) => x.done < x.total) ?? null;
    return { stops, done, total, carryOn, complete: done === total && total > 0 };
  }, [detail, draft]);

  return { ...base, stats, pending: pendingCount(draft) };
}
