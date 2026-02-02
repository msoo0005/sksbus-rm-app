import React from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Report } from "../types/report";
import ImageViewerOverlay from "./ImageViewerOverlay";

// components/JobDetailsModal.tsx
// ADD to Props:
type Props = {
  visible: boolean;
  report: Report | null;

  // existing (you already pass these)
  media?: any[];
  loadingMedia?: boolean;
  job?: {
    job_id: number;
    job_status?: string | null;
    job_desc?: string | null;
    technician_user_id?: number | null;
    job_created_at?: string | null;
  } | null;
  loadingJob?: boolean;

  onClose: () => void;
};

function formatAuditTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function mediaToUrl(m: any) {
  const direct =
    m?.viewUrl || // backend returns this
    m?.url ||
    m?.view_url ||
    m?.signedUrl ||
    m?.signed_url;

  if (direct) return String(direct);

  const bucket = m?.s3_bucket;
  const key = m?.s3_key;
  if (!bucket || !key) return null;

  const region = process.env.EXPO_PUBLIC_AWS_REGION || "ap-southeast-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(
    key,
  ).replace(/%2F/g, "/")}`;
}

export default function JobDetailsModal({
  visible,
  report,
  media = [],
  loadingMedia = false,
  onClose,
}: Props) {
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);

  const photoItems = React.useMemo(() => {
    return (media || []).filter((m: any) => {
      const mt = String(m?.media_type ?? "").toLowerCase();
      const mime = String(m?.mime_type ?? "").toLowerCase();
      return mt === "image" || mime.startsWith("image/");
    });
  }, [media]);

  const photoUrls = React.useMemo(() => {
    return photoItems
      .map((m: any) => mediaToUrl(m))
      .filter(Boolean)
      .map((u: any) => ({ url: String(u) }));
  }, [photoItems]);

  const openViewerAt = (index: number) => {
    if (!photoUrls.length) return;
    setViewerIndex(Math.max(0, Math.min(index, photoUrls.length - 1)));
    setViewerVisible(true);
  };

  const closeViewer = () => setViewerVisible(false);

  // keep hooks above; safe to return null
  if (!report) return null;

  const declined = report.audit?.action === "declined";
  const approved = report.audit?.action === "approved";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.screen}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Report #{report.id}</Text>
          <Pressable
            onPress={() => {
              closeViewer();
              onClose();
            }}
            style={styles.headerClose}
          >
            <Text style={styles.headerCloseText}>Close</Text>
          </Pressable>
        </View>

        {/* Body */}
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.label}>Vehicle</Text>
            <Text style={styles.value}>{report.vehicle}</Text>

            <Text style={styles.label}>Location</Text>
            <Text style={styles.value}>{report.location}</Text>

            {report.reportedBy && (
              <>
                <Text style={styles.label}>Reported by</Text>
                <Text style={styles.value}>{report.reportedBy}</Text>
              </>
            )}

            {report.assigned && (
              <>
                <Text style={styles.label}>Assigned to</Text>
                <Text style={styles.value}>{report.assigned}</Text>
              </>
            )}

            <Text style={styles.label}>Description</Text>
            <Text style={styles.value}>{report.description}</Text>
          </View>

          {/* Photos */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Photos</Text>

            {loadingMedia ? (
              <View style={styles.mediaLoadingRow}>
                <ActivityIndicator />
                <Text style={{ color: "#666" }}>Loading photos…</Text>
              </View>
            ) : photoUrls.length === 0 ? (
              <Text style={{ color: "#666", marginTop: 6 }}>
                No photos attached.
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.mediaRow}
                keyboardShouldPersistTaps="handled"
              >
                {photoUrls.map((item, idx) => (
                  <Pressable
                    key={`${item.url}-${idx}`}
                    style={styles.thumbWrap}
                    onPress={() => openViewerAt(idx)}
                    hitSlop={10}
                  >
                    <Image
                      source={{ uri: item.url }}
                      style={styles.thumb}
                      resizeMode="cover"
                    />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Audit */}
          {approved && (
            <View style={[styles.auditBox, styles.auditBoxApproved]}>
              <Text style={[styles.auditTitle, styles.auditTitleApproved]}>
                Approved Audit
              </Text>
              <Text>By: {report.audit?.by ?? "—"}</Text>
              <Text>At: {formatAuditTime(report.audit?.at)}</Text>
            </View>
          )}

          {declined && (
            <View style={styles.auditBox}>
              <Text style={styles.auditTitle}>Declined Audit</Text>
              <Text>By: {report.audit?.by ?? "—"}</Text>
              <Text>At: {formatAuditTime(report.audit?.at)}</Text>
              <Text style={{ marginTop: 6 }}>
                Reason:{" "}
                {report.audit?.reason?.trim()
                  ? report.audit?.reason
                  : "No reason provided."}
              </Text>
            </View>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* ✅ Fullscreen pinch/zoom overlay (still inside same modal) */}
        <ImageViewerOverlay
          visible={viewerVisible}
          imageUrls={photoUrls}
          startIndex={viewerIndex}
          onClose={closeViewer}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f9f9f9" },

  header: {
    paddingTop: 54,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },
  headerClose: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#eee",
  },
  headerCloseText: { fontWeight: "700" },

  body: { flex: 1 },
  bodyContent: { padding: 16, gap: 12 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#eee",
  },

  label: { marginTop: 10, fontWeight: "700", color: "#374151" },
  value: { marginTop: 4, color: "#111827" },

  sectionTitle: { fontWeight: "800", color: "#111827" },

  mediaLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },

  mediaRow: {
    paddingTop: 10,
    paddingBottom: 2,
    gap: 10,
  },

  thumbWrap: {
    width: 140,
    height: 105,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#eee",
    backgroundColor: "#f3f4f6",
  },

  thumb: { width: "100%", height: "100%" },

  auditBox: {
    padding: 12,
    backgroundColor: "#FFF3F3",
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#E53935",
  },
  auditTitle: { fontWeight: "800", color: "#E53935" },

  auditBoxApproved: {
    backgroundColor: "#F2FFF4",
    borderLeftColor: "#4CAF50",
  },
  auditTitleApproved: { color: "#2E7D32" },
});
