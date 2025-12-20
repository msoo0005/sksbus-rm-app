import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Report } from '../types/report';

type Props = {
  visible: boolean;
  report: Report | null;
  onClose: () => void;
};

export default function JobDetailsModal({ visible, report, onClose }: Props) {
  if (!report) return null;

  const declined = report.audit?.action === 'declined';

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Report #{report.id}</Text>

          {/* Vehicle & Location */}
          <Text>Vehicle: {report.vehicle}</Text>
          <Text>Location: {report.location}</Text>

          {/* Reporter */}
          {report.reportedBy && (
            <Text>Reported by: {report.reportedBy}</Text>
          )}

          {/* Assigned Technician */}
          {report.assigned && (
            <Text>
              Assigned to:{' '}
              {report.assigned}
            </Text>
          )}

          {/* Description */}
          <Text style={{ marginTop: 10 }}>{report.description}</Text>

          {/* Decline audit */}
          {declined && (
            <View style={styles.auditBox}>
              <Text style={styles.auditTitle}>Declined Audit</Text>
              <Text>By: {report.audit?.by}</Text>
              <Text>
                At: {new Date(report.audit!.at).toLocaleString()}
              </Text>
              <Text style={{ marginTop: 6 }}>
                Reason: {report.audit?.reason}
              </Text>
            </View>
          )}

          {/* Close button */}
          <Pressable style={styles.close} onPress={onClose}>
            <Text>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },

  auditBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#FFF3F3',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#E53935',
  },
  auditTitle: { fontWeight: '700', color: '#E53935' },

  close: {
    marginTop: 20,
    padding: 12,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#eee',
  },
});
