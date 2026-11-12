import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useI18n } from "../i18n/i18n-ctx";
import { nextSort } from "../utils/reportSort";

type Props<K extends string> = {
  value: { key: K; reversed: boolean };
  onChange: (next: { key: K; reversed: boolean }) => void;
  // Defaults to the report-list keys (criticality, time, bus).
  keys?: K[];
  // Labels for keys other than the report-list ones (e.g. the By bus list).
  labels?: Partial<Record<K, string>>;
};

/**
 * "Sort by  [Criticality ↓] [Time] [Bus]". Tapping the active chip again
 * reverses its order; the arrow shows which way it runs.
 */
export default function SortChips<K extends string>({
  value,
  onChange,
  keys = ["criticality", "time", "bus"] as K[],
  labels,
}: Props<K>) {
  const { t } = useI18n();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
      <FontAwesome5 name="sort-amount-down" size={12} color="#6B7280" />
      <Text style={s.label}>{t("sort.sortBy")}</Text>
      {keys.map((k) => {
        const active = value.key === k;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(nextSort(value, k))}
            style={({ pressed }) => [s.chip, active && s.chipActive, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[s.chipText, active && s.chipTextActive]}>{labels?.[k] ?? t(`sort.${k}`)}</Text>
            {active && (
              <FontAwesome5 name={value.reversed ? "arrow-up" : "arrow-down"} size={10} color="#fff" />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  label: { fontSize: 13, fontWeight: "600", color: "#6B7280", marginRight: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: "#111827", borderColor: "#111827" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#111827" },
  chipTextActive: { color: "#fff" },
});
