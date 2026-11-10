import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, type Bus, type LowTreadTyre, type OverdueBus, type Tyre, type TyreStatus } from "../api/client";
import { inspectionDueState } from "../components/tyres/InspectionDueBadge";
import { useBusDirectory } from "./useBusDirectory";
import { useTyreAttention } from "./useTyreAttention";
import { useI18n } from "../i18n/i18n-ctx";

/**
 * Everything the tyre section screen and its panels read, loaded once.
 *
 * WHY THIS EXISTS AT ALL — the focus trap.
 *
 * The section keeps its panels MOUNTED and hides the inactive ones, so tapping
 * back from a bus returns you to the filter, query and scroll position you left.
 * That has one sharp consequence: a hidden panel is still inside a focused
 * screen, so any useFocusEffect inside it would fire on every focus and refetch
 * for tabs nobody is looking at. So no panel may fetch on focus — all of it
 * happens here, once, and the panels receive plain data.
 *
 * useBusDirectory is the specific landmine: it has a useFocusEffect baked in, so
 * it must be called HERE and never inside a panel.
 *
 * These four calls are not new load. The old hub fetched all four purely to
 * print counts on three cards and then threw them away, and the bus list
 * immediately refetched three of them. Consolidating removes a whole duplicate
 * round trip.
 */

export type BusFilter = "all" | "needsChange" | "overdue";

export type BusRow = {
  bus: Bus;
  lastInspectedAt: string | null;
  due: ReturnType<typeof inspectionDueState>;
  fitted: number;
  /** The worst low-tread tyre on this bus, if any — drives the deep link. */
  flagged: LowTreadTyre | null;
};

export type TyreSectionData = {
  busRows: BusRow[];
  tyres: Tyre[];
  lowTread: LowTreadTyre[];
  lowTreadIds: Set<number>;
  intervalDays: number;
  counts: {
    buses: number;
    tyres: number;
    overdue: number;
    needsChange: number;
    pastLimit: number;
    byStatus: Record<string, number>;
  };
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
};

export function useTyreSectionData(projectId: string | null): TyreSectionData {
  const { t } = useI18n();
  const attention = useTyreAttention(projectId);
  const { buses, loading: busesLoading, reload: reloadBuses } = useBusDirectory();

  const [tyres, setTyres] = useState<Tyre[]>([]);
  const [tyresLoading, setTyresLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTyres = useCallback(async () => {
    try {
      const rows = await api.listTyres({ project_id: projectId });
      setTyres(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      // Surfaced rather than swallowed. An empty catch here renders a 403 from
      // an unauthorised project identically to "this project has no tyres" —
      // the failure mode that once made every tyre in the app appear to vanish.
      Alert.alert(t("common.error"), e?.message ?? "Failed to load tyres");
      setTyres([]);
    } finally {
      setTyresLoading(false);
    }
  }, [projectId, t]);

  useFocusEffect(
    useCallback(() => {
      loadTyres();
    }, [loadTyres]),
  );

  // Depends on the stable reload callbacks, not on the attention object, whose
  // identity changes every render and would make refresh() change with it.
  const reloadAttention = attention.reload;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([reloadAttention(), reloadBuses(), loadTyres()]);
    } finally {
      setRefreshing(false);
    }
  }, [reloadAttention, reloadBuses, loadTyres]);

  const statusByBus = useMemo(() => {
    const m = new Map<string, OverdueBus>();
    for (const b of attention.allBuses) m.set(String(b.bus_id), b);
    return m;
  }, [attention.allBuses]);

  const fittedByBus = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of tyres) {
      if (x.current_bus_id) m.set(x.current_bus_id, (m.get(x.current_bus_id) ?? 0) + 1);
    }
    return m;
  }, [tyres]);

  // The WORST low-tread tyre per bus, not just any — the bus row deep-links to
  // this wheel, so it should land on the one that most needs looking at.
  const flaggedByBus = useMemo(() => {
    const m = new Map<string, LowTreadTyre>();
    for (const x of attention.lowTread) {
      const key = x.current_bus_id ? String(x.current_bus_id) : null;
      if (!key) continue;
      const held = m.get(key);
      if (!held || Number(x.min_tread_mm) < Number(held.min_tread_mm)) m.set(key, x);
    }
    return m;
  }, [attention.lowTread]);

  const busRows = useMemo<BusRow[]>(
    () =>
      buses.map((bus) => {
        const st = statusByBus.get(String(bus.bus_id));
        return {
          bus,
          lastInspectedAt: st?.last_inspected_at ?? null,
          due: inspectionDueState(st?.days_since_inspection ?? null, attention.inspectionIntervalDays),
          fitted: fittedByBus.get(String(bus.bus_id)) ?? 0,
          flagged: flaggedByBus.get(String(bus.bus_id)) ?? null,
        };
      }),
    [buses, statusByBus, fittedByBus, flaggedByBus, attention.inspectionIntervalDays],
  );

  const lowTreadIds = useMemo(
    () => new Set(attention.lowTread.map((x) => x.tyre_id)),
    [attention.lowTread],
  );

  // Counts are computed off the UNFILTERED sets, so selecting one filter never
  // rewrites the other filters' numbers.
  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const x of tyres) {
      const k = String(x.tyre_status) as TyreStatus;
      byStatus[k] = (byStatus[k] ?? 0) + 1;
    }
    return {
      buses: busRows.length,
      tyres: tyres.length,
      overdue: busRows.filter((r) => r.due.isOverdue).length,
      needsChange: busRows.filter((r) => !!r.flagged).length,
      pastLimit: attention.lowTread.length,
      byStatus,
    };
  }, [busRows, tyres, attention.lowTread]);

  return {
    busRows,
    tyres,
    lowTread: attention.lowTread,
    lowTreadIds,
    intervalDays: attention.inspectionIntervalDays,
    counts,
    loading: attention.loading || busesLoading || tyresLoading,
    refreshing,
    refresh,
  };
}
