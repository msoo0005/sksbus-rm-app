import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";

// A red count bubble for work still outstanding (pending / open reports).
// Unlike the notification bell's unread count it can't be dismissed: it is
// derived from the live count and stays until that count reaches 0.
export default function AlertBubble({
  count,
  size = 22,
  style,
}: {
  count: number;
  size?: number;
  style?: ViewStyle;
}) {
  if (!count || count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <View
      style={[
        s.bubble,
        { minWidth: size, height: size, borderRadius: size / 2, paddingHorizontal: size * 0.28 },
        style,
      ]}
    >
      <Text style={[s.text, { fontSize: Math.round(size * 0.55) }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  bubble: {
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  text: { color: "#FFFFFF", fontWeight: "800", fontVariant: ["tabular-nums"] },
});
