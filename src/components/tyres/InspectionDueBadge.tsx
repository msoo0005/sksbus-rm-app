import React from "react";
import { StyleSheet, Text, View } from "react-native";

// How overdue a bus is for its periodic tyre inspection. The thresholds were
// re-implemented three times across the tyre screens with slightly different
// wording each time; this is the single source, and `inspectionDueState` is
// exported separately so list screens can sort by the same notion of urgency.

export type InspectionDueState = {
  label: string;
  color: string;
  bg: string;
  /** Days left before due. Negative = overdue. null = never inspected. */
  remaining: number | null;
  isOverdue: boolean;
  isDueSoon: boolean;
  neverInspected: boolean;
};

const DUE_SOON_DAYS = 7;

export function inspectionDueState(
  daysSinceInspection: number | null | undefined,
  intervalDays: number,
): InspectionDueState {
  if (daysSinceInspection == null) {
    return {
      label: "Never inspected",
      color: "#DC2626",
      bg: "#FEF2F2",
      remaining: null,
      isOverdue: true,
      isDueSoon: false,
      neverInspected: true,
    };
  }

  const remaining = intervalDays - daysSinceInspection;

  if (remaining < 0) {
    return {
      label: `Overdue ${Math.abs(remaining)}d`,
      color: "#DC2626",
      bg: "#FEF2F2",
      remaining,
      isOverdue: true,
      isDueSoon: false,
      neverInspected: false,
    };
  }

  if (remaining <= DUE_SOON_DAYS) {
    return {
      label: `Due in ${remaining}d`,
      color: "#D97706",
      bg: "#FFFBEB",
      remaining,
      isOverdue: false,
      isDueSoon: true,
      neverInspected: false,
    };
  }

  return {
    label: `Due in ${remaining}d`,
    color: "#16A34A",
    bg: "#F0FDF4",
    remaining,
    isOverdue: false,
    isDueSoon: false,
    neverInspected: false,
  };
}

/**
 * Sort key putting the most urgent bus first: never inspected, then longest
 * since inspection. Used by both the inspections list and the hub counts.
 */
export function dueSortValue(daysSinceInspection: number | null | undefined): number {
  return daysSinceInspection == null ? Number.POSITIVE_INFINITY : daysSinceInspection;
}

export default function InspectionDueBadge({ state }: { state: InspectionDueState }) {
  return (
    <View style={[s.badge, { backgroundColor: state.bg }]}>
      <Text style={[s.text, { color: state.color }]}>{state.label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  text: { fontSize: 10, fontWeight: "800" },
});
