// src/project-ctx.tsx
import { deleteStoredItem, getStoredItem, setStoredItem } from "./utils/storage";
import React from "react";

/**
 * The stored value meaning "everything I'm allowed to see", as opposed to one
 * project.
 *
 * A sentinel rather than null, because null already means something else and the
 * two must not be confused. Every role now picks a project before reaching any
 * screen, so the gate has to know whether a choice has been MADE; admin can
 * additionally choose fleet-wide, which is a real choice that happens to apply
 * no filter. With null doing both jobs, an admin who chose fleet-wide would be
 * sent straight back to the selector forever.
 *
 *   null        -> not chosen yet   -> gate redirects
 *   ALL_PROJECTS-> chosen: no filter -> gate passes, useProjectFilter() -> null
 *   "GOKL"      -> chosen: one project
 */
export const ALL_PROJECTS = "__all__";

// Bumped from "selectedProjectId" when the gate became universal. Everyone
// re-picks once, which is the point: a value stored under the old rules was
// chosen when it only scoped the reports flow, and silently applying it to every
// screen would filter people to a project they never knowingly selected.
const STORAGE_KEY = "selectedProjectV2";

type ProjectContextType = {
  /** The raw stored value — may be ALL_PROJECTS. Filter through useProjectFilter. */
  projectId: string | null;
  /** Has this user made a choice at all? The project gate keys on this. */
  hasChosen: boolean;
  loading: boolean;
  setProjectId: (projectId: string | null) => Promise<void>;
  clearProject: () => Promise<void>;
};

const ProjectContext = React.createContext<ProjectContextType | null>(null);

export function useProject() {
  const ctx = React.useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = React.useState(true);
  const [projectId, setProjectIdState] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const saved = await getStoredItem(STORAGE_KEY);
        setProjectIdState(saved ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setProjectId = React.useCallback(async (next: string | null) => {
    if (next) {
      await setStoredItem(STORAGE_KEY, next);
      setProjectIdState(next);
    } else {
      await deleteStoredItem(STORAGE_KEY);
      setProjectIdState(null);
    }
  }, []);

  const clearProject = React.useCallback(async () => {
    await deleteStoredItem(STORAGE_KEY);
    setProjectIdState(null);
  }, []);

  return (
    <ProjectContext.Provider
      value={{ projectId, hasChosen: projectId != null, loading, setProjectId, clearProject }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
