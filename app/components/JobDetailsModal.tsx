import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Report } from "../types/report";

type Props = {
  visible: boolean;
  report: Report | null;
  onClose: () => void;
};

function formatAuditTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // fallback if weird format
  return d.toLocaleString();
}

export default function JobDetailsModal({ visible, report, onClose }: Props) {
  if (!report) return null;

  const declined = report.audit?.action === "declined";
  const approved = report.audit?.action === "approved";

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Report #{report.id}</Text>

          <Text>Vehicle: {report.vehicle}</Text>
          <Text>Location: {report.location}</Text>

          {report.reportedBy && <Text>Reported by: {report.reportedBy}</Text>}

          {report.assigned && <Text>Assigned to: {report.assigned}</Text>}

          <Text style={{ marginTop: 10 }}>{report.description}</Text>

          {/* Approved audit */}
          {approved && (
            <View style={[styles.auditBox, styles.auditBoxApproved]}>
              <Text style={[styles.auditTitle, styles.auditTitleApproved]}>Approved Audit</Text>
              <Text>By: {report.audit?.by ?? "—"}</Text>
              <Text>At: {formatAuditTime(report.audit?.at)}</Text>
            </View>
          )}

          {/* Declined audit */}
          {declined && (
            <View style={styles.auditBox}>
              <Text style={styles.auditTitle}>Declined Audit</Text>
              <Text>By: {report.audit?.by ?? "—"}</Text>
              <Text>At: {formatAuditTime(report.audit?.at)}</Text>
              <Text style={{ marginTop: 6 }}>
                Reason: {report.audit?.reason?.trim() ? report.audit?.reason : "No reason provided."}
              </Text>
            </View>
          )}

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
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#fff",
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 12 },

  auditBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#FFF3F3",
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#E53935",
  },
  auditTitle: { fontWeight: "700", color: "#E53935" },

  auditBoxApproved: {
    backgroundColor: "#F2FFF4",
    borderLeftColor: "#4CAF50",
  },
  auditTitleApproved: { color: "#2E7D32" },

  close: {
    marginTop: 20,
    padding: 12,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#eee",
  },
});
