import { FontAwesome5 } from "@expo/vector-icons";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n/i18n-ctx";
import { openDirections } from "../utils/directions";
import { Report } from "../types/report";
import ImageViewerOverlay from "./ImageViewerOverlay";

type Props = {
  visible: boolean;
  report: Report | null;
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
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function mediaToUrl(m: any) {
  const direct = m?.viewUrl || m?.url || m?.view_url || m?.signedUrl || m?.signed_url;
  if (direct) return String(direct);
  const bucket = m?.s3_bucket;
  const key = m?.s3_key;
  if (!bucket || !key) return null;
  const region = process.env.EXPO_PUBLIC_AWS_REGION || "ap-southeast-1";
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

const TYPE_CONFIG: Record<string, { labelKey: string; color: string; bg: string }> = {
  problem:  { labelKey: "statusBadge.problem",  color: "#DC2626", bg: "#FEF2F2" },
  repair:   { labelKey: "statusBadge.repair",   color: "#2563EB", bg: "#EFF6FF" },
  accident: { labelKey: "statusBadge.accident", color: "#EA580C", bg: "#FFF7ED" },
};

const SEVERITY_CONFIG: Record<string, { labelKey: string; color: string; bg: string }> = {
  low:      { labelKey: "statusBadge.low",      color: "#16A34A", bg: "#F0FDF4" },
  medium:   { labelKey: "statusBadge.medium",   color: "#CA8A04", bg: "#FEFCE8" },
  high:     { labelKey: "statusBadge.high",     color: "#EA580C", bg: "#FFF7ED" },
  critical: { labelKey: "statusBadge.critical", color: "#DC2626", bg: "#FEF2F2" },
};

function Chip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[chipS.wrap, { backgroundColor: bg }]}>
      <Text style={[chipS.text, { color }]}>{label}</Text>
    </View>
  );
}
const chipS = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  text: { fontSize: 12, fontWeight: "700" },
});

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={fS.wrap}>
      <Text style={fS.label}>{label}</Text>
      <Text style={fS.value}>{value || "—"}</Text>
    </View>
  );
}
const fS = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  value: { fontSize: 15, fontWeight: "600", color: "#111827", lineHeight: 21 },
});

export default function JobDetailsModal({
  visible,
  report,
  media = [],
  loadingMedia = false,
  onClose,
}: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
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

  if (!report) return null;

  const typeConf = TYPE_CONFIG[report.type] ?? TYPE_CONFIG.repair;
  const sevConf = SEVERITY_CONFIG[report.severity] ?? SEVERITY_CONFIG.medium;
  const declined = report.audit?.action === "declined";
  const approved = report.audit?.action === "approved";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[s.screen, { paddingTop: insets.top }]}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.headerEyebrow}>{t("jobDetailsModal.reportEyebrow")}</Text>
            <Text style={s.headerTitle}>#{report.id}</Text>
          </View>
          <View style={s.headerRight}>
            <Chip label={t(typeConf.labelKey)} color={typeConf.color} bg={typeConf.bg} />
            <Chip label={t(sevConf.labelKey)} color={sevConf.color} bg={sevConf.bg} />
            <Pressable
              onPress={onClose}
              style={s.closeBtn}
              hitSlop={8}
            >
              <FontAwesome5 name="times" size={14} color="#374151" />
            </Pressable>
          </View>
        </View>

        <View style={s.headerDivider} />

        {/* ── Body ── */}
        <ScrollView
          style={s.body}
          contentContainerStyle={s.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Details card */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.cardIcon}>
                <FontAwesome5 name="file-alt" size={13} color="#6B7280" />
              </View>
              <Text style={s.cardTitle}>{t("jobDetailsModal.reportDetailsTitle")}</Text>
            </View>
            <View style={s.cardDivider} />

            <Field label={t("jobDetailsModal.vehicle")} value={report.vehicle} />

            {/* Location — tappable when coordinates are available */}
            {report.lat != null && report.lng != null ? (
              <Pressable
                style={({ pressed }) => [fS.wrap, pressed && { opacity: 0.6 }]}
                onPress={() => openDirections(report.lat!, report.lng!)}
              >
                <Text style={fS.label}>{t("jobDetailsModal.location")}</Text>
                <View style={s.locationRow}>
                  <Text style={[fS.value, s.locationLink]}>{report.location}</Text>
                  <FontAwesome5 name="directions" size={14} color="#2563EB" />
                </View>
              </Pressable>
            ) : (
              <Field label={t("jobDetailsModal.location")} value={report.location} />
            )}

            {report.reportedBy && <Field label={t("jobDetailsModal.reportedBy")} value={report.reportedBy} />}
            {report.assigned && <Field label={t("jobDetailsModal.assignedTo")} value={report.assigned} />}
            <Field label={t("jobDetailsModal.submitted")} value={report.date} />
            <Field label={t("jobDetailsModal.description")} value={report.description} />
          </View>

          {/* Photos card */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.cardIcon}>
                <FontAwesome5 name="images" size={13} color="#6B7280" />
              </View>
              <Text style={s.cardTitle}>{t("jobDetailsModal.photosTitle")}</Text>
              {!loadingMedia && (
                <View style={s.countPill}>
                  <Text style={s.countText}>
                    {t("jobDetailsModal.photoCount", { count: photoUrls.length })}
                  </Text>
                </View>
              )}
            </View>
            <View style={s.cardDivider} />

            {loadingMedia ? (
              <View style={s.loadingRow}>
                <ActivityIndicator size="small" color="#9CA3AF" />
                <Text style={s.mutedText}>{t("jobDetailsModal.loadingPhotos")}</Text>
              </View>
            ) : photoUrls.length === 0 ? (
              <Text style={s.mutedText}>{t("jobDetailsModal.noPhotosAttached")}</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.photoStrip}
              >
                {photoUrls.map((item, idx) => (
                  <Pressable
                    key={`${item.url}-${idx}`}
                    onPress={() => openViewerAt(idx)}
                    style={s.thumb}
                  >
                    <Image source={{ uri: item.url }} style={s.thumbImg} resizeMode="cover" />
                    <View style={s.thumbOverlay}>
                      <FontAwesome5 name="expand-alt" size={14} color="#fff" />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Audit card */}
          {(approved || declined) && (
            <View style={[s.auditCard, declined ? s.auditDeclined : s.auditApproved]}>
              <View style={s.auditHeader}>
                <FontAwesome5
                  name={approved ? "check-circle" : "times-circle"}
                  size={16}
                  color={approved ? "#16A34A" : "#DC2626"}
                />
                <Text style={[s.auditTitle, { color: approved ? "#16A34A" : "#DC2626" }]}>
                  {approved ? t("statusBadge.approved") : t("statusBadge.declined")}
                </Text>
              </View>

              <View style={s.auditFields}>
                <Field label={t("jobDetailsModal.reviewedBy")} value={report.audit?.by} />
                <Field label={t("jobDetailsModal.at")} value={formatAuditTime(report.audit?.at)} />
                {declined && report.audit?.reason?.trim() && (
                  <Field label={t("jobDetailsModal.reason")} value={report.audit.reason} />
                )}
              </View>
            </View>
          )}

        </ScrollView>
      </View>

      <ImageViewerOverlay
        visible={viewerVisible}
        imageUrls={photoUrls}
        startIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9FAFB" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: "#fff",
    gap: 12,
  },
  headerLeft: { flex: 1 },
  headerEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  headerDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
  },

  body: { flex: 1 },
  bodyContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 40,
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  cardIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
    flex: 1,
  },
  cardDivider: {
    height: 1,
    backgroundColor: "#F3F4F6",
    marginBottom: 14,
  },
  countPill: {
    backgroundColor: "#F3F4F6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  countText: { fontSize: 12, fontWeight: "600", color: "#6B7280" },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mutedText: { fontSize: 14, color: "#9CA3AF", fontWeight: "500" },

  photoStrip: { gap: 10, paddingBottom: 2 },
  thumb: {
    width: 110,
    height: 82,
    borderRadius: 14,
    overflow: "hidden",
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Audit
  auditCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
  },
  auditApproved: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
  },
  auditDeclined: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  auditHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  auditTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  auditFields: {},

  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  locationLink: {
    color: "#2563EB",
    flex: 1,
  },
});
