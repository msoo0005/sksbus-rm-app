import { Clock } from "lucide-react-native";
import React from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { formatElapsed, useElapsedMs } from "../utils/elapsedTime";

// C2 (v2.0.0): the same orange pill at any age; no colour bands.
const ORANGE = { fg: "#C2410C", bg: "#FFF7ED", border: "#FED7AA" };

type Props = {
  since?: string | null;
  // When set, freezes the readout at (until - since) instead of ticking
  // live — pass the resolution time for a closed/declined report.
  until?: string | null;
  style?: StyleProp<ViewStyle>;
};

// Elapsed-time badge: live "hh:mm:ss" (then "1d 0h 42m") since `since`, or a
// frozen duration once `until` is provided.
export default function ElapsedTimer({ since, until, style }: Props) {
  const elapsedMs = useElapsedMs(since, until);
  if (elapsedMs == null) return null;

  const color = ORANGE;

  return (
    <View style={[styles.pill, { backgroundColor: color.bg, borderColor: color.border }, style]}>
      <Clock size={12} color={color.fg} />
      <Text style={[styles.text, { color: color.fg }]} numberOfLines={1}>
        {formatElapsed(elapsedMs)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  text: {
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
