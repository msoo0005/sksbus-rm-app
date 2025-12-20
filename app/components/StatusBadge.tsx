import { StyleSheet, Text, View, ViewStyle } from 'react-native';

type StatusType =
  | 'repair'
  | 'problem'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

type StatusBadgeProps = {
  label?: string;
  type: StatusType;
};

export default function StatusBadge({ label, type }: StatusBadgeProps) {
  const badgeStyle = STATUS_COLORS[type];

  return (
    <View style={[styles.badge, badgeStyle]}>
      <Text style={styles.text}>
        {label ?? formatLabel(type)}
      </Text>
    </View>
  );
}

const formatLabel = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

const STATUS_COLORS: Record<StatusType, ViewStyle> = {
  repair: { backgroundColor: '#111827' },
  problem: { backgroundColor: '#D64545' },
  low: { backgroundColor: '#4CAF50' },
  medium: { backgroundColor: '#F59E0B' },
  high: { backgroundColor: '#FF5722' },
  critical: { backgroundColor: '#D32F2F' },
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  text: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
