// app/project-ctx.tsx
import * as SecureStore from "expo-secure-store";
import React from "react";

type ProjectContextType = {
  projectId: string | null;
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
      const saved = await SecureStore.getItemAsync("selectedProjectId");
      setProjectIdState(saved ?? null);
      setLoading(false);
    })();
  }, []);

  const setProjectId = React.useCallback(async (next: string | null) => {
    if (next) {
      await SecureStore.setItemAsync("selectedProjectId", next);
      setProjectIdState(next);
    } else {
      await SecureStore.deleteItemAsync("selectedProjectId");
      setProjectIdState(null);
    }
  }, []);

  const clearProject = React.useCallback(async () => {
    await SecureStore.deleteItemAsync("selectedProjectId");
    setProjectIdState(null);
  }, []);

  return (
    <ProjectContext.Provider
      value={{ projectId, loading, setProjectId, clearProject }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
