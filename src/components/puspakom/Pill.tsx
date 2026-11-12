import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";

export type PillTone = { bg: string; fg: string; border: string };

/** The rounded status pill used on every PUSPAKOM card and header. */
export default function Pill({ label, tone, style, small }: { label: string; tone: PillTone; style?: ViewStyle; small?: boolean }) {
  return (
    <View style={[s.pill, small && s.small, { backgroundColor: tone.bg, borderColor: tone.border }, style]}>
      <Text style={[s.text, small && s.smallText, { color: tone.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  small: { paddingHorizontal: 7, paddingVertical: 2 },
  text: { fontSize: 12, fontWeight: "700" },
  smallText: { fontSize: 11 },
});
