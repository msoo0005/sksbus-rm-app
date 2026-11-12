import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";

/** A white card with an icon + title header, as on every PUSPAKOM screen. */
export function Section({
  icon,
  title,
  right,
  children,
  style,
}: {
  icon?: string;
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[s.card, style]}>
      {!!title && (
        <View style={s.head}>
          {!!icon && (
            <View style={s.icon}>
              <FontAwesome5 name={icon as any} size={13} color="#4B5563" />
            </View>
          )}
          <Text style={s.title}>{title}</Text>
          <View style={{ flex: 1 }} />
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

/** Label on the left, value on the right; wraps long values. */
export function InfoRow({ label, value, bold = true, last }: { label: string; value: React.ReactNode; bold?: boolean; last?: boolean }) {
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      <Text style={s.rowLabel}>{label}</Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text style={[s.rowValue, bold && { fontWeight: "700" }]}>{value}</Text>
      ) : (
        <View style={{ flexShrink: 1, alignItems: "flex-end" }}>{value}</View>
      )}
    </View>
  );
}

export function FieldLabel({ children, tone }: { children: string; tone?: "danger" }) {
  return <Text style={[s.fieldLabel, tone === "danger" && { color: "#B91C1C" }]}>{children}</Text>;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    marginBottom: 12,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 12,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  icon: { width: 30, height: 30, borderRadius: 9, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: "#111827" },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  rowLabel: { fontSize: 13, color: "#6B7280" },
  rowValue: { fontSize: 13, color: "#111827", textAlign: "right", flexShrink: 1 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6B7280",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 12,
  },
});
