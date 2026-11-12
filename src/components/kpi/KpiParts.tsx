// Small building blocks shared by the Performance & KPIs screens.

import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n/i18n-ctx";
import { Period, PeriodKind, periodLabel } from "../../utils/kpiPeriod";

export const KPI_GREEN = "#34873F";

/** 7 days | Month | Year, then ‹ October 2026 › */
export function PeriodBar({
  period,
  onKind,
  onStep,
}: {
  period: Period;
  onKind: (k: PeriodKind) => void;
  onStep: (delta: 1 | -1) => void;
}) {
  const { t } = useI18n();
  const kinds: { key: PeriodKind; label: string }[] = [
    { key: "week", label: t("performance.period7Days") },
    { key: "month", label: t("performance.periodMonth") },
    { key: "year", label: t("performance.periodYear") },
  ];
  return (
    <View>
      <View style={s.segment}>
        {kinds.map((k) => {
          const active = period.kind === k.key;
          return (
            <Pressable key={k.key} onPress={() => onKind(k.key)} style={[s.segItem, active && s.segItemActive]}>
              <Text style={[s.segText, active && s.segTextActive]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.navRow}>
        <Pressable onPress={() => onStep(-1)} hitSlop={10} style={s.navBtn}>
          <FontAwesome5 name="chevron-left" size={13} color="#374151" />
        </Pressable>
        <Text style={s.navLabel}>{periodLabel(period)}</Text>
        <Pressable onPress={() => onStep(1)} hitSlop={10} style={s.navBtn} disabled={period.offset >= 0}>
          <FontAwesome5 name="chevron-right" size={13} color={period.offset >= 0 ? "#D1D5DB" : "#374151"} />
        </Pressable>
      </View>
    </View>
  );
}

export function StatTile({
  label,
  value,
  sub,
  subTone = "muted",
  highlight,
}: {
  label: string;
  value: string;
  sub?: string | null;
  subTone?: "good" | "bad" | "muted" | "warn";
  highlight?: boolean;
}) {
  const subColor =
    subTone === "good" ? "#15803D" : subTone === "bad" ? "#B91C1C" : subTone === "warn" ? "#C2410C" : "#6B7280";
  return (
    <View style={[s.tile, highlight && s.tileHighlight]}>
      <Text style={[s.tileLabel, highlight && { color: "#9A3412" }]}>{label}</Text>
      <Text style={[s.tileValue, highlight && { color: "#9A3412" }]}>{value}</Text>
      {!!sub && <Text style={[s.tileSub, { color: subColor }]}>{sub}</Text>}
    </View>
  );
}

export function Card({ title, subtitle, right, children }: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      {(title || right) && (
        <View style={s.cardHead}>
          <View style={{ flex: 1 }}>
            {!!title && <Text style={s.cardTitle}>{title}</Text>}
            {!!subtitle && <Text style={s.cardSub}>{subtitle}</Text>}
          </View>
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

/** A label, a proportional bar and a count; optionally tappable. */
export function BarRow({
  label,
  value,
  max,
  right,
  onPress,
  color = KPI_GREEN,
  bold,
  wide,
}: {
  label: string;
  value: number;
  max: number;
  right?: string;
  onPress?: () => void;
  color?: string;
  bold?: boolean;
  // Long labels (bus-system categories): label on its own line above the bar.
  wide?: boolean;
}) {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  if (wide) {
    return (
      <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.wideRow, pressed && { opacity: 0.6 }]}>
        <View style={s.wideTop}>
          <Text style={[s.wideLabel, bold && { fontWeight: "800" }]} numberOfLines={2}>
            {label}
          </Text>
          <Text style={s.barValue}>{right ?? String(value)}</Text>
          {onPress ? <FontAwesome5 name="chevron-right" size={11} color="#9CA3AF" /> : null}
        </View>
        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${width}%`, backgroundColor: color }]} />
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.barRow, pressed && { opacity: 0.6 }]}>
      <Text style={[s.barLabel, bold && { fontWeight: "800" }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${width}%`, backgroundColor: color }]} />
      </View>
      <Text style={s.barValue}>{right ?? String(value)}</Text>
      {onPress ? <FontAwesome5 name="chevron-right" size={11} color="#9CA3AF" /> : <View style={{ width: 7 }} />}
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export const kpiStyles = StyleSheet.create({
  tilesRow: { flexDirection: "row", gap: 10 },
});

const s = StyleSheet.create({
  segment: { flexDirection: "row", backgroundColor: "#E5E7EB", borderRadius: 14, padding: 4 },
  segItem: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 10 },
  segItemActive: { backgroundColor: "#fff" },
  segText: { fontSize: 14, fontWeight: "600", color: "#6B7280" },
  segTextActive: { color: "#111827", fontWeight: "800" },
  navRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, marginBottom: 4 },
  navBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  navLabel: { fontSize: 16, fontWeight: "800", color: "#111827" },
  tile: { flex: 1, backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "transparent" },
  tileHighlight: { backgroundColor: "#FFF7ED", borderColor: "#FDBA74" },
  tileLabel: { fontSize: 12, fontWeight: "600", color: "#374151" },
  tileValue: { fontSize: 26, fontWeight: "800", color: "#111827", marginTop: 4 },
  tileSub: { fontSize: 11, fontWeight: "700", marginTop: 4 },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 16 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  cardSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  wideRow: { paddingVertical: 8, gap: 6 },
  wideTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  wideLabel: { flex: 1, fontSize: 13, color: "#111827" },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  barLabel: { width: 128, fontSize: 13, color: "#111827" },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#F3F4F6", overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { minWidth: 46, textAlign: "right", fontSize: 13, fontWeight: "700", color: "#111827" },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff" },
  chipActive: { backgroundColor: "#ECFDF3", borderColor: KPI_GREEN },
  chipText: { fontSize: 13, fontWeight: "600", color: "#111827" },
  chipTextActive: { color: KPI_GREEN, fontWeight: "800" },
});
