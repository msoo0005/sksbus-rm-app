import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, type LowTreadTyre } from "../../../api/client";
import FilterChipRow from "../../FilterChipRow";
import BusTyreListRow from "../BusTyreListRow";
import InspectionDueBadge from "../InspectionDueBadge";
import { useSession } from "../../../ctx";
import { useI18n } from "../../../i18n/i18n-ctx";
import { formatDate } from "../../../utils/datetime";
import { tyreKey } from "../../../utils/tyrePositions";
import type { BusFilter, TyreSectionData } from "../../../hooks/useTyreSectionData";

// The fleet, as a work queue. One row per bus, carrying both signals that start
// work: when it was last inspected, and whether anything on it is past the
// tread limit.
//
// A PANEL, not a screen. It must never fetch on focus — see useTyreSectionData
// for why — so everything it draws arrives as props and it owns only its own
// search text. The filter is owned by the section above, so the attention strip
// can set it.
//
// It is a real FlatList rather than the old sliced ScrollView, which is why the
// "Show all 42 buses" row is gone: that existed to stop an unvirtualised list
// rendering the whole fleet at once, and it charged the user a tap to see rows
// that were already loaded.

type Props = {
  data: TyreSectionData;
  filter: BusFilter;
  onFilterChange: (f: BusFilter) => void;
};

export default function BusesPanel({ data, filter, onFilterChange }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const { dbUser } = useSession();
  // The interval is one fleet-wide setting, so changing it stays with
  // managers; technicians see the same list without the gear.
  const canEditInterval = dbUser?.user_role === "admin" || dbUser?.user_role === "rm_manager";

  const [query, setQuery] = useState("");
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [intervalDraft, setIntervalDraft] = useState(String(data.intervalDays));
  const [savingSettings, setSavingSettings] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.busRows
      .filter((r) => {
        if (filter === "needsChange" && !r.flagged) return false;
        if (filter === "overdue" && !r.due.isOverdue) return false;
        if (!q) return true;
        return (
          String(r.bus.bus_id).toLowerCase().includes(q) ||
          // The number the depot actually uses to name a bus.
          (r.bus.bus_ev_no ?? "").toLowerCase().includes(q) ||
          (r.bus.bus_route ?? "").toLowerCase().includes(q) ||
          (r.bus.bus_route_number ?? "").toLowerCase().includes(q) ||
          (r.bus.bus_model ?? "").toLowerCase().includes(q)
        );
      })
      // A bus with a tyre past the tread limit outranks everything — that is
      // the finding that takes a vehicle off the road. Then never inspected,
      // then longest overdue.
      .sort((a, b) => {
        if (!!a.flagged !== !!b.flagged) return a.flagged ? -1 : 1;
        if (a.due.neverInspected !== b.due.neverInspected) return a.due.neverInspected ? -1 : 1;
        const ra = a.due.remaining ?? Number.NEGATIVE_INFINITY;
        const rb = b.due.remaining ?? Number.NEGATIVE_INFINITY;
        if (ra !== rb) return ra - rb;
        return String(a.bus.bus_id).localeCompare(String(b.bus.bus_id));
      });
  }, [data.busRows, filter, query]);

  const openBus = (busId: string, flagged: LowTreadTyre | null) => {
    // Straight to the wheel that needs changing, when there is one.
    const key = flagged ? tyreKey(flagged) : null;
    router.push(`/tyres/buses/${busId}${key ? `?position=${key}` : ""}` as any);
  };

  const submitSettings = () => {
    const days = Number(intervalDraft);
    if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(days)) {
      Alert.alert(t("common.validation"), "Enter a whole number of days greater than 0.");
      return;
    }
    Alert.alert(
      t("tyres.inspections.intervalTitle"),
      `Buses will be considered overdue after ${days} day${days === 1 ? "" : "s"} since their last tyre inspection. Continue?`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.save"),
          onPress: async () => {
            try {
              setSavingSettings(true);
              await api.updateTyreSettings({ inspection_interval_days: days });
              setSettingsVisible(false);
              await data.refresh();
            } catch (e: any) {
              Alert.alert(t("common.error"), e?.message ?? "Unknown error");
            } finally {
              setSavingSettings(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={s.fill}>
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.bus.bus_id)}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} />
        }
        ListHeaderComponent={
          <>
            <View style={s.headerRow}>
              <Text style={s.subtitle}>
                {data.counts.overdue > 0
                  ? t("tyres.inspections.subtitleDue", {
                      count: data.counts.overdue,
                      days: data.intervalDays,
                    })
                  : t("tyres.inspections.subtitleClear", { days: data.intervalDays })}
              </Text>
              {canEditInterval && (
                <Pressable
                  style={s.iconBtn}
                  onPress={() => {
                    setIntervalDraft(String(data.intervalDays));
                    setSettingsVisible(true);
                  }}
                  hitSlop={8}
                >
                  <FontAwesome5 name="cog" size={15} color="#374151" />
                </Pressable>
              )}
            </View>

            <FilterChipRow<BusFilter>
              value={filter}
              onChange={onFilterChange}
              items={[
                { key: "all", label: t("tyres.inspections.filterAll"), count: data.counts.buses },
                {
                  key: "needsChange",
                  label: t("tyres.inspections.filterNeedsChange"),
                  count: data.counts.needsChange,
                  tone: "danger",
                },
                {
                  key: "overdue",
                  label: t("tyres.inspections.filterOverdue"),
                  count: data.counts.overdue,
                  tone: "warn",
                },
              ]}
            />

            <View style={s.searchWrap}>
              <FontAwesome5 name="search" size={12} color="#9CA3AF" style={{ marginRight: 8 }} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("tyres.inspections.searchBuses")}
                placeholderTextColor="#9CA3AF"
                style={s.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
          </>
        }
        renderItem={({ item: r }) => (
          <View style={s.rowWrap}>
            <BusTyreListRow
              bus={r.bus}
              meta={[
                t("tyres.inspections.lastInspected", {
                  when: r.lastInspectedAt
                    ? formatDate(r.lastInspectedAt)
                    : t("tyres.inspections.never"),
                }),
                t("tyres.replacements.fitted", { count: r.fitted }),
              ].join(" · ")}
              right={
                <View style={s.rowRight}>
                  {!!r.flagged && (
                    <View style={s.flagPill}>
                      <Text style={s.flagPillText}>{t("tyres.replacements.needsChange")}</Text>
                    </View>
                  )}
                  <InspectionDueBadge state={r.due} />
                </View>
              }
              onPress={() => openBus(String(r.bus.bus_id), r.flagged)}
            />
          </View>
        )}
        ListEmptyComponent={
          data.loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} />
          ) : (
            <Text style={s.empty}>{t("tyres.inspections.noBuses")}</Text>
          )
        }
      />

      <Modal
        visible={settingsVisible}
        animationType="fade"
        transparent
        onRequestClose={() => !savingSettings && setSettingsVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>{t("tyres.inspections.intervalTitle")}</Text>
            <Text style={s.modalHelp}>{t("tyres.inspections.intervalHelp")}</Text>
            <TextInput
              style={s.input}
              value={intervalDraft}
              onChangeText={setIntervalDraft}
              keyboardType="number-pad"
              placeholder="30"
              editable={!savingSettings}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable
                style={[s.cancelBtn, { flex: 1 }]}
                onPress={() => setSettingsVisible(false)}
                disabled={savingSettings}
              >
                <Text style={s.cancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[s.saveBtn, { flex: 1 }, savingSettings && { opacity: 0.6 }]}
                onPress={submitSettings}
                disabled={savingSettings}
              >
                {savingSettings ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.saveText}>{t("common.save")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  subtitle: { flex: 1, fontSize: 13, fontWeight: "700", color: "#374151" },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  searchInput: { flex: 1, fontSize: 14, color: "#111827", padding: 0 },
  rowWrap: {
    marginHorizontal: 16,
    backgroundColor: "#fff",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
  },
  rowRight: { alignItems: "flex-end", gap: 6 },
  flagPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "#FFFBEB" },
  flagPillText: { fontSize: 10, fontWeight: "800", color: "#B45309" },
  empty: { textAlign: "center", paddingVertical: 20, color: "#9CA3AF", fontWeight: "600", fontSize: 12 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalSheet: { width: "100%", backgroundColor: "#fff", borderRadius: 18, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: "800", color: "#111827" },
  modalHelp: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 4, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  cancelBtn: { paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: "#F3F4F6" },
  cancelText: { fontWeight: "700", color: "#374151" },
  saveBtn: { paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: "#111827" },
  saveText: { fontWeight: "800", color: "#fff" },
});
