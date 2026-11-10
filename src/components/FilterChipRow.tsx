import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

// A one-line, horizontally scrolling row of counted filter pills.
//
// Replaces the hand-rolled wrapping chip blocks that used to sit on the two
// tyre lists (5 chips and 6 chips), both of which wrapped to two lines on a
// phone and pushed the list itself below the fold. Scrolling sideways keeps the
// row one line tall however many options it holds.
//
// Counts belong in the label rather than in a separate badge: it is the same
// "{label} ({n})" shape the jobs and inventory tabs already use, and it turns
// the filter row into an at-a-glance status summary rather than just a control.
//
// Deliberately NOT SegmentedTabs. That component gives every option flex: 1, so
// counted labels truncate once there are more than about three, and the tyre
// section now uses SegmentedTabs one row above this for the section itself —
// nesting the same control inside itself reads as one control with seven
// options rather than two controls.

export type FilterChip<K extends string> = {
  key: K;
  label: string;
  /** Omitted rather than 0 when a count would be meaningless. */
  count?: number;
  /** Draws attention to a filter that has found something wrong. */
  tone?: "danger" | "warn";
};

type Props<K extends string> = {
  items: FilterChip<K>[];
  value: K;
  onChange: (key: K) => void;
};

export default function FilterChipRow<K extends string>({ items, value, onChange }: Props<K>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      {items.map((item) => {
        const active = item.key === value;
        // A tone only colours the chip while it is INACTIVE. Once selected the
        // chip goes solid dark like every other, so "which filter am I on" is
        // never ambiguous.
        const toned = !active && !!item.count && item.tone;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[
              s.chip,
              toned === "danger" && s.chipDanger,
              toned === "warn" && s.chipWarn,
              active && s.chipActive,
            ]}
          >
            <Text
              style={[
                s.text,
                toned === "danger" && s.textDanger,
                toned === "warn" && s.textWarn,
                active && s.textActive,
              ]}
            >
              {item.label}
              {item.count != null ? ` (${item.count})` : ""}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: "#111827", borderColor: "#111827" },
  chipDanger: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  chipWarn: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  text: { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  textActive: { color: "#fff" },
  textDanger: { color: "#DC2626" },
  textWarn: { color: "#B45309" },
});
