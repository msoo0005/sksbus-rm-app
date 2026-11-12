import { FontAwesome5 } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Bus } from "../api/client";
import { useBusDirectory } from "../hooks/useBusDirectory";
import { useI18n } from "../i18n/i18n-ctx";
import { formatBusLabel } from "../utils/busLabel";

type Props = {
  value: string | null;
  onChange: (busId: string, bus: Bus) => void;
  disabled?: boolean;
  accent?: string;
};

/**
 * "Select bus *": a field that opens a searchable list of the project's buses,
 * each named plate (EV no.) with its route underneath. Search matches plate,
 * EV number and route.
 */
export default function BusPickerField({ value, onChange, disabled, accent = "#4338CA" }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { buses, byId, loading } = useBusDirectory();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = value ? byId.get(String(value)) : undefined;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...buses].sort((a, b) => String(a.bus_id).localeCompare(String(b.bus_id)));
    if (!needle) return sorted;
    return sorted.filter((b) =>
      [b.bus_id, b.bus_ev_no, b.bus_route_number, b.bus_route].some((x) =>
        String(x ?? "").toLowerCase().includes(needle),
      ),
    );
  }, [buses, q]);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        style={({ pressed }) => [s.field, { borderColor: value ? accent : "#D1D5DB" }, pressed && { opacity: 0.8 }]}
      >
        <View style={[s.fieldIcon, { backgroundColor: `${accent}14` }]}>
          <FontAwesome5 name="bus" size={13} color={accent} />
        </View>
        <Text style={[s.fieldText, !value && s.placeholder]} numberOfLines={1}>
          {value
            ? formatBusLabel(value, selected?.bus_ev_no)
            : loading
              ? t("reportForm.vehiclePlaceholderLoadingVehicles")
              : t("reportForm.vehiclePlaceholderSelectVehicle")}
        </Text>
        <FontAwesome5 name="chevron-down" size={12} color="#6B7280" />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[s.sheet, { paddingTop: insets.top + 12 }]}>
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{t("jobOrder.selectBus")}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={10} style={s.close}>
              <FontAwesome5 name="times" size={15} color="#374151" />
            </Pressable>
          </View>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t("reportForm.searchVehiclesPlaceholder")}
            placeholderTextColor="#9CA3AF"
            style={s.search}
            autoCorrect={false}
            autoCapitalize="characters"
          />
          <FlatList
            data={list}
            keyExtractor={(b) => String(b.bus_id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ListEmptyComponent={
              <Text style={s.empty}>{loading ? t("common.loading") : t("reportForm.noVehiclesFound")}</Text>
            }
            renderItem={({ item }) => {
              const active = String(item.bus_id) === String(value);
              return (
                <Pressable
                  style={({ pressed }) => [s.row, active && { backgroundColor: `${accent}12` }, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    onChange(String(item.bus_id), item);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{formatBusLabel(item.bus_id, item.bus_ev_no)}</Text>
                    {!!(item.bus_route_number || item.bus_route) && (
                      <Text style={s.rowMeta} numberOfLines={1}>
                        {[item.bus_route_number, item.bus_route].filter(Boolean).join(" · ")}
                      </Text>
                    )}
                  </View>
                  {active && <FontAwesome5 name="check" size={14} color={accent} />}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  fieldIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  fieldText: { flex: 1, fontSize: 17, fontWeight: "800", color: "#111827" },
  placeholder: { color: "#9CA3AF", fontWeight: "500", fontSize: 15 },
  sheet: { flex: 1, backgroundColor: "#fff", paddingHorizontal: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: "#111827" },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  search: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    borderRadius: 8,
  },
  rowTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  rowMeta: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 24 },
});
