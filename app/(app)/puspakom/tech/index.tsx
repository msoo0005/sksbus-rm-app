// PUSPAKOM Pre-inspection list (Technician screen 2). Only inspections the
// Fleet Manager has registered appear here; there is no assignment step.

import { FontAwesome5 } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PspTechItem, puspakomApi } from "@/api/puspakom";
import Pill from "@/components/puspakom/Pill";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import Sheet from "@/components/Sheet";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useI18n } from "@/i18n/i18n-ctx";
import { syncAllDrafts } from "@/offline/puspakomDrafts";
import { TECH_PILL_TONE, daysBetween, fmtDateTime, fmtDayMonth, fmtShortDateTime, mytDate } from "@/utils/puspakom";
import { ROLE_COLORS } from "@/utils/roles";

const ACCENT = ROLE_COLORS.technician.accent;
type Tab = "TODO" | "DONE" | "ALL";
type SortKey = "inspection" | "due" | "busNo" | "fleetNo";
const SORTS: SortKey[] = ["inspection", "due", "busNo", "fleetNo"];
let keptSort: SortKey = "inspection";
const LIST_CACHE = (p: string | null) => `psp:techlist:${p ?? "all"}`;

export default function PreInspectionList() {
  const router = useRouter();
  const { t } = useI18n();
  const projectId = useProjectFilter();
  const [items, setItems] = useState<PspTechItem[] | null>(null);
  const [today, setToday] = useState(mytDate());
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<Tab>("TODO");
  const [q, setQ] = useState("");
  const [sort, setSortState] = useState<SortKey>(keptSort);
  const [sortOpen, setSortOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    syncAllDrafts().catch(() => {});
    try {
      const r = await puspakomApi.prechecks(projectId);
      setItems(r.items);
      setToday(r.today);
      setOffline(false);
      AsyncStorage.setItem(LIST_CACHE(projectId), JSON.stringify(r)).catch(() => {});
    } catch {
      setOffline(true);
      const raw = await AsyncStorage.getItem(LIST_CACHE(projectId)).catch(() => null);
      if (raw) setItems(JSON.parse(raw).items);
      else setItems((x) => x ?? []);
    }
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const counts = useMemo(() => {
    const list = items ?? [];
    return { TODO: list.filter((i) => i.tab === "TODO").length, DONE: list.filter((i) => i.tab === "DONE").length, ALL: list.length };
  }, [items]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (items ?? []).filter(
      (i) =>
        (tab === "ALL" || i.tab === tab) &&
        (!needle || i.bus_id.toLowerCase().includes(needle) || String(i.bus_ev_no ?? "").toLowerCase().includes(needle)),
    );
    const fleet = (i: PspTechItem) => Number(String(i.bus_ev_no ?? "").replace(/\D/g, "")) || 1e9;
    return [...list].sort((a, b) =>
      sort === "inspection"
        ? a.scheduled_at.localeCompare(b.scheduled_at)
        : sort === "due"
          ? a.checklist_due.localeCompare(b.checklist_due) || a.scheduled_at.localeCompare(b.scheduled_at)
          : sort === "busNo"
            ? a.bus_id.localeCompare(b.bus_id)
            : fleet(a) - fleet(b),
    );
  }, [items, tab, q, sort]);

  const open = (i: PspTechItem) => {
    if (i.kind === "RECHECK") router.push(`/puspakom/tech/${i.inspection_id}/recheck` as any);
    else if (i.tab === "DONE") router.push(`/puspakom/checklist/${i.inspection_id}` as any);
    else router.push(`/puspakom/tech/${i.inspection_id}` as any);
  };

  return (
    <View style={s.page}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <PuspakomMark />
        <Text style={s.h1}>{t("puspakom.tech.listTitle")}</Text>
        <Text style={s.sub}>{t("puspakom.tech.listIntro")}</Text>
        {offline && (
          <View style={s.offline}>
            <FontAwesome5 name="wifi" size={12} color="#92400E" />
            <Text style={s.offlineText}>{t("puspakom.tech.offline")}</Text>
          </View>
        )}

        <View style={s.panel}>
          <View style={s.tabs}>
            {(["TODO", "DONE", "ALL"] as Tab[]).map((k) => (
              <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && { borderColor: ACCENT, backgroundColor: "#FFF7ED" }]}>
                <Text style={[s.tabText, tab === k && { color: ACCENT }]}>
                  {t(`puspakom.tech.tab${k}`)} <Text style={s.tabN}>{counts[k]}</Text>
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={s.search}>
            <FontAwesome5 name="search" size={12} color="#9CA3AF" />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t("puspakom.search")}
              placeholderTextColor="#9CA3AF"
              style={s.searchInput}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          <Pressable style={s.sortBtn} onPress={() => setSortOpen(true)}>
            <FontAwesome5 name="sort-amount-down" size={12} color="#374151" />
            <View style={{ flex: 1 }}>
              <Text style={s.sortLbl}>{t("puspakom.tech.sort")}</Text>
              <Text style={s.sortVal}>{t(`puspakom.tech.sort_${sort}`)}</Text>
            </View>
            <FontAwesome5 name="chevron-down" size={11} color="#6B7280" />
          </Pressable>
        </View>

        {shown.map((i) => {
          const dueIn = daysBetween(today, i.checklist_due);
          const late = dueIn < 0;
          const pillLabel =
            i.pill === "IN_PROGRESS" ? t("puspakom.techPill.IN_PROGRESS", { done: i.done, total: i.total }) : t(`puspakom.techPill.${i.pill}`);
          return (
            <Pressable key={i.inspection_id} onPress={() => open(i)} style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}>
              <View style={s.cardHead}>
                <Text style={s.plate}>
                  {i.bus_id}
                  {!!i.bus_ev_no && <Text style={s.ev}> ({i.bus_ev_no})</Text>}
                </Text>
                <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />
              </View>
              <Pill label={pillLabel} tone={TECH_PILL_TONE[i.pill]} style={{ marginBottom: 10 }} />
              <View style={s.boxes}>
                <View style={s.box}>
                  <Text style={s.boxLbl}>{t("puspakom.inspection")}</Text>
                  <Text style={s.boxVal}>{fmtShortDateTime(i.scheduled_at)}</Text>
                  <Text style={s.boxNote}>{t(`puspakom.type.${i.inspection_type}`)}</Text>
                </View>
                <View style={s.box}>
                  <Text style={s.boxLbl}>{t("puspakom.tech.checklistDue")}</Text>
                  <Text style={s.boxVal}>{fmtDayMonth(i.checklist_due)}</Text>
                  {i.tab === "TODO" && (
                    <Text style={[s.boxNote, (late || dueIn === 0) && s.red]}>
                      {late
                        ? t("puspakom.tech.overdueBy", { count: -dueIn })
                        : dueIn === 0
                          ? t("puspakom.dueToday")
                          : t("puspakom.daysLeft", { count: dueIn })}
                    </Text>
                  )}
                </View>
              </View>
              {i.failed ? (
                <Text style={s.foot}>
                  {t("puspakom.tech.failedLine", { date: fmtDayMonth(i.failed.failed_on) })}{" "}
                  <Text style={{ fontWeight: "800" }}>{i.failed.checks.map((c) => `${c.check_id} ${c.label}`).join(", ")}</Text>
                </Text>
              ) : i.submitted_at ? (
                <Text style={s.foot}>{t("puspakom.tech.submittedBy", { name: i.submitted_by ?? "—", date: fmtDateTime(i.submitted_at) })}</Text>
              ) : (
                <Text style={s.foot}>{t("puspakom.tech.registeredBy", { name: i.registered_by ?? "—", date: fmtDateTime(i.registered_at) })}</Text>
              )}
            </Pressable>
          );
        })}
        {items && shown.length === 0 && <Text style={s.empty}>{t("puspakom.tech.empty")}</Text>}
        <View style={s.note}>
          <FontAwesome5 name="info-circle" size={11} color="#9CA3AF" />
          <Text style={s.noteText}>{t("puspakom.tech.onlyRegistered")}</Text>
        </View>
      </ScrollView>

      <Sheet visible={sortOpen} title={t("puspakom.sort.title")} onClose={() => setSortOpen(false)}>
        {SORTS.map((k) => (
          <Pressable
            key={k}
            style={s.optRow}
            onPress={() => {
              keptSort = k;
              setSortState(k);
              setSortOpen(false);
            }}
          >
            <View style={[s.radio, sort === k && { borderColor: ACCENT }]}>{sort === k && <View style={[s.radioDot, { backgroundColor: ACCENT }]} />}</View>
            <Text style={s.optText}>{t(`puspakom.tech.sort_${k}`)}</Text>
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, paddingBottom: 48, width: "100%", maxWidth: 640, alignSelf: "center" },
  h1: { fontSize: 24, fontWeight: "800", color: "#111827", marginTop: 6 },
  sub: { fontSize: 13, color: "#6B7280", marginTop: 2, marginBottom: 12 },
  offline: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10, marginBottom: 10 },
  offlineText: { flex: 1, fontSize: 12, color: "#92400E" },
  panel: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 12 },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { flex: 1, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, paddingVertical: 9, alignItems: "center" },
  tabText: { fontSize: 14, fontWeight: "800", color: "#374151" },
  tabN: { fontWeight: "600" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F3F4F6", borderRadius: 10, paddingHorizontal: 12, marginTop: 10 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: "#111827" },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 10, marginTop: 8 },
  sortLbl: { fontSize: 10, fontWeight: "800", color: "#6B7280", textTransform: "uppercase" },
  sortVal: { fontSize: 14, fontWeight: "800", color: "#111827" },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 10 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  plate: { fontSize: 17, fontWeight: "800", color: "#111827" },
  ev: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  boxes: { flexDirection: "row", gap: 8 },
  box: { flex: 1, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 10 },
  boxLbl: { fontSize: 10, fontWeight: "800", color: "#6B7280", letterSpacing: 0.4, textTransform: "uppercase" },
  boxVal: { fontSize: 14, fontWeight: "800", color: "#111827", marginTop: 3 },
  boxNote: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  red: { color: "#B91C1C", fontWeight: "700" },
  foot: { fontSize: 12, color: "#4B5563", marginTop: 10 },
  empty: { textAlign: "center", color: "#6B7280", marginVertical: 20 },
  note: { flexDirection: "row", gap: 8, backgroundColor: "#F3F4F6", borderRadius: 12, padding: 12, marginTop: 6 },
  noteText: { flex: 1, fontSize: 12, color: "#6B7280" },
  optRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  optText: { fontSize: 15, fontWeight: "700", color: "#111827" },
});
