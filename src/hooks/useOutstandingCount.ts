import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "../api/client";
import { useSession } from "../ctx";

const REFRESH_MS = 60_000;

/**
 * How much work is outstanding for the role — the number in the red bubble on
 * the role home card.
 *
 * - rm_manager: reports still Pending ("submitted": awaiting approval) or Open (approved,
 *   job not yet closed) in the current project.
 * - technician: open jobs that are either still up for grabs or already
 *   accepted by this technician.
 *
 * Refetched on focus and every minute while mounted, so the bubble stays on
 * for as long as the count is above 0 and clears itself when it reaches 0.
 * Best-effort: a failed fetch keeps the last count rather than flashing 0.
 */
export function useOutstandingCount(
  role: "rm_manager" | "technician",
  projectId: string | null,
): number {
  const { dbUser } = useSession() as any;
  const myUserId = dbUser?.user_id ? Number(dbUser.user_id) : null;
  const [count, setCount] = useState(0);

  const reload = useCallback(async () => {
    try {
      const project = projectId ? { project_id: projectId } : {};
      if (role === "rm_manager") {
        const [pending, open] = await Promise.all([
          api.listReports({ status: "submitted", ...project }),
          api.listReports({ status: "open", ...project }),
        ]);
        setCount((pending?.length ?? 0) + (open?.length ?? 0));
      } else {
        const jobs = await api.listJobs({ status: "open", ...project });
        setCount(
          (jobs ?? []).filter(
            (j: any) => j.technician_user_id == null || Number(j.technician_user_id) === myUserId,
          ).length,
        );
      }
    } catch {
      // keep the previous count
    }
  }, [role, projectId, myUserId]);

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
