import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AFTER_SLOTS, api, JobDetails, JobOrderEntry } from "../../api/client";
import { uploadVerificationSelfie } from "../../api/media";
import { useSession } from "../../ctx";
import { usePdfDownload } from "../../hooks/usePdfDownload";
import { useI18n } from "../../i18n/i18n-ctx";
import { formatBusLabel } from "../../utils/busLabel";
import { formatDateTime } from "../../utils/datetime";
import { formatElapsed, useElapsedMs } from "../../utils/elapsedTime";
import { buildJobProgress } from "../../utils/jobProgress";
import { roleColorsFor } from "../../utils/roles";
import ImageViewerOverlay from "../ImageViewerOverlay";
import JobTaskCard from "../JobTaskCard";
import JobTimeline from "../JobTimeline";
import SignoffSheet from "../SignoffSheet";
import StatusBadge from "../StatusBadge";
import { IssueJobOrdersSheet, SendBackSheet } from "./ApprovalSheets";
import FollowupCard from "./FollowupCard";

const SLOT_LABEL: Record<string, string> = {
  dashboard: "jobDetail.photoSlotDashboard",
  front: "jobDetail.photoSlotFront",
  back: "jobDetail.photoSlotBack",
  left: "jobDetail.photoSlotLeft",
  right: "jobDetail.photoSlotRight",
};

function priorityType(p?: string | null) {
  const s = String(p ?? "").toLowerCase();
  return (["low", "medium", "high", "critical"].includes(s) ? s : "medium") as any;
}

function Section({ title, icon, right, children }: { title: string; icon: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <View style={s.cardIcon}>
          <FontAwesome5 name={icon as any} size={13} color="#6B7280" />
        </View>
        <Text style={s.cardTitle}>{title}</Text>
        {right}
      </View>
      <View style={s.divider} />
      {children}
    </View>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  );
}

/**
 * The job, read only, for every role but the technician working on it:
 *   C8  R&M review (Send back / Approve job at the end)
 *   C11 the approved and closed job, with Download PDF
 *   C1  a technician's own completed job order
 *   C16–C17 Fleet Manager remarks on a closed job
 * Coloured for the viewer's role.
 */
export default function JobReviewView({ jobId }: { jobId: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const { dbUser } = useSession();
  const pdf = usePdfDownload();
  const color = roleColorsFor(dbUser?.user_role);

  const [d, setD] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // Approval: step 1 (job orders) -> step 2 (sign-off). Nothing is saved
  // until Sign & approve; cancelling the sign-off returns to step 1 intact.
  const [step1Open, setStep1Open] = useState(false);
  const [entries, setEntries] = useState<JobOrderEntry[] | null>(null);
  const [approveSignOpen, setApproveSignOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState<string | null>(null);
  const [sendingBack, setSendingBack] = useState(false);

  const [remarksText, setRemarksText] = useState("");
  const [editingRemarks, setEditingRemarks] = useState(false);
  const [savingRemarks, setSavingRemarks] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.jobDetails(jobId);
      setD(res);
      setRemarksText(res.job.fm_remarks?.text ?? "");
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [jobId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const progress = useMemo(() => (d ? buildJobProgress(d, t) : null), [d, t]);
  const pendingFollowups = useMemo(() => (d?.followups ?? []).filter((f) => f.status === "PENDING"), [d]);
  const issuedCount = (d?.followups ?? []).filter((f) => f.status === "JOB_ORDER_ISSUED").length;
  const clockStart = d ? (d.job.source === "FOLLOW_UP" ? d.job.issued_at : d.report.submitted_at) : null;
  const openMs = useElapsedMs(clockStart, d?.job.state === "closed" ? d.job.approved_at ?? d.job.completed_at : null);

  if (loading && !d) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!d) return null;

  const bus = formatBusLabel(d.bus.bus_id, d.bus.bus_ev_no);
  const ref = d.job.ref_no ?? `#${d.job.job_id}`;
  const state = d.job.state;

  const startApprove = () => {
    if (pendingFollowups.length) setStep1Open(true);
    else {
      setEntries([]);
      setApproveSignOpen(true);
    }
  };

  const doApprove = async ({ selfie, name }: { selfie: any; name: string }) => {
    setApproving(true);
    try {
      const key = await uploadVerificationSelfie("job-approve", jobId, selfie);
      await api.approveJob(jobId, { verified_name: name, selfie_s3_key: key, job_orders: entries ?? [] });
      setApproveSignOpen(false);
      setEntries(null);
      Alert.alert(t("job2.review.approved"));
      await load();
    } catch (e: any) {
      Alert.alert(t("job2.review.approveFailed"), e?.message ?? "");
      if (e?.code === "FOLLOWUPS_CHANGED" || e?.code === "JOB_NOT_AWAITING_APPROVAL" || e?.code === "JOB_ALREADY_CLOSED") {
        setApproveSignOpen(false);
        setEntries(null);
        await load();
      }
    } finally {
      setApproving(false);
    }
  };

  const doSendBack = async ({ selfie, name }: { selfie: any; name: string }) => {
    if (!sendBackReason) return;
    setSendingBack(true);
    try {
      const key = await uploadVerificationSelfie("job-sendback", jobId, selfie);
      await api.sendBackJob(jobId, { reason: sendBackReason, verified_name: name, selfie_s3_key: key });
      setSendBackReason(null);
      Alert.alert(t("job2.review.sentBack"));
      await load();
    } catch (e: any) {
      Alert.alert(t("job2.review.sendBackFailed"), e?.message ?? "");
    } finally {
      setSendingBack(false);
    }
  };

  const saveRemarks = async () => {
    const text = remarksText.trim();
    if (!text) return;
    setSavingRemarks(true);
    try {
      await api.saveFmRemarks(jobId, text);
      setEditingRemarks(false);
      Alert.alert(t("job2.remarks.saved"));
      await load();
    } catch (e: any) {
      Alert.alert(t("job2.remarks.failed"), e?.message ?? "");
    } finally {
      setSavingRemarks(false);
    }
  };

  const statePill =
    state === "closed"
      ? { bg: "#DCFCE7", fg: "#15803D", text: `✓ ${t("job2.state.closed")}` }
      : state === "pending_approval"
        ? { bg: "#FEF3C7", fg: "#92400E", text: t("job2.state.pending_approval") }
        : d.sent_back
          ? { bg: "#FEE2E2", fg: "#991B1B", text: t("job2.state.sentBack") }
          : { bg: "#F3F4F6", fg: "#374151", text: t(`job2.state.${state}`) };

  const remarks = d.job.fm_remarks;
  const showRemarksEditor = d.can.fm_remarks && (!remarks || editingRemarks);

  return (
    <>
      <ScrollView
        style={s.page}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {/* Title card */}
        <View style={s.card}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{d.job.source === "REPORT" ? t("job2.problemReportJob") : t("job2.jobOrder")}</Text>
              <Text style={s.ref}>{ref}</Text>
              <View style={[s.pill, { backgroundColor: statePill.bg }]}>
                <Text style={[s.pillText, { color: statePill.fg }]}>{statePill.text}</Text>
              </View>
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              {!!d.job.priority && <StatusBadge type={priorityType(d.job.priority)} size="sm" />}
              {openMs != null && (
                <View style={s.timePill}>
                  <Text style={s.timePillText}>{formatElapsed(openMs)}</Text>
                </View>
              )}
            </View>
          </View>
          <View style={s.busRow}>
            <FontAwesome5 name="bus" size={13} color={color.accent} />
            <Text style={[s.busText, { color: color.accent }]}>{bus}</Text>
            {!!d.bus.bus_model && <Text style={s.busModel}>{d.bus.bus_model}</Text>}
          </View>
          {!!d.report.location && d.job.source !== "FOLLOW_UP" && (
            <Text style={s.location}>
              <FontAwesome5 name="map-marker-alt" size={11} color="#6B7280" /> {d.report.location}
            </Text>
          )}
          {d.job.source === "FOLLOW_UP" && !!d.job.parent?.job_id && (
            <Pressable
              style={[s.pill, { backgroundColor: "#DCFCE7" }]}
              onPress={() => router.push(`/job/${d.job.parent!.job_id}` as any)}
            >
              <Text style={[s.pillText, { color: "#15803D" }]}>{t("job2.followUpFrom", { ref: d.job.parent.ref_no ?? "" })}</Text>
            </Pressable>
          )}
        </View>

        {!!d.sent_back && (
          <View style={s.redBox}>
            <Text style={s.redTitle}>{t("job2.sentBack.title")}</Text>
            <Text style={s.redBy}>
              {d.sent_back.by.name} {d.sent_back.by.username ? `@${d.sent_back.by.username}` : ""} · {formatDateTime(d.sent_back.at)}
            </Text>
            {!!d.sent_back.reason && <Text style={s.redReason}>{d.sent_back.reason}</Text>}
          </View>
        )}

        {/* Odometer */}
        <Section title={t("job2.odometer.title")} icon="tachometer-alt">
          <Text style={s.odo}>{d.job.odometer != null ? `${d.job.odometer.toLocaleString()} km` : "—"}</Text>
          {!!d.job.arrived_at && (
            <Text style={s.muted}>{t("job2.odometer.recordedOnArrival", { time: formatDateTime(d.job.arrived_at) })}</Text>
          )}
          {d.report.photos.filter((p) => p.kind === "cluster").map((p) =>
            p.url ? (
              <Pressable key={p.media_id} onPress={() => setPreview(p.url)}>
                <Image source={{ uri: p.url }} style={s.cluster} />
              </Pressable>
            ) : null,
          )}
        </Section>

        {/* Report, or the job order card */}
        {d.job.source === "FOLLOW_UP" ? (
          <Section title={t("job2.jobOrderCard.title")} icon="clipboard-list">
            <Field label={t("job2.jobOrderCard.issuedBy")} value={d.events.find((e) => e.type === "JOB_ORDER_ISSUED")?.by.name} />
            <Field label={t("job2.jobOrderCard.issue")} value={d.job.desc} />
            <Field label={t("job2.jobOrderCard.requiredAction")} value={d.job.required_action} />
            <Field label={t("job2.jobOrderCard.remarks")} value={d.job.remarks} />
            <View style={s.photoRow}>
              {(d.followup_origin?.photos ?? []).map((p) =>
                p.url ? (
                  <Pressable key={p.media_id} onPress={() => setPreview(p.url)}>
                    <Image source={{ uri: p.url }} style={s.thumb} />
                  </Pressable>
                ) : null,
              )}
            </View>
          </Section>
        ) : d.job.source === "REPORT" ? (
          <Section title={t("jobDetail.sectionInitialReport")} icon="file-alt">
            <Field label={t("job2.reportedBy")} value={[d.report.reporter.name, d.report.reporter.username ? `@${d.report.reporter.username}` : null].filter(Boolean).join("  ")} />
            <Field label={t("job2.jobOrderCard.priority")} value={d.report.priority} />
            <Field label={t("job2.jobOrderCard.issue")} value={d.report.desc} />
            <Field label={t("job2.category")} value={d.report.category ? `${d.report.category.no} · ${d.report.category.name}` : t("job2.categoryNotSet")} />
            <View style={s.photoRow}>
              {d.report.photos.filter((p) => p.kind !== "cluster").map((p) =>
                p.url ? (
                  <Pressable key={p.media_id} onPress={() => setPreview(p.url)}>
                    <Image source={{ uri: p.url }} style={s.thumb} />
                  </Pressable>
                ) : null,
              )}
            </View>
          </Section>
        ) : null}

        {/* Tasks */}
        <Section
          title={t("job2.tasks.title")}
          icon="tasks"
          right={<Text style={s.countPill}>{t("job2.tasks.count", { count: d.tasks.length })}</Text>}
        >
          {d.tasks.length === 0 ? (
            <Text style={s.muted}>{t("job2.tasks.empty")}</Text>
          ) : (
            d.tasks.map((x) => (
              <JobTaskCard
                key={x.task_id}
                jobId={jobId}
                editable={false}
                task={{
                  task_id: x.task_id,
                  task_name: x.name,
                  task_desc: x.work_done,
                  task_remark: x.remark,
                  task_job_type: x.job_type,
                  task_category: x.category?.key ?? null,
                  task_status: (x.status as any) ?? "done",
                  task_order: x.no,
                  completed_at: x.completed_at,
                }}
              />
            ))
          )}
        </Section>

        {/* Follow-ups */}
        <Section
          title={t("job2.followups.title")}
          icon="share-square"
          right={
            d.followups.length ? (
              <Text style={s.countPill}>
                {issuedCount
                  ? t("job2.followups.issuedCount", { count: issuedCount })
                  : t("job2.followups.pendingCount", { count: pendingFollowups.length })}
              </Text>
            ) : null
          }
        >
          {d.followups.length === 0 ? (
            <Text style={s.muted}>{t("job2.followups.empty")}</Text>
          ) : (
            d.followups.map((f, i) => (
              <FollowupCard
                key={f.followup_id}
                followup={f}
                n={i + 1}
                showJobOrderRequired={d.can.approve}
                onOpenJobOrder={(id) => router.push(`/job/${id}` as any)}
              />
            ))
          )}
        </Section>

        {/* Job Progress */}
        <Section title={t("job2.progress.title")} icon="stream">
          {progress && <JobTimeline events={progress.events} pendingStage={progress.pendingStage} />}
        </Section>

        {/* After photos */}
        <Section title={t("job2.afterPhotos.title")} icon="camera">
          <View style={s.slotGrid}>
            {AFTER_SLOTS.map((k) => {
              const ph = d.after_photos[k];
              return (
                <Pressable key={k} style={s.slot} onPress={() => ph?.url && setPreview(ph.url)} disabled={!ph?.url}>
                  {ph?.url ? <Image source={{ uri: ph.url }} style={s.slotImg} /> : <View style={[s.slotImg, s.slotEmpty]} />}
                  <Text style={s.slotLabel}>{t(SLOT_LABEL[k])}</Text>
                </Pressable>
              );
            })}
          </View>
          {d.after_photos_unslotted.length > 0 && (
            <View style={s.photoRow}>
              {d.after_photos_unslotted.map((p) =>
                p.url ? (
                  <Pressable key={p.media_id} onPress={() => setPreview(p.url)}>
                    <Image source={{ uri: p.url }} style={s.thumb} />
                  </Pressable>
                ) : null,
              )}
            </View>
          )}
        </Section>

        {/* C16–C17 Fleet Manager remarks */}
        {(state === "closed" && (remarks || d.can.fm_remarks)) && (
          <Section
            title={t("job2.remarks.title")}
            icon="comment-alt"
            right={remarks ? <Text style={s.countPill}>{remarks.edited_at ? t("job2.remarks.edited") : t("job2.remarks.added")}</Text> : null}
          >
            {showRemarksEditor ? (
              <>
                <TextInput
                  value={remarksText}
                  onChangeText={setRemarksText}
                  placeholder={t("job2.remarks.placeholder")}
                  placeholderTextColor="#9CA3AF"
                  style={s.remarksInput}
                  multiline
                  maxLength={500}
                />
                <Text style={s.counter}>{remarksText.trim().length} / 500</Text>
                <Pressable
                  style={[s.btn, { backgroundColor: "#2563EB" }, (!remarksText.trim() || savingRemarks) && { opacity: 0.45 }]}
                  disabled={!remarksText.trim() || savingRemarks}
                  onPress={saveRemarks}
                >
                  <Text style={s.btnText}>{savingRemarks ? "…" : t("job2.remarks.save")}</Text>
                </Pressable>
              </>
            ) : remarks ? (
              <View style={s.blueBox}>
                <Text style={s.blueText}>{remarks.text}</Text>
                <Text style={s.blueBy}>
                  {remarks.name} {remarks.username ? `@${remarks.username}` : ""} · {formatDateTime(remarks.at)}
                  {remarks.edited_at ? ` · ${t("job2.remarks.editedAt", { time: formatDateTime(remarks.edited_at) })}` : ""}
                </Text>
                {d.can.fm_remarks && (
                  <Pressable onPress={() => setEditingRemarks(true)} style={{ marginTop: 8 }}>
                    <Text style={s.link}>{t("job2.remarks.edit")}</Text>
                  </Pressable>
                )}
              </View>
            ) : null}
          </Section>
        )}

        {d.job.pdf_ready && (
          <Pressable
            style={[s.btn, { backgroundColor: color.accent }, pdf.busy && { opacity: 0.6 }]}
            disabled={pdf.busy}
            onPress={() => pdf.run(() => api.jobReportPdf(jobId))}
          >
            <FontAwesome5 name="file-pdf" size={14} color="#fff" />
            <Text style={s.btnText}>{pdf.busy ? t("pdf.preparing") : t("job2.downloadPdf")}</Text>
          </Pressable>
        )}

        {/* C8 actions, at the end of the content (not floating) */}
        {d.can.approve && (
          <View style={{ gap: 10 }}>
            <Text style={s.hint}>{t("job2.review.hint")}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable style={[s.btn, s.btnOutlineRed, { flex: 1 }]} onPress={() => setSendBackOpen(true)}>
                <FontAwesome5 name="undo" size={13} color="#DC2626" />
                <Text style={[s.btnText, { color: "#DC2626" }]}>{t("job2.review.sendBack")}</Text>
              </Pressable>
              <Pressable style={[s.btn, { backgroundColor: "#34873F", flex: 1.4 }]} onPress={startApprove}>
                <FontAwesome5 name="check" size={13} color="#fff" />
                <Text style={s.btnText}>{t("job2.review.approve")}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      <IssueJobOrdersSheet
        visible={step1Open}
        followups={pendingFollowups}
        busLabel={bus}
        initial={entries}
        onClose={() => {
          setStep1Open(false);
          setEntries(null);
        }}
        onNext={(e) => {
          setEntries(e);
          setStep1Open(false);
          setApproveSignOpen(true);
        }}
      />
      <SignoffSheet
        visible={approveSignOpen}
        verb="approving"
        action={
          entries?.length
            ? t("job2.review.aboutWithOrders", { count: entries.length })
            : t("job2.review.aboutNoOrders")
        }
        detail={`${ref} · ${bus}`}
        submitting={approving}
        onCancel={() => {
          if (approving) return;
          setApproveSignOpen(false);
          // Cancel returns to step 1 with everything kept.
          if (entries?.length) setStep1Open(true);
        }}
        onConfirm={doApprove}
      />

      <SendBackSheet
        visible={sendBackOpen}
        technician={d.job.technician}
        onClose={() => setSendBackOpen(false)}
        onNext={(reason) => {
          setSendBackOpen(false);
          setSendBackReason(reason);
        }}
      />
      <SignoffSheet
        visible={sendBackReason != null}
        verb="sendingBack"
        action={t("job2.review.sendBackAbout")}
        detail={`${ref} · ${bus}`}
        submitting={sendingBack}
        onCancel={() => !sendingBack && setSendBackReason(null)}
        onConfirm={doSendBack}
      />

      <ImageViewerOverlay visible={!!preview} imageUrls={preview ? [{ url: preview }] : []} onClose={() => setPreview(null)} />
    </>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: "#fff", borderRadius: 20, borderWidth: 1, borderColor: "#F3F4F6", padding: 16 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  cardTitle: { flex: 1, fontSize: 15.5, fontWeight: "800", color: "#111827" },
  divider: { height: 1, backgroundColor: "#F3F4F6", marginVertical: 12 },
  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
  ref: { fontSize: 12.5, fontWeight: "800", color: "#6B7280", marginTop: 2 },
  pill: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: "800" },
  timePill: {
    width: 112,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  timePillText: { fontSize: 12, fontWeight: "700", color: "#C2410C", fontVariant: ["tabular-nums"] },
  busRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 12 },
  busText: { fontSize: 15, fontWeight: "800" },
  busModel: { fontSize: 13, color: "#6B7280" },
  location: { fontSize: 13, color: "#4B5563", marginTop: 6 },
  redBox: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FCA5A5", borderRadius: 16, padding: 14 },
  redTitle: { fontSize: 15, fontWeight: "800", color: "#991B1B" },
  redBy: { fontSize: 12.5, color: "#7F1D1D", marginTop: 4 },
  redReason: { fontSize: 14, color: "#111827", fontWeight: "700", marginTop: 6 },
  odo: { fontSize: 22, fontWeight: "800", color: "#111827" },
  muted: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  cluster: { width: "100%", height: 160, borderRadius: 12, marginTop: 10, backgroundColor: "#F3F4F6" },
  fieldLabel: { fontSize: 11, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.5 },
  fieldValue: { fontSize: 14, color: "#111827", marginTop: 2, lineHeight: 19 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  thumb: { width: 76, height: 76, borderRadius: 10, backgroundColor: "#F3F4F6" },
  countPill: {
    fontSize: 11.5,
    fontWeight: "800",
    color: "#374151",
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
  },
  slotGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  slot: { width: "47%" },
  slotImg: { width: "100%", aspectRatio: 4 / 3, borderRadius: 10, backgroundColor: "#F3F4F6" },
  slotEmpty: { borderWidth: 1, borderStyle: "dashed", borderColor: "#D1D5DB" },
  slotLabel: { fontSize: 12, fontWeight: "700", color: "#374151", marginTop: 4, textAlign: "center" },
  remarksInput: {
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 12,
    padding: 12,
    minHeight: 96,
    fontSize: 14,
    color: "#111827",
    textAlignVertical: "top",
  },
  counter: { fontSize: 12, color: "#6B7280", textAlign: "right", marginTop: 4 },
  blueBox: { backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#BFDBFE" },
  blueText: { fontSize: 14, color: "#1E3A8A", lineHeight: 20 },
  blueBy: { fontSize: 12, color: "#3B82F6", marginTop: 6 },
  link: { fontSize: 13, fontWeight: "800", color: "#2563EB" },
  hint: { fontSize: 12.5, color: "#6B7280", textAlign: "center" },
  btn: {
    height: 50,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnOutlineRed: { borderWidth: 1.5, borderColor: "#DC2626", backgroundColor: "#fff" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
