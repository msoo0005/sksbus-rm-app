import { StyleSheet, Text, View, ViewStyle } from 'react-native';

type StatusType =
  // Report types
  | 'repair'
  | 'problem'
  | 'accident'

  // Severity / priority
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'

  // Inventory
  | 'inStock'
  | 'lowStock'

  // Report lifecycle
  | 'pending'
  | 'open'
  | 'closed'

  // Review actions
  | 'approved'
  | 'declined';

type StatusBadgeProps = {
  label?: string;
  type: StatusType;
};

const STATUS_STYLES: Record<
  StatusType,
  { container: ViewStyle; text?: { color?: string } }
> = {
  // Report types
  repair: { container: { backgroundColor: '#111827' }, text: { color: '#FFFFFF' } },
  problem: { container: { backgroundColor: '#D64545' }, text: { color: '#FFFFFF' } },
  accident: { container: { backgroundColor: '#F97316' }, text: { color: '#FFFFFF' } },

  // Severity
  low: { container: { backgroundColor: '#4CAF50' }, text: { color: '#FFFFFF' } },
  medium: { container: { backgroundColor: '#F59E0B' }, text: { color: '#FFFFFF' } },
  high: { container: { backgroundColor: '#FF5722' }, text: { color: '#FFFFFF' } },
  critical: { container: { backgroundColor: '#D32F2F' }, text: { color: '#FFFFFF' } },

  // Inventory
  inStock: { container: { backgroundColor: '#111827' }, text: { color: '#FFFFFF' } },
  lowStock: { container: { backgroundColor: '#E5E7EB' }, text: { color: '#111827' } },

  // Report lifecycle
  pending: { container: { backgroundColor: '#E5E7EB' }, text: { color: '#111827' } },
  open: { container: { backgroundColor: '#2563EB' }, text: { color: '#FFFFFF' } },
  closed: { container: { backgroundColor: '#6B7280' }, text: { color: '#FFFFFF' } },

  // Review actions
  approved: { container: { backgroundColor: '#4CAF50' }, text: { color: '#FFFFFF' } },
  declined: { container: { backgroundColor: '#E53935' }, text: { color: '#FFFFFF' } },
};

const formatLabel = (value: string) => {
  switch (value) {
    case 'inStock':
      return 'In Stock';
    case 'lowStock':
      return 'Low Stock';
    case 'pending':
      return 'Pending Review';
    case 'open':
      return 'Open';
    case 'closed':
      return 'Closed';
    case 'approved':
      return 'Approved';
    case 'declined':
      return 'Declined';
    default:
      return value.charAt(0).toUpperCase() + value.slice(1);
  }
};

export default function StatusBadge({ label, type }: StatusBadgeProps) {
  const style = STATUS_STYLES[type];

  return (
    <View style={[styles.badge, style.container]}>
      <Text style={[styles.text, style.text]}>
        {label ?? formatLabel(type)}
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
    fontWeight: '800',
  },
});
