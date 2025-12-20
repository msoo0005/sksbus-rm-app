import { Eye } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Report } from '../types/report';
import StatusBadge from './StatusBadge';

type ReportCardProps = {
  report: Report;
  onViewDetails?: (report: Report) => void;
  onAccept?: (report: Report) => void;
  onApprove?: (report: Report) => void;
  onDecline?: (report: Report) => void;
  currentTech?: string;
};

export default function ReportCard({
  report,
  onViewDetails,
  onAccept,
  onApprove,
  onDecline,
  currentTech,
}: ReportCardProps) {
  const isDeclined = report.audit?.action === 'declined';

  const showAccept = !!(
    onAccept &&
    report.status === 'open' &&
    !report.assigned
  );

  const showManagerActions = !!(
    onApprove &&
    onDecline &&
    report.status === 'pending'
  );

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Report #{report.id}</Text>

          <View style={styles.badges}>
            {/* Uses StatusBadge default label formatting */}
            <StatusBadge type={report.type} />
            <StatusBadge type={report.severity} />

            {isDeclined && <StatusBadge type="critical" label="Declined" />}
          </View>
        </View>

        <Text style={styles.date}>{report.date}</Text>
      </View>

      {/* Meta */}
      <Text style={styles.meta}>Vehicle: {report.vehicle}</Text>
      <Text style={styles.meta}>Location: {report.location}</Text>

      {!!report.reportedBy && (
        <Text style={styles.meta}>Reported by: {report.reportedBy}</Text>
      )}

      {!!report.assigned && (
        <Text style={styles.meta}>
          Assigned to: {report.assigned === currentTech ? 'You' : report.assigned}
        </Text>
      )}

      <Text style={styles.description}>{report.description}</Text>

      {isDeclined && (
        <View style={styles.declineBox}>
          <Text style={styles.declineTitle}>Decline Reason</Text>
          <Text style={styles.declineText}>{report.audit?.reason}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionRow}>
        <Pressable style={styles.button} onPress={() => onViewDetails?.(report)}>
          <Eye size={16} color="#111827" />
          <Text style={styles.buttonText}>View Details</Text>
        </Pressable>

        {showAccept && (
          <Pressable
            style={[styles.button, styles.acceptButton]}
            onPress={() => onAccept?.(report)}
          >
            <Text style={styles.whiteText}>Accept Job</Text>
          </Pressable>
        )}
      </View>

      {showManagerActions && (
        <View style={styles.managerRow}>
          <Pressable
            style={[styles.button, styles.approveButton]}
            onPress={() => onApprove?.(report)}
          >
            <Text style={styles.whiteText}>Approve</Text>
          </Pressable>

          <Pressable
            style={[styles.button, styles.declineButton]}
            onPress={() => onDecline?.(report)}
          >
            <Text style={styles.whiteText}>Decline</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerLeft: {
    flex: 1,
  },

  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },

  badges: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 6,
    flexWrap: 'wrap',
  },

  date: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },

  meta: {
    marginTop: 8,
    color: '#666',
  },

  description: {
    marginTop: 12,
    fontSize: 14,
    color: '#111827',
  },

  declineBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#FFF3F3',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#E53935',
  },
  declineTitle: { fontWeight: '700', color: '#E53935' },
  declineText: { marginTop: 4, color: '#333' },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  managerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },

  button: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },

  acceptButton: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  approveButton: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  declineButton: {
    backgroundColor: '#E53935',
    borderColor: '#E53935',
  },

  buttonText: { fontWeight: '600', color: '#111827' },
  whiteText: { color: '#fff', fontWeight: '600' },
});
