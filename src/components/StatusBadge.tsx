import { StyleSheet, Text, View, ViewStyle } from "react-native";
import { useI18n } from "../i18n/i18n-ctx";

export type StatusType =
  // Report types
  | "repair"
  | "problem"
  | "accident"

  // Severity / priority
  | "low"
  | "medium"
  | "high"
  | "critical"

  // Inventory
  | "inStock"
  | "lowStock"

  // Report lifecycle
  | "pending"
  | "open"
  | "closed"

  // Review actions
  | "approved"
  | "declined";

type StatusBadgeProps = {
  label?: string;
  type: StatusType;
  // "sm" matches the ElapsedTimer pill, for cards that stack the two.
  size?: "md" | "sm";
  style?: ViewStyle;
};

const STATUS_STYLES: Record<
  StatusType,
  { container: ViewStyle; text?: { color?: string } }
> = {
  // Report types — deliberately neutral grey rather than status-style colours,
  // since these are a category label, not a severity/urgency signal.
  repair: {
    container: { backgroundColor: "#E5E7EB" },
    text: { color: "#374151" },
  },
  problem: {
    container: { backgroundColor: "#E5E7EB" },
    text: { color: "#374151" },
  },
  accident: {
    container: { backgroundColor: "#E5E7EB" },
    text: { color: "#374151" },
  },

  // Severity
  low: {
    container: { backgroundColor: "#4CAF50" },
    text: { color: "#FFFFFF" },
  },
  // Darker amber (was #F59E0B) so the white text is readable.
  medium: {
    container: { backgroundColor: "#B45309" },
    text: { color: "#FFFFFF" },
  },
  high: {
    container: { backgroundColor: "#FF5722" },
    text: { color: "#FFFFFF" },
  },
  critical: {
    container: { backgroundColor: "#D32F2F" },
    text: { color: "#FFFFFF" },
  },

  // Inventory
  inStock: {
    container: { backgroundColor: "#111827" },
    text: { color: "#FFFFFF" },
  },
  lowStock: {
    container: { backgroundColor: "#E5E7EB" },
    text: { color: "#111827" },
  },

  // Report lifecycle
  pending: {
    container: { backgroundColor: "#E5E7EB" },
    text: { color: "#111827" },
  },
  open: {
    container: { backgroundColor: "#2563EB" },
    text: { color: "#FFFFFF" },
  },
  closed: {
    container: { backgroundColor: "#6B7280" },
    text: { color: "#FFFFFF" },
  },

  // Review actions
  approved: {
    container: { backgroundColor: "#4CAF50" },
    text: { color: "#FFFFFF" },
  },
  declined: {
    container: { backgroundColor: "#E53935" },
    text: { color: "#FFFFFF" },
  },
};

const STATUS_LABEL_KEYS: Record<StatusType, string> = {
  repair: "statusBadge.repair",
  problem: "statusBadge.problem",
  accident: "statusBadge.accident",
  low: "statusBadge.low",
  medium: "statusBadge.medium",
  high: "statusBadge.high",
  critical: "statusBadge.critical",
  inStock: "statusBadge.inStock",
  lowStock: "statusBadge.lowStock",
  pending: "statusBadge.pending",
  open: "statusBadge.open",
  closed: "statusBadge.closed",
  approved: "statusBadge.approved",
  declined: "statusBadge.declined",
};

export default function StatusBadge({ label, type, size = "md", style: extra }: StatusBadgeProps) {
  const { t } = useI18n();
  const style = STATUS_STYLES[type];
  const sm = size === "sm";

  return (
    <View style={[styles.badge, sm && styles.badgeSm, style.container, extra]}>
      <Text style={[styles.text, sm && styles.textSm, style.text]}>
        {label ?? t(STATUS_LABEL_KEYS[type])}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  text: {
    fontSize: 13,
    fontWeight: "800",
  },
  badgeSm: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  textSm: {
    fontSize: 12,
  },
});
