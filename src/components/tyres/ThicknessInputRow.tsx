import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

type Props = {
  values: string[];
  onChange: (next: string[]) => void;
  editable?: boolean;
  placeholder?: string;
  // Small "G1 G2 …" labels under the cells, for a tyre that is on no bus yet
  // (so its readings can't be described as outer/inner edges).
  showGrooveLabels?: boolean;
};

/**
 * One thickness cell per groove (3 or 4). Shared by Tyre Replacement and the
 * Add Tyre form, so both take readings the same way.
 */
export default function ThicknessInputRow({ values, onChange, editable = true, placeholder = "mm", showGrooveLabels }: Props) {
  const set = (i: number, v: string) => {
    const next = [...values];
    next[i] = v.replace(/,/g, ".");
    onChange(next);
  };
  return (
    <View>
      <View style={s.row}>
        {values.map((v, i) => (
          <TextInput
            key={i}
            value={v}
            onChangeText={(t) => set(i, t)}
            placeholder={placeholder}
            placeholderTextColor="#9CA3AF"
            keyboardType="decimal-pad"
            style={s.input}
            editable={editable}
          />
        ))}
      </View>
      {showGrooveLabels && (
        <View style={s.row}>
          {values.map((_, i) => (
            <Text key={i} style={s.label}>{`G${i + 1}`}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

/** Cells as numbers, or null if any is empty, not a number, below 0 or above maxMm. */
export function parseThicknessCells(values: string[], maxMm = 30): number[] | null {
  const nums = values.map((v) => (v.trim() === "" ? NaN : Number(v.trim())));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > maxMm)) return null;
  return nums;
}

export const emptyThicknessCells = (count: number) => Array.from({ length: count }, () => "");

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: 10,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  label: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", color: "#9CA3AF", marginTop: 4 },
});
