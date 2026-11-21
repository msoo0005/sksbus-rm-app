import { FontAwesome5 } from "@expo/vector-icons";
import React, { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { JobFollowup } from "../../api/client";
import { useI18n } from "../../i18n/i18n-ctx";
import { formatDateTime } from "../../utils/datetime";
import ImageViewerOverlay from "../ImageViewerOverlay";

function addedLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

type Props = {
  followup: JobFollowup;
  n: number;
  /** R&M review (C8): pending follow-ups say a job order is required. */
  showJobOrderRequired?: boolean;
  onRemove?: () => void;
  onOpenJobOrder?: (jobId: number) => void;
};

/** C4 / C11 · one saved follow-up, read only. */
export default function FollowupCard({ followup: f, n, showJobOrderRequired, onRemove, onOpenJobOrder }: Props) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<string | null>(null);
  const issued = f.status === "JOB_ORDER_ISSUED";

  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={s.num}>
          <Text style={s.numText}>{n}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t("job2.followups.followUp", { n })}</Text>
          <Text style={s.sub}>{t("job2.followups.added", { time: addedLabel(f.created_at) })}</Text>
        </View>
        <View style={[s.pill, issued ? s.pillIssued : s.pillPending]}>
          <Text style={[s.pillText, { color: issued ? "#15803D" : "#B45309" }]}>
            {issued ? t("job2.followups.issued") : t("job2.followups.pending")}
          </Text>
        </View>
      </View>

      <Text style={s.label}>{t("job2.followups.issue")}</Text>
      <Text style={s.value}>{f.issue}</Text>
      <Text style={s.label}>{t("job2.followups.action")}</Text>
      <Text style={s.value}>{f.required_action}</Text>

      {f.photos.length > 0 && (
        <View style={s.photos}>
          {f.photos.map((p) =>
            p.url ? (
              <Pressable key={p.media_id} onPress={() => setPreview(p.url)}>
                <Image source={{ uri: p.url }} style={s.photo} />
              </Pressable>
            ) : null,
          )}
        </View>
      )}

      {showJobOrderRequired && !issued && (
        <View style={s.amber}>
          <FontAwesome5 name="exclamation-circle" size={13} color="#B45309" />
          <Text style={s.amberText}>{t("job2.followups.jobOrderRequired")}</Text>
        </View>
      )}

      {issued && f.job_order && (
        <Pressable
          style={s.linkRow}
          onPress={() => onOpenJobOrder?.(f.job_order!.job_id)}
          disabled={!onOpenJobOrder}
        >
          <FontAwesome5 name="clipboard-list" size={13} color="#34873F" />
          <Text style={s.linkText} numberOfLines={2}>
            {t("job2.followups.issuedRow", {
              ref: f.job_order.ref_no ?? `#${f.job_order.job_id}`,
              name: f.job_order.issued_by ?? "—",
              time: f.job_order.issued_at ? formatDateTime(f.job_order.issued_at) : "—",
            })}
            {" · "}
            {t(`job2.state.${f.job_order.state}`)}
          </Text>
          {!!onOpenJobOrder && <FontAwesome5 name="chevron-right" size={11} color="#9CA3AF" />}
        </Pressable>
      )}

      {!!onRemove && !issued && (
        <Pressable style={s.remove} onPress={onRemove} hitSlop={6}>
          <FontAwesome5 name="trash-alt" size={12} color="#DC2626" />
          <Text style={s.removeText}>{t("job2.followups.remove")}</Text>
        </Pressable>
      )}

      <ImageViewerOverlay
        visible={!!preview}
        imageUrls={preview ? [{ url: preview }] : []}
        onClose={() => setPreview(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#F3F4F6", borderRadius: 14, padding: 14, backgroundColor: "#fff", marginTop: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFFBEB", alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 12, fontWeight: "800", color: "#B45309" },
  title: { fontSize: 15, fontWeight: "800", color: "#111827" },
  sub: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  pillPending: { backgroundColor: "#FFFBEB" },
  pillIssued: { backgroundColor: "#F0FDF4" },
  pillText: { fontSize: 11.5, fontWeight: "800" },
  label: { fontSize: 11, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.5, marginTop: 10 },
  value: { fontSize: 14, color: "#111827", marginTop: 3, lineHeight: 19 },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  photo: { width: 72, height: 72, borderRadius: 10, backgroundColor: "#F3F4F6" },
  amber: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  amberText: { flex: 1, fontSize: 12.5, color: "#92400E", lineHeight: 17 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#F0FDF4",
  },
  linkText: { flex: 1, fontSize: 12.5, color: "#14532D", fontWeight: "600" },
  remove: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", marginTop: 10 },
  removeText: { fontSize: 12.5, fontWeight: "800", color: "#DC2626" },
});
