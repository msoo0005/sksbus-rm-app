import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { puspakomApi } from "../api/puspakom";

const REFRESH_MS = 60_000;

/**
 * The number on the PUSPAKOM home row.
 *
 * - fleet_manager: buses needing the Fleet Manager (Overdue · not booked +
 *   Not booked + Inspected · update result), shown as a red bubble.
 * - technician: pre-inspections and re-checks not yet submitted ("n to do").
 *
 * The R&M Manager has nothing to act on, so it gets no count (spec p.59).
 * Refreshed on focus and every minute; a failed fetch keeps the last value.
 */
export function usePuspakomCount(role: "fleet_manager" | "technician", projectId: string | null): number {
  const [count, setCount] = useState(0);

  const reload = useCallback(async () => {
    try {
      const c = await puspakomApi.counts(projectId);
      setCount(role === "technician" ? c.technician_todo ?? 0 : c.action ?? 0);
    } catch {
      // keep the previous count
    }
  }, [role, projectId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  useEffect(() => {
    const id = setInterval(reload, REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  return count;
}
