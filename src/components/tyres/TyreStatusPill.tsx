import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { TyreStatus } from "../../api/client";
import { TYRE_STATUS_STYLE } from "../../utils/tyreFormat";

export default function TyreStatusPill({ status }: { status: TyreStatus }) {
  const style = TYRE_STATUS_STYLE[status] ?? TYRE_STATUS_STYLE.retired;
  return (
    <View style={[s.pill, { backgroundColor: style.bg }]}>
      <Text style={[s.text, { color: style.color }]}>{style.label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  text: { fontSize: 10, fontWeight: "800" },
});
