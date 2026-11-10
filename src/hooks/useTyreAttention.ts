import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api, type LowTreadTyre, type OverdueBus } from "../api/client";

/**
 * "What needs doing to the fleet's tyres?" — the two cheap scans, fetched once
 * and shared.
 *
 * Three places need these same numbers: the needs-attention strip and the tab
 * badges on the tyre screen, the bus list's filters and ordering, and the
 * count on the role home's tyre card. They used to be fetched independently by
 * the hub (purely to decorate cards it then threw away), the bus list and the
 * stock list — the same two endpoints, three times, in one session.
 *
 * Deliberately NOT a context. Each consumer mounts at a different time and
 * refetches on focus, and a shared provider would either have to live above the
 * whole app or be threaded through the tyre screen's panels; both are more
 * machinery than two GETs justify.
 */
export type TyreAttention = {
  /** Buses past the inspection interval, or never inspected at all. */
  overdueBuses: OverdueBus[];
  /** Every bus with its inspection standing, overdue or not. */
  allBuses: OverdueBus[];
  /** Mounted tyres whose latest reading is under the server's threshold. */
  lowTread: LowTreadTyre[];
  inspectionIntervalDays: number;
  loading: boolean;
  reload: () => Promise<void>;
};

const NO_BUSES: OverdueBus[] = [];
const NO_TYRES: LowTreadTyre[] = [];

export function useTyreAttention(projectId: string | null): TyreAttention {
  const [allBuses, setAllBuses] = useState<OverdueBus[]>(NO_BUSES);
  const [overdueBuses, setOverdueBuses] = useState<OverdueBus[]>(NO_BUSES);
  const [lowTread, setLowTread] = useState<LowTreadTyre[]>(NO_TYRES);
  const [inspectionIntervalDays, setIntervalDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    // Both are best-effort: a failure here must leave the screen usable rather
    // than blocking the lists these numbers only annotate.
    const [overdueRes, lowTreadRes] = await Promise.all([
      api.getOverdueTyreInspections(projectId).catch(() => null),
      api.getLowTreadTyres(projectId).catch(() => null),
    ]);
    if (overdueRes) {
      setAllBuses(overdueRes.all_buses ?? NO_BUSES);
      setOverdueBuses(overdueRes.overdue_buses ?? NO_BUSES);
      setIntervalDays(overdueRes.inspection_interval_days ?? 30);
    }
    setLowTread(lowTreadRes?.low_tread_tyres ?? NO_TYRES);
    setLoading(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return {
    overdueBuses,
    allBuses,
    lowTread,
    inspectionIntervalDays,
    loading,
    reload,
  };
}
