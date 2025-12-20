import { StyleSheet, Text, View, ViewStyle } from 'react-native';

type StatusBadgeProps = {
  label: string;
  type: 'repair' | 'problem' | 'low' | 'medium' | 'high' | 'critical';
};

export default function StatusBadge({ label, type }: StatusBadgeProps) {
  const badgeStyle: ViewStyle = STATUS_COLORS[type] || STATUS_COLORS[type];

  return (
    <View style={[styles.badge, badgeStyle]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const STATUS_COLORS: Record<StatusBadgeProps['type'], ViewStyle> = {
  repair: { backgroundColor: '#111' },
  problem: { backgroundColor: '#D64545' },
  low: { backgroundColor: '#4CAF50' },
  medium: { backgroundColor: '#FFC107' },
  high: { backgroundColor: '#FF5722' },
  critical: { backgroundColor: '#D32F2F' },
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
});
