import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { LowTreadTyre, OverdueBus, Tyre } from "../../api/client";
import { api } from "../../api/client";
import SegmentedTabs from "../../components/SegmentedTabs";

type Tab = "byBus" | "spares";

type BusRow = { bus_id: string; bus_route?: string | null; bus_model?: string | null };

const EMPTY_FORM = {
  tyre_serial_number: "",
  tyre_brand: "",
  tyre_model: "",
  tyre_retread_count: "0",
  tyre_bought_date: "",
};

export default function TyreManagementScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("byBus");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tyres, setTyres] = useState<Tyre[]>([]);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [overdue, setOverdue] = useState<OverdueBus[]>([]);
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const [lowTread, setLowTread] = useState<LowTreadTyre[]>([]);
  const [lowTreadExpanded, setLowTreadExpanded] = useState(false);

  const [query, setQuery] = useState("");

  const [addVisible, setAddVisible] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [intervalDays, setIntervalDays] = useState("30");
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async (opts?: { refreshing?: boolean }) => {
    try {
      if (opts?.refreshing) setRefreshing(true);
      else setLoading(true);

      const [tyreRows, busRows, overdueRes, lowTreadRes] = await Promise.all([
        api.listTyres(),
        api.buses(),
        api.getOverdueTyreInspections().catch(() => null),
        api.getLowTreadTyres().catch(() => null),
      ]);

      setTyres(Array.isArray(tyreRows) ? tyreRows : []);
      setBuses(Array.isArray(busRows) ? busRows : []);
      if (overdueRes) {
        setOverdue(overdueRes.overdue_buses ?? []);
        setIntervalDays(String(overdueRes.inspection_interval_days ?? 30));
      }
      setLowTread(lowTreadRes?.low_tread_tyres ?? []);
    } catch (e: any) {
      Alert.alert("Failed to load", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const busesWithCounts = useMemo(() => {
    const countByBus = new Map<string, number>();
    for (const t of tyres) {
      if (t.current_bus_id) {
        countByBus.set(t.current_bus_id, (countByBus.get(t.current_bus_id) ?? 0) + 1);
      }
    }
    return buses
      .map((b) => ({ ...b, tyreCount: countByBus.get(String(b.bus_id)) ?? 0 }))
      .filter((b) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return (
          String(b.bus_id).toLowerCase().includes(q) ||
          (b.bus_route ?? "").toLowerCase().includes(q) ||
          (b.bus_model ?? "").toLowerCase().includes(q)
        );
      });
  }, [buses, tyres, query]);

  const lowTreadIds = useMemo(() => new Set(lowTread.map((t) => t.tyre_id)), [lowTread]);

  const spareTyres = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tyres
      .filter((t) => t.tyre_status === "spare")
      .filter((t) => {
        if (!q) return true;
        return (
          t.tyre_serial_number.toLowerCase().includes(q) ||
          (t.tyre_brand ?? "").toLowerCase().includes(q) ||
          (t.tyre_model ?? "").toLowerCase().includes(q)
        );
      });
  }, [tyres, query]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setAddVisible(true);
  };

  const submitAdd = async () => {
    if (!form.tyre_serial_number.trim()) {
      Alert.alert("Validation", "Serial number is required.");
      return;
    }
    const retreadCount = Number(form.tyre_retread_count);
    if (!Number.isFinite(retreadCount) || retreadCount < 0 || !Number.isInteger(retreadCount)) {
      Alert.alert("Validation", "Retread count must be a whole number 0 or greater.");
      return;
    }
    try {
      setSubmitting(true);
      await api.createTyre({
        tyre_serial_number: form.tyre_serial_number.trim(),
        tyre_brand: form.tyre_brand.trim() || undefined,
        tyre_model: form.tyre_model.trim() || undefined,
        tyre_retread_count: retreadCount,
        tyre_bought_date: form.tyre_bought_date.trim() || undefined,
      });
      setAddVisible(false);
      await load();
    } catch (e: any) {
      Alert.alert("Failed to add tyre", e?.message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const submitSettings = async () => {
    const days = Number(intervalDays);
    if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(days)) {
      Alert.alert("Validation", "Enter a whole number of days greater than 0.");
      return;
    }
    Alert.alert(
      "Update inspection interval",
      `Buses will be considered overdue after ${days} day${days === 1 ? "" : "s"} since their last tyre inspection. Continue?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async () => {
            try {
              setSavingSettings(true);
              await api.updateTyreSettings({ inspection_interval_days: days });
              setSettingsVisible(false);
              await load();
            } catch (e: any) {
              Alert.alert("Failed to save", e?.message ?? "Unknown error");
            } finally {
              setSavingSettings(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.page}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refreshing: true })} />}
      >
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>Tyre Management</Text>
          <Pressable style={styles.settingsBtn} onPress={() => setSettingsVisible(true)} hitSlop={8}>
            <FontAwesome5 name="cog" size={16} color="#374151" />
          </Pressable>
        </View>

        {overdue.length > 0 && (
          <Pressable
            style={styles.overdueBanner}
            onPress={() => setOverdueExpanded((v) => !v)}
          >
            <View style={styles.overdueHeaderRow}>
              <FontAwesome5 name="exclamation-triangle" size={15} color="#DC2626" />
              <Text style={styles.overdueTitle}>
                {overdue.length} bus{overdue.length === 1 ? "" : "es"} overdue for tyre inspection
              </Text>
              <FontAwesome5 name={overdueExpanded ? "chevron-up" : "chevron-down"} size={12} color="#DC2626" />
            </View>
            {overdueExpanded && (
              <View style={{ marginTop: 10, gap: 8 }}>
                {overdue.map((b) => (
                  <Pressable
                    key={b.bus_id}
                    style={styles.overdueRow}
                    onPress={() => router.push(`/rm-manager/tyres/${b.bus_id}` as any)}
                  >
                    <Text style={styles.overdueBus}>{b.bus_id}</Text>
                    <Text style={styles.overdueDays}>
                      {b.days_since_inspection == null
                        ? "Never inspected"
                        : `${b.days_since_inspection} days ago`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Pressable>
        )}

        {lowTread.length > 0 && (
          <Pressable
            style={styles.lowTreadBanner}
            onPress={() => setLowTreadExpanded((v) => !v)}
          >
            <View style={styles.overdueHeaderRow}>
              <FontAwesome5 name="exclamation-triangle" size={15} color="#B45309" />
              <Text style={styles.lowTreadTitle}>
                {lowTread.length} tyre{lowTread.length === 1 ? "" : "s"} below {"5mm"} tread depth
              </Text>
              <FontAwesome5 name={lowTreadExpanded ? "chevron-up" : "chevron-down"} size={12} color="#B45309" />
            </View>
            {lowTreadExpanded && (
              <View style={{ marginTop: 10, gap: 8 }}>
                {lowTread.map((t) => (
                  <Pressable
                    key={t.tyre_id}
                    style={styles.overdueRow}
                    disabled={!t.current_bus_id}
                    onPress={() => t.current_bus_id && router.push(`/rm-manager/tyres/${t.current_bus_id}` as any)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.overdueBus}>{t.tyre_serial_number}</Text>
                      <Text style={styles.busMeta}>
                        {[t.tyre_brand, t.tyre_model].filter(Boolean).join(" · ") || "No details"}
                        {t.current_bus_id ? ` · Bus ${t.current_bus_id}` : " · Spare"}
                      </Text>
                    </View>
                    <Text style={styles.lowTreadValue}>{t.min_tread_mm}mm</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Pressable>
        )}

        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "byBus", label: "By Bus" },
            { key: "spares", label: `Spares (${spareTyres.length})` },
          ]}
        />

        <View style={styles.searchWrap}>
          <FontAwesome5 name="search" size={13} color="#9CA3AF" style={{ marginRight: 8 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tab === "byBus" ? "Search buses…" : "Search tyres…"}
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : tab === "byBus" ? (
          busesWithCounts.length === 0 ? (
            <Text style={styles.emptyText}>No buses found.</Text>
          ) : (
            <View style={styles.listContent}>
              {busesWithCounts.map((b) => (
                <Pressable
                  key={String(b.bus_id)}
                  style={styles.busRow}
                  onPress={() => router.push(`/rm-manager/tyres/${b.bus_id}` as any)}
                >
                  <View style={styles.busIconWrap}>
                    <FontAwesome5 name="bus" size={16} color="#111827" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.busTitle}>{b.bus_id}</Text>
                    <Text style={styles.busMeta}>
                      {[b.bus_route, b.bus_model].filter(Boolean).join(" · ") || "No details"}
                    </Text>
                  </View>
                  <View style={styles.tyreCountPill}>
                    <Text style={styles.tyreCountText}>{b.tyreCount} tyres</Text>
                  </View>
                  <FontAwesome5 name="chevron-right" size={13} color="#9CA3AF" />
                </Pressable>
              ))}
            </View>
          )
        ) : spareTyres.length === 0 ? (
          <Text style={styles.emptyText}>No spare tyres.</Text>
        ) : (
          <View style={styles.listContent}>
            {spareTyres.map((t) => (
              <View key={t.tyre_id} style={styles.tyreRow}>
                <View style={styles.tyreIconWrap}>
                  <FontAwesome5 name="dot-circle" size={16} color="#6B7280" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.busTitle}>{t.tyre_serial_number}</Text>
                  <Text style={styles.busMeta}>
                    {[t.tyre_brand, t.tyre_model].filter(Boolean).join(" · ") || "No details"}
                    {t.tyre_retread_count > 0 ? ` · Retread ×${t.tyre_retread_count}` : ""}
                  </Text>
                </View>
                {lowTreadIds.has(t.tyre_id) && (
                  <View style={styles.lowTreadBadge}>
                    <FontAwesome5 name="exclamation-triangle" size={10} color="#B45309" />
                    <Text style={styles.lowTreadBadgeText}>Low tread</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <Pressable style={styles.fab} onPress={openAdd}>
        <FontAwesome5 name="plus" size={16} color="#fff" />
        <Text style={styles.fabText}>Add Tyre</Text>
      </Pressable>

      {/* Add Tyre modal */}
      <Modal visible={addVisible} animationType="slide" transparent onRequestClose={() => !submitting && setAddVisible(false)}>
        <KeyboardAvoidingView style={styles.modalKeyboardView} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add New Tyre</Text>
                <Pressable onPress={() => !submitting && setAddVisible(false)} style={{ padding: 4 }}>
                  <FontAwesome5 name="times" size={16} color="#6B7280" />
                </Pressable>
              </View>

              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>
                  Serial Number <Text style={{ color: "#EF4444" }}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  value={form.tyre_serial_number}
                  onChangeText={(v) => setForm((f) => ({ ...f, tyre_serial_number: v }))}
                  placeholder="e.g. DL-8842019"
                  placeholderTextColor="#9CA3AF"
                  editable={!submitting}
                />

                <Text style={styles.label}>Brand</Text>
                <TextInput
                  style={styles.input}
                  value={form.tyre_brand}
                  onChangeText={(v) => setForm((f) => ({ ...f, tyre_brand: v }))}
                  placeholder="e.g. Michelin"
                  placeholderTextColor="#9CA3AF"
                  editable={!submitting}
                />

                <Text style={styles.label}>Model</Text>
                <TextInput
                  style={styles.input}
                  value={form.tyre_model}
                  onChangeText={(v) => setForm((f) => ({ ...f, tyre_model: v }))}
                  placeholder="e.g. X Multi D"
                  placeholderTextColor="#9CA3AF"
                  editable={!submitting}
                />

                <Text style={styles.label}>Bought Date (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.input}
                  value={form.tyre_bought_date}
                  onChangeText={(v) => setForm((f) => ({ ...f, tyre_bought_date: v }))}
                  placeholder="2026-01-15"
                  placeholderTextColor="#9CA3AF"
                  editable={!submitting}
                />

                <Text style={styles.label}>Retread Count</Text>
                <Text style={[styles.busMeta, { marginBottom: 6 }]}>
                  0 = new tyre, 1 = retreaded once, 2 = retreaded twice, etc.
                </Text>
                <View style={styles.stepperRow}>
                  <Pressable
                    style={styles.stepperBtn}
                    disabled={submitting}
                    onPress={() =>
                      setForm((f) => ({
                        ...f,
                        tyre_retread_count: String(Math.max(0, (Number(f.tyre_retread_count) || 0) - 1)),
                      }))
                    }
                  >
                    <FontAwesome5 name="minus" size={12} color="#374151" />
                  </Pressable>
                  <TextInput
                    style={styles.stepperInput}
                    value={form.tyre_retread_count}
                    onChangeText={(v) => setForm((f) => ({ ...f, tyre_retread_count: v }))}
                    keyboardType="number-pad"
                    editable={!submitting}
                  />
                  <Pressable
                    style={styles.stepperBtn}
                    disabled={submitting}
                    onPress={() =>
                      setForm((f) => ({
                        ...f,
                        tyre_retread_count: String((Number(f.tyre_retread_count) || 0) + 1),
                      }))
                    }
                  >
                    <FontAwesome5 name="plus" size={12} color="#374151" />
                  </Pressable>
                </View>

                <Pressable
                  style={[styles.submitButton, submitting && { opacity: 0.6 }]}
                  onPress={submitAdd}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.submitButtonText}>Add Tyre</Text>
                  )}
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Settings modal */}
      <Modal visible={settingsVisible} animationType="fade" transparent onRequestClose={() => !savingSettings && setSettingsVisible(false)}>
        <View style={styles.settingsOverlay}>
          <View style={styles.settingsSheet}>
            <Text style={styles.modalTitle}>Inspection Interval</Text>
            <Text style={[styles.busMeta, { marginTop: 4, marginBottom: 14 }]}>
              Buses are flagged overdue after this many days since their last tyre inspection.
            </Text>
            <TextInput
              style={styles.input}
              value={intervalDays}
              onChangeText={setIntervalDays}
              keyboardType="number-pad"
              placeholder="30"
              editable={!savingSettings}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable
                style={[styles.cancelButton, { flex: 1 }]}
                onPress={() => setSettingsVisible(false)}
                disabled={savingSettings}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.submitButton, { flex: 1, marginTop: 0 }, savingSettings && { opacity: 0.6 }]}
                onPress={submitSettings}
                disabled={savingSettings}
              >
                {savingSettings ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  pageTitle: { fontSize: 20, fontWeight: "800", color: "#111827" },
  settingsBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },

  overdueBanner: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  overdueHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  overdueTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: "#991B1B" },
  overdueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  overdueBus: { fontSize: 14, fontWeight: "700", color: "#111827" },
  overdueDays: { fontSize: 12, fontWeight: "600", color: "#DC2626" },

  lowTreadBanner: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  lowTreadTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: "#92400E" },
  lowTreadValue: { fontSize: 13, fontWeight: "800", color: "#B45309" },
  lowTreadBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lowTreadBadgeText: { fontSize: 10, fontWeight: "700", color: "#B45309" },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },

  center: { paddingTop: 40, alignItems: "center" },
  emptyText: { textAlign: "center", marginTop: 32, color: "#9CA3AF", fontWeight: "600" },

  listContent: { padding: 16, gap: 10 },
  busRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
  },
  busIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  busTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  busMeta: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 2 },
  tyreCountPill: {
    backgroundColor: "#F3F4F6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tyreCountText: { fontSize: 12, fontWeight: "700", color: "#374151" },

  tyreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
  },
  tyreIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },

  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#111827",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  modalKeyboardView: { flex: 1, justifyContent: "flex-end" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    maxHeight: "90%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },

  label: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingVertical: 11,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },

  submitButton: {
    marginTop: 20,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitButtonText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cancelButtonText: { color: "#374151", fontWeight: "700", fontSize: 15 },

  settingsOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  settingsSheet: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
  },
});
