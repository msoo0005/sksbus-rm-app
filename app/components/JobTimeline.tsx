import { FontAwesome5 } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

export type TimelineEvent = {
  id: string;
  icon: string;
  color: string;
  colorLight: string;
  title: string;
  subtitle?: string | null;
  // Who performed this event, rendered as its own "by NAME" line — kept
  // separate from `subtitle` since subtitle is also used for unrelated
  // event details (e.g. a task's description, the odometer reading).
  by?: string | null;
  at: string;
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function JobTimeline({ events }: { events: TimelineEvent[] }) {
  const sorted = useMemo(
    () =>
      events
        .filter((e) => !!e.at)
        .slice()
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [events],
  );

  if (sorted.length === 0) {
    return <Text style={s.mutedText}>No activity recorded yet.</Text>;
  }

  return (
    <View>
      {sorted.map((e, idx) => (
        <View key={e.id} style={s.row}>
          <View style={s.iconCol}>
            <View style={[s.iconBox, { backgroundColor: e.colorLight }]}>
              <FontAwesome5 name={e.icon as any} size={11} color={e.color} />
            </View>
            {idx < sorted.length - 1 && <View style={s.line} />}
          </View>
          <View
            style={[
              s.body,
              idx === sorted.length - 1 && { paddingBottom: 0 },
            ]}
          >
            <Text style={s.title}>{e.title}</Text>
            {!!e.subtitle && <Text style={s.subtitle}>{e.subtitle}</Text>}
            {!!e.by && <Text style={s.by}>by {e.by}</Text>}
            <Text style={s.time}>{formatDateTime(e.at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  mutedText: { fontSize: 14, color: "#9CA3AF", fontWeight: "500" },
  row: { flexDirection: "row" },
  iconCol: { alignItems: "center", width: 32 },
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
  },
  body: { flex: 1, paddingBottom: 18, paddingLeft: 10 },
  title: { fontSize: 14, fontWeight: "700", color: "#111827" },
  subtitle: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
    marginTop: 2,
  },
  by: { fontSize: 12, color: "#6B7280", fontWeight: "600", marginTop: 2 },
  time: { fontSize: 12, color: "#9CA3AF", fontWeight: "600", marginTop: 3 },
});
