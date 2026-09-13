import { Clock } from "lucide-react-native";
import React from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { formatElapsed, useElapsedMs } from "../utils/elapsedTime";

const HOUR = 3_600_000;

// Urgency bands for how long a report has been open — same palette used
// elsewhere for type/severity chips (JobDetailsModal's TYPE_CONFIG etc).
const COLOR_STOPS: { maxMs: number; fg: string; bg: string; border: string }[] = [
  { maxMs: 4 * HOUR, fg: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0" },
  { maxMs: 24 * HOUR, fg: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  { maxMs: 72 * HOUR, fg: "#EA580C", bg: "#FFF7ED", border: "#FED7AA" },
  { maxMs: Infinity, fg: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
];

function colorFor(ms: number) {
  return COLOR_STOPS.find((stop) => ms < stop.maxMs) ?? COLOR_STOPS[COLOR_STOPS.length - 1];
}

type Props = {
  since?: string | null;
  // When set, freezes the readout at (until - since) instead of ticking
  // live — pass the resolution time for a closed/declined report.
  until?: string | null;
  style?: StyleProp<ViewStyle>;
};

// Elapsed-time badge: live-ticking HH:MM:SS since `since`, colored by how
// long that's been, or a frozen duration once `until` is provided.
export default function ElapsedTimer({ since, until, style }: Props) {
  const elapsedMs = useElapsedMs(since, until);
  if (elapsedMs == null) return null;

  const color = colorFor(elapsedMs);

  return (
    <View style={[styles.pill, { backgroundColor: color.bg, borderColor: color.border }, style]}>
      <Clock size={12} color={color.fg} />
      <Text style={[styles.text, { color: color.fg }]}>{formatElapsed(elapsedMs)}</Text>
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
