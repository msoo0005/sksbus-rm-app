import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { api } from "@/api/client";
import HomeHeader from "@/components/HomeHeader";
import { useSession } from "@/ctx";
import { useI18n } from "@/i18n/i18n-ctx";
import { ALL_PROJECTS, useProject } from "@/project-ctx";
import { getProjectLogo } from "@/utils/projectLogos";
import { roleColorsFor, roleHomeFor, roleLabelFor } from "@/utils/roles";

// The first screen every role sees after signing in.
//
// It is a landing page now, not a utility screen: the gate in _layout.tsx holds
// every role here until a project is chosen, because every screen beyond it is
// scoped to one. So it opens with the same greeting header as the role homes and
// leads with the projects themselves rather than a form.

type Project = {
  project_id: string;
  project_name: string;
  project_desc?: string | null;
  pending_count?: number;
  open_count?: number;
};

// Matches the admin console's grid, so the two landing pages lay out alike.
const CONTENT_MAX_WIDTH = 720;
const CONTENT_H_PADDING = 20;
const GRID_GAP = 12;

/** Fallback mark for the projects with no bundled logo. */
function projectInitials(project: Project) {
  const source = (project.project_id || project.project_name || "").trim();
  if (!source) return "?";
  return source.slice(0, 4).toUpperCase();
}

export default function ProjectSelectorScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { dbUser } = useSession();
  const { width: windowWidth } = useWindowDimensions();
  const params = useLocalSearchParams<{ returnTo?: string; from?: string }>();

  const role = dbUser?.user_role ?? "driver";
  const isAdmin = role === "admin";
  const roleColors = roleColorsFor(role);

  // Where to go once a project is chosen.
  //
  // The fallback is this user's role home, which is right when the selector was
  // reached by the GATE — no project chosen yet, so send them where they belong.
  // It is NOT right when the selector was opened deliberately to switch project:
  // an admin's role home is the console they tapped from, so falling back there
  // makes the button appear to do nothing. Such callers pass returnTo.
  const resolved = params.returnTo || roleHomeFor(role);
  // And never bounce back to the selector itself, which would leave the user
  // staring at the screen they just finished with.
  const returnTo = resolved.startsWith("/project-selector") ? roleHomeFor(role) : resolved;

  const {
    projectId: selectedProjectId,
    setProjectId,
    loading: projectLoading,
  } = useProject();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      // Admin reads the full project list; everyone else reads their own.
      //
      // This is a branch, not a preference: /projects is admin-only and 403s for
      // any other role, while /me/projects returns USER_PROJECT rows — of which
      // an admin normally has none. Calling the wrong one for an admin used to
      // mean an empty list on a screen they cannot leave.
      const data = isAdmin ? await api.projects() : await api.myProjects();
      setProjects(Array.isArray(data) ? (data as Project[]) : []);
    } catch (e: any) {
      setError(e?.message ?? t("projectSelector.failedToLoadProjects"));
      setProjects([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, isAdmin]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Opened by the chip (pushed on top of a screen) rather than by the gate
  // (which replaced whatever was there). Only the pushed case has something to
  // go back to.
  const pushedOnTop = params.from === "chip";

  const choose = useCallback(
    async (projectId: string) => {
      await setProjectId(projectId);
      // Going back re-renders the screen underneath with the new project, since
      // every screen reads it from context — no need to navigate to it afresh,
      // and doing so would stack it on top of itself.
      if (pushedOnTop && router.canGoBack()) router.back();
      else router.replace(returnTo as any);
    },
    [router, setProjectId, returnTo, pushedOnTop],
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // Responsive columns, same arithmetic as the admin console's module grid.
  const contentWidth = Math.min(windowWidth, CONTENT_MAX_WIDTH) - CONTENT_H_PADDING * 2;
  const columns = windowWidth >= 900 ? 4 : windowWidth >= 600 ? 3 : 2;
  const tileWidth = (contentWidth - GRID_GAP * (columns - 1)) / columns;

  const showLoading = loading || projectLoading;

  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <HomeHeader
        roleLabel={roleLabelFor(role)}
        roleColor={roleColors.accent}
        roleColorLight={roleColors.light}
        showProject={false}
      />

      <Text style={s.prompt}>{t("projectSelector.title")}</Text>
      <Text style={s.promptSub}>{t("projectSelector.subtitle")}</Text>


      {!!error && (
        <View style={s.errorBox}>
          <Text style={s.errorTitle}>{t("projectSelector.couldntLoadProjects")}</Text>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {/* Admin only. Fleet-wide is a deliberate choice here, not the absence of
          one — picking it satisfies the gate and applies no project filter. */}
      {isAdmin && (
        <Pressable
          onPress={() => choose(ALL_PROJECTS)}
          disabled={projectLoading}
          style={({ pressed }) => [
            s.allCard,
            selectedProjectId === ALL_PROJECTS && s.allCardSelected,
            pressed && s.pressed,
          ]}
        >
          <View style={s.allIcon}>
            <FontAwesome5 name="globe" size={16} color="#4338CA" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.allTitle}>{t("projectSelector.allProjectsTitle")}</Text>
            <Text style={s.allSub}>
              {t("projectSelector.allProjectsSubtitle", { count: String(projects.length) })}
            </Text>
          </View>
          <FontAwesome5 name="chevron-right" size={13} color="#9CA3AF" />
        </Pressable>
      )}

      {showLoading ? (
        <View style={s.loading}>
          <ActivityIndicator />
          <Text style={s.loadingText}>
            {loading
              ? t("projectSelector.loadingProjects")
              : t("projectSelector.restoringSelection")}
          </Text>
        </View>
      ) : projects.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>{t("projectSelector.emptyTitle")}</Text>
          <Text style={s.emptySub}>{t("projectSelector.emptyNoneAssigned")}</Text>
        </View>
      ) : (
        <>
          <Text style={s.sectionLabel}>
            {t("projectSelector.sectionLabel", { count: String(projects.length) })}
          </Text>
          <View style={[s.grid, { gap: GRID_GAP }]}>
            {projects.map((item) => {
              const logo = getProjectLogo(item.project_id);
              const selected = item.project_id === selectedProjectId;
              const flagged = (item.pending_count ?? 0) + (item.open_count ?? 0);

              return (
                <Pressable
                  key={item.project_id}
                  onPress={() => choose(item.project_id)}
                  disabled={projectLoading}
                  style={({ pressed }) => [
                    s.tile,
                    { width: tileWidth },
                    selected && s.tileSelected,
                    pressed && s.pressed,
                  ]}
                >
                  <View style={s.logoWrap}>
                    {logo ? (
                      <Image source={logo} style={s.logo} resizeMode="contain" />
                    ) : (
                      <Text style={s.logoFallback}>{projectInitials(item)}</Text>
                    )}
                  </View>

                  <Text style={s.tileTitle} numberOfLines={2}>
                    {item.project_name || item.project_id}
                  </Text>
                  <Text style={s.tileId} numberOfLines={1}>
                    {item.project_id}
                  </Text>

                  {/* One badge, not two stacked: at a glance the useful number is
                      "how much is waiting on me here", and the split between
                      pending and open is a detail for the screen behind it. */}
                  {flagged > 0 && (
                    <View style={s.tileBadge}>
                      <View style={s.tileBadgeDot} />
                      <Text style={s.tileBadgeText}>
                        {t("projectSelector.needsAttention", { count: String(flagged) })}
                      </Text>
                    </View>
                  )}

                  {selected && (
                    <View style={s.tileCheck}>
                      <FontAwesome5 name="check" size={9} color="#fff" />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: {
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: CONTENT_H_PADDING,
    paddingBottom: 32,
  },

  prompt: { fontSize: 19, fontWeight: "800", color: "#111827", letterSpacing: -0.2 },
  promptSub: { marginTop: 4, fontSize: 13, fontWeight: "600", color: "#6B7280" },


  errorBox: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FFF1F2",
    borderRadius: 14,
    padding: 12,
  },
  errorTitle: { fontWeight: "800", color: "#991B1B" },
  errorText: { marginTop: 4, fontWeight: "600", color: "#7F1D1D" },

  allCard: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#E0E7FF",
    backgroundColor: "#EEF2FF",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  allCardSelected: { borderColor: "#4338CA", borderWidth: 2 },
  allIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  allTitle: { fontSize: 15, fontWeight: "800", color: "#312E81" },
  allSub: { marginTop: 2, fontSize: 12, fontWeight: "600", color: "#4F46E5" },

  sectionLabel: {
    marginTop: 20,
    marginBottom: 10,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: "#6B7280",
  },

  grid: { flexDirection: "row", flexWrap: "wrap" },

  tile: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    minHeight: 148,
  },
  tileSelected: { borderColor: "#111827", borderWidth: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },

  logoWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 12,
  },
  logo: { width: "78%", height: "78%" },
  logoFallback: { fontSize: 13, fontWeight: "900", color: "#6B7280", letterSpacing: 0.3 },

  tileTitle: { fontSize: 14, fontWeight: "800", color: "#111827", lineHeight: 18 },
  tileId: { marginTop: 3, fontSize: 11, fontWeight: "700", color: "#9CA3AF" },

  tileBadge: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: "#FFFBEB",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tileBadgeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#B45309" },
  tileBadgeText: { fontSize: 10, fontWeight: "800", color: "#B45309" },

  tileCheck: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },

  loading: { paddingTop: 48, alignItems: "center", gap: 10 },
  loadingText: { fontSize: 14, fontWeight: "700", color: "#6B7280" },

  empty: { paddingTop: 40, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  emptySub: { marginTop: 6, fontSize: 13, fontWeight: "600", color: "#6B7280", textAlign: "center" },
});
