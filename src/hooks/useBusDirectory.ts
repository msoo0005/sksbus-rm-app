import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import type { Bus } from "../api/client";
import { api } from "../api/client";
import { useProjectFilter } from "./useProjectFilter";

// The bus list, fetched once per screen and indexed by id.
//
// `/buses` is project-scoped server-side for non-admins, so this is also the
// authority on which buses a user may open — screens that drive their rows off
// it can only ever link to buses the user is entitled to. It replaces both the
// raw api.buses() calls in three list screens and the wasteful pattern of
// fetching the whole fleet just to .find() one row.

export function useBusDirectory() {
  const projectId = useProjectFilter();
  const [buses, setBuses] = useState<Bus[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const rows = await api.buses(projectId ? { project_id: projectId } : undefined);
      setBuses(Array.isArray(rows) ? rows : []);
    } catch {
      // A failed bus load leaves the list empty rather than breaking the
      // screen; the caller's own error surface covers the primary request.
      setBuses([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const byId = useMemo(() => {
    const m = new Map<string, Bus>();
    for (const b of buses) m.set(String(b.bus_id), b);
    return m;
  }, [buses]);

  return { buses, byId, loading, reload };
}
