import { FontAwesome5 } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n/i18n-ctx";
import { BUS_SYSTEM_KEYS, busSystemNo, normaliseBusSystem, type BusSystemKey } from "../utils/busSystems";

type Props = {
  value: string | null;
  onChange: (key: BusSystemKey) => void;
  disabled?: boolean;
  onLockedPress?: () => void;
  accent?: string;
};

/**
 * "Category (bus system) *": a field with the category's number badge and
 * name, opening a searchable list of all 29. Each row shows the components the
 * category covers, and the search matches those too, so typing "VCU" finds
 * 13 Low-Voltage Electrical & Control System.
 */
export default function BusSystemPicker({ value, onChange, disabled, onLockedPress, accent = "#C4501A" }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const key = normaliseBusSystem(value);
  const no = busSystemNo(key);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return BUS_SYSTEM_KEYS.map((k, i) => ({
      key: k,
      no: i + 1,
      name: t(`busSystems.${k}`),
      desc: t(`busSystems.${k}_desc`),
    })).filter(
      (r) =>
        !needle ||
        String(r.no) === needle ||
        r.name.toLowerCase().includes(needle) ||
        r.desc.toLowerCase().includes(needle),
    );
  }, [q, t]);

  return (
    <>
      <Pressable
        onPress={() => (onLockedPress ? onLockedPress() : setOpen(true))}
        disabled={disabled}
        style={({ pressed }) => [s.field, pressed && { opacity: 0.8 }, disabled && { opacity: 0.6 }]}
      >
        <View style={[s.badge, { backgroundColor: key ? `${accent}1A` : "#F3F4F6" }]}>
          <Text style={[s.badgeText, { color: key ? accent : "#9CA3AF" }]}>{no ?? "#"}</Text>
        </View>
        <Text style={[s.fieldText, !key && s.placeholder]} numberOfLines={2}>
          {key ? t(`busSystems.${key}`) : t("busSystems.choose")}
        </Text>
        <FontAwesome5 name="chevron-down" size={12} color="#6B7280" />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[s.sheet, { paddingTop: insets.top + 12 }]}>
          <View style={s.head}>
            <Text style={s.title}>{t("busSystems.pickerTitle")}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={10} style={s.close}>
              <FontAwesome5 name="times" size={15} color="#374151" />
            </Pressable>
          </View>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t("busSystems.search")}
            placeholderTextColor="#9CA3AF"
            style={s.search}
            autoCorrect={false}
          />
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ListEmptyComponent={<Text style={s.empty}>{t("busSystems.noMatch")}</Text>}
            renderItem={({ item }) => {
              const active = item.key === key;
              return (
                <Pressable
                  style={({ pressed }) => [s.row, active && { backgroundColor: `${accent}12` }, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    onChange(item.key);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <View style={[s.badge, { backgroundColor: `${accent}1A` }]}>
                    <Text style={[s.badgeText, { color: accent }]}>{item.no}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{item.name}</Text>
                    <Text style={s.rowDesc} numberOfLines={3}>
                      {item.desc}
                    </Text>
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
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: "#fff",
  },
  badge: { minWidth: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { fontSize: 14, fontWeight: "800" },
  fieldText: { flex: 1, fontSize: 15, fontWeight: "800", color: "#111827" },
  placeholder: { color: "#9CA3AF", fontWeight: "500" },
  sheet: { flex: 1, backgroundColor: "#fff", paddingHorizontal: 16 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
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
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    borderRadius: 8,
  },
  rowTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  rowDesc: { fontSize: 12, color: "#6B7280", marginTop: 3, lineHeight: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 24 },
});
