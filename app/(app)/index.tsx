import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import AlertBubble from "@/components/AlertBubble";
import { ProjectTile } from "@/components/HomeHeader";
import { useSession } from "@/ctx";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { usePuspakomCount } from "@/hooks/usePuspakomCount";
import { useI18n } from "@/i18n/i18n-ctx";
import { ROLE_COLORS, ROLE_HOME, ROLE_ICONS, type RoleKey } from "@/utils/roles";

const ADMIN = ROLE_COLORS.admin;

type Waiting = { label: string; count: number };

/**
 * A4: the numbers behind each role row, for the whole project, so they are the
 * same numbers the role homes show. Charger & Depot (G) and low parts stock (H)
 * join the lines when those parts are built.
 */
function useAdminCounts(projectId: string | null) {
  const fmPuspakom = usePuspakomCount("fleet_manager", projectId);
  const techPuspakom = usePuspakomCount("technician", projectId);
  const [reports, setReports] = React.useState({ pending: 0, open: 0 });

  const reload = React.useCallback(async () => {
    try {
      const project = projectId ? { project_id: projectId } : {};
      const [pending, open] = await Promise.all([
        api.listReports({ status: "submitted", ...project }),
        api.listReports({ status: "open", ...project }),
      ]);
      setReports({ pending: pending?.length ?? 0, open: open?.length ?? 0 });
    } catch {
      // keep the last numbers
    }
  }, [projectId]);

  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  return {
    fleet_manager: [
      { label: "PUSPAKOM", count: fmPuspakom },
      { label: "reports", count: reports.pending + reports.open },
    ],
    rm_manager: [{ label: "breakdowns", count: reports.pending }],
    technician: [{ label: "preInspection", count: techPuspakom }],
  } as Record<"fleet_manager" | "rm_manager" | "technician", Waiting[]>;
}

const ROLE_ROWS: { role: "fleet_manager" | "rm_manager" | "technician"; route: string }[] = [
  { role: "fleet_manager", route: "/fleet-manager-home" },
  { role: "rm_manager", route: "/rm-manager-home" },
  { role: "technician", route: "/technician-home" },
];

const CONTENT_MAX_WIDTH = 720;

export default function HomeScreen() {
  const { dbUser } = useSession();
  const router = useRouter();
  const { t } = useI18n();
  const projectId = useProjectFilter();
  const counts = useAdminCounts(projectId);

  const role = (dbUser?.user_role ?? "driver") as RoleKey;
  // Admin's home IS this screen, so it alone has nowhere to be sent.
  const redirect = role === "admin" ? undefined : ROLE_HOME[role];

  React.useEffect(() => {
    if (redirect) router.replace(redirect as any);
  }, [redirect, router]);

  if (redirect) return null;

  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? "greeting.morning" : hour < 17 ? "greeting.afternoon" : "greeting.evening");
  const name = dbUser?.full_name || dbUser?.user_name || "";

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.band}>
        <View style={[styles.circle, styles.circleA]} />
        <View style={[styles.circle, styles.circleB]} />
        <View style={styles.bandInner}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.greeting}>{greeting},</Text>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <View style={styles.crownPill}>
              <View style={styles.crownIcon}>
                <FontAwesome5 name="crown" size={11} color="#1F2937" />
              </View>
              <Text style={styles.crownText}>{t("adminHome.fullAccess")}</Text>
            </View>
          </View>
          <View style={styles.tileBox}>
            <ProjectTile light />
          </View>
        </View>
      </View>

      <View style={styles.sheet}>
        <Text style={styles.sectionLabel}>{t("adminHome.openARole")}</Text>
        <View style={styles.rowsCard}>
          {ROLE_ROWS.map(({ role: r, route }, i) => {
            const color = ROLE_COLORS[r];
            const waiting = counts[r].filter((w) => w.count > 0);
            const total = counts[r].reduce((sum, w) => sum + w.count, 0);
            return (
              <Pressable
                key={r}
                onPress={() => router.push(route as any)}
                style={({ pressed }) => [styles.roleRow, i > 0 && styles.roleRowBorder, pressed && { opacity: 0.75 }]}
              >
                <View style={[styles.roleIcon, { backgroundColor: color.accent }]}>
                  <FontAwesome5 name={ROLE_ICONS[r] as any} size={18} color="#fff" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.roleTitle}>{t(`roles.${r}`)}</Text>
                  {waiting.length > 0 && (
                    <Text style={styles.waiting} numberOfLines={1}>
                      {waiting.map((w) => `${t(`adminHome.waiting.${w.label}`)} ${w.count}`).join(" · ")}
                    </Text>
                  )}
                </View>
                <AlertBubble count={total} size={22} />
                <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />
              </Pressable>
            );
          })}
        </View>

        <View style={styles.toolsHead}>
          <Text style={styles.sectionLabel}>{t("adminHome.adminTools")}</Text>
          <Text style={styles.toolsHint}>{t("adminHome.onlyAdmins")}</Text>
        </View>
        <Pressable
          onPress={() => router.push("/buses" as any)}
          style={({ pressed }) => [styles.toolRow, pressed && { opacity: 0.75 }]}
        >
          <View style={[styles.roleIcon, { backgroundColor: ADMIN.accent }]}>
            <FontAwesome5 name="bus" size={17} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.roleTitle}>{t("adminHome.busFleetTitle")}</Text>
            <Text style={styles.waiting}>{t("adminHome.busFleetDesc")}</Text>
          </View>
          <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center", paddingBottom: 40 },
  band: { backgroundColor: ADMIN.accent, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, overflow: "hidden" },
  circle: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)" },
  circleA: { width: 220, height: 220, right: -60, top: -40 },
  circleB: { width: 140, height: 140, right: 70, bottom: -70 },
  bandInner: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  greeting: { fontSize: 16, color: "#D1D5DB", fontWeight: "500" },
  name: { fontSize: 32, fontWeight: "800", color: "#fff", letterSpacing: -0.5, marginTop: 2 },
  crownPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginTop: 12,
    paddingLeft: 4,
    paddingRight: 14,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  crownIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  crownText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  tileBox: {},
  sheet: {
    marginTop: -28,
    backgroundColor: "#F9FAFB",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionLabel: { fontSize: 12, fontWeight: "800", color: "#6B7280", letterSpacing: 1, marginBottom: 10 },
  rowsCard: { backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, borderColor: "#F3F4F6" },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  roleRowBorder: { borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  roleIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  waiting: { fontSize: 12.5, color: "#6B7280", marginTop: 2 },
  toolsHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 22 },
  toolsHint: { fontSize: 12, color: "#9CA3AF" },
  toolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
});
