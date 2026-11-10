import { ALL_PROJECTS, useProject } from "../project-ctx";

/**
 * The project to narrow API calls to, or null for "everything I'm allowed to
 * see".
 *
 * Not the same thing as useProject().projectId, which is the raw stored value
 * and may be the ALL_PROJECTS sentinel. Passing that sentinel to the server as a
 * project_id would match no project and empty every screen.
 *
 * This used to special-case admin to null, because admin was exempt from the
 * project gate and could be carrying a stale selection from the fleet-manager
 * flow. Admin is now gated like everyone else and chooses fleet-wide
 * deliberately, so the exemption would do the opposite of what it was for: an
 * admin who picked a project would find nothing filtered by it.
 */
export function useProjectFilter(): string | null {
  const { projectId } = useProject();
  if (!projectId || projectId === ALL_PROJECTS) return null;
  return projectId;
}
