// app/(app)/project-selector.tsx
import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Card, CardContent } from "../components/card";
import { useSession } from "../ctx";
import { useProject } from "../project-ctx"; // ✅ NEW: persisted project selection

// Match your DB/API response (adjust field names if your PROJECT table differs)
type Project = {
  project_id: string;
  project_name: string;
  project_desc?: string | null;
};

// Put your API base URL in env (recommended)
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

async function fetchMyProjects(
  token: string | null | undefined,
): Promise<Project[]> {
  if (!API_BASE_URL) throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");

  const res = await fetch(`${API_BASE_URL}/me/projects`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load projects (${res.status}) ${text}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as Project[]) : [];
}

export default function ProjectSelectorScreen() {
  const router = useRouter();
  const { session } = useSession(); // your JWT/access token string
  const {
    projectId: selectedProjectId,
    setProjectId,
    loading: projectLoading,
  } = useProject();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchMyProjects(session);
      setProjects(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load projects.");
      setProjects([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;

    return projects.filter((p) => {
      const id = (p.project_id ?? "").toLowerCase();
      const name = (p.project_name ?? "").toLowerCase();
      const desc = (p.project_desc ?? "").toLowerCase();
      return id.includes(q) || name.includes(q) || desc.includes(q);
    });
  }, [projects, query]);

  // ✅ NEW: persist selection, then navigate without params
  const onSelect = useCallback(
    async (projectId: string) => {
      await setProjectId(projectId);

      // If you want users to be able to go "back" to selector, change to router.push(...)
      router.replace("./fleet-manager");
    },
    [router, setProjectId],
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const renderItem = ({ item }: { item: Project }) => {
    // Simple icon heuristic (optional)
    const iconName = item.project_id?.toUpperCase().includes("DEPOT")
      ? "warehouse"
      : "folder";
    const selected = item.project_id === selectedProjectId;

    return (
      <Pressable
        onPress={() => onSelect(item.project_id)}
        disabled={projectLoading}
      >
        {({ pressed }) => (
          <Card
            style={[
              styles.projectCard,
              selected && styles.projectCardSelected, // ✅ highlight current selection
              pressed && styles.projectCardPressed,
            ]}
          >
            <CardContent style={styles.row}>
              <View style={styles.left}>
                <View
                  style={[styles.iconWrap, selected && styles.iconWrapSelected]}
                >
                  <FontAwesome5
                    name={iconName as any}
                    size={18}
                    color="#111827"
                  />
                </View>

                <View style={styles.textCol}>
                  <Text style={styles.title} numberOfLines={1}>
                    {item.project_name || item.project_id}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.project_id}
                    {item.project_desc ? ` • ${item.project_desc}` : ""}
                  </Text>

                  {selected && <Text style={styles.selectedTag}>Selected</Text>}
                </View>
              </View>

              <Text style={styles.chev}>›</Text>
            </CardContent>
          </Card>
        )}
      </Pressable>
    );
  };

  const showLoading = loading || projectLoading;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.h1}>Select a Project</Text>
        <Text style={styles.sub}>Projects assigned to your account</Text>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔎</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search projects…"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            editable={!projectLoading}
          />
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Couldn’t load projects</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>

      {showLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>
            {loading ? "Loading projects…" : "Restoring selection…"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.project_id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No projects found</Text>
              <Text style={styles.emptySub}>
                {projects.length === 0
                  ? "You’re not assigned to any projects yet."
                  : "Try clearing your search."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fff" },

  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8 },

  h1: { fontSize: 28, fontWeight: "800", color: "#111827" },
  sub: { marginTop: 6, fontSize: 14, fontWeight: "600", color: "#6B7280" },

  searchBox: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#F9FAFB",
  },
  searchIcon: { marginRight: 8, fontSize: 14 },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },

  errorBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FFF1F2",
    borderRadius: 14,
    padding: 12,
  },
  errorTitle: { fontWeight: "800", color: "#991B1B" },
  errorText: { marginTop: 4, fontWeight: "600", color: "#7F1D1D" },

  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontSize: 14, fontWeight: "700", color: "#6B7280" },

  listContent: { paddingHorizontal: 18, paddingBottom: 18, gap: 10 },

  projectCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  projectCardPressed: { opacity: 0.85, transform: [{ scale: 0.995 }] },

  // ✅ NEW: selected styling
  projectCardSelected: {
    borderColor: "#111827",
  },
  iconWrapSelected: {
    borderColor: "#111827",
  },

  row: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  left: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },

  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
  },

  textCol: { flex: 1 },

  title: { fontSize: 16, fontWeight: "800", color: "#111827" },
  meta: { marginTop: 3, fontSize: 12, fontWeight: "700", color: "#6B7280" },

  selectedTag: {
    marginTop: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#111827",
    color: "#111827",
    fontSize: 12,
    fontWeight: "800",
  },

  chev: { fontSize: 22, fontWeight: "900", color: "#9CA3AF", marginLeft: 8 },

  empty: { paddingTop: 30, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  emptySub: { marginTop: 6, fontSize: 13, fontWeight: "600", color: "#6B7280" },
});
