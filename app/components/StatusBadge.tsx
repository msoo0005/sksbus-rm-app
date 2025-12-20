import { StyleSheet, Text, View, ViewStyle } from 'react-native';

type StatusType =
  | 'repair'
  | 'problem'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'inStock'
  | 'lowStock';

type StatusBadgeProps = {
  label?: string;
  type: StatusType;
};

const STATUS_STYLES: Record<
  StatusType,
  { container: ViewStyle; text?: { color?: string } }
> = {
  repair: { container: { backgroundColor: '#111827' }, text: { color: '#FFFFFF' } },
  problem: { container: { backgroundColor: '#D64545' }, text: { color: '#FFFFFF' } },
  low: { container: { backgroundColor: '#4CAF50' }, text: { color: '#FFFFFF' } },
  medium: { container: { backgroundColor: '#F59E0B' }, text: { color: '#FFFFFF' } },
  high: { container: { backgroundColor: '#FF5722' }, text: { color: '#FFFFFF' } },
  critical: { container: { backgroundColor: '#D32F2F' }, text: { color: '#FFFFFF' } },

  inStock: { container: { backgroundColor: '#111827' }, text: { color: '#FFFFFF' } },
  lowStock: { container: { backgroundColor: '#E5E7EB' }, text: { color: '#111827' } },
};

const formatLabel = (value: string) => {
  // If you ever use "inStock" without a label, make it nicer
  if (value === 'inStock') return 'In Stock';
  if (value === 'lowStock') return 'Low Stock';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

export default function StatusBadge({ label, type }: StatusBadgeProps) {
  const style = STATUS_STYLES[type];

  return (
    <View style={[styles.badge, style.container]}>
      <Text style={[styles.text, style.text]}>{label ?? formatLabel(type)}</Text>
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
    fontWeight: '800',
  },
});
