import { FontAwesome5 } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import type { AfterSlot, JobDetails, JobMedia, PartUnit, ReportMedia } from "@/api/client";
import { AFTER_SLOTS, AFTER_SLOTS_ALL, api } from "@/api/client";
import { uploadJobKindPhoto, uploadVerificationSelfie } from "@/api/media";
import FollowupCard from "@/components/job/FollowupCard";
import FollowupEditorCard, { type FollowupDraft } from "@/components/job/FollowupEditorCard";
import LateUpdateCard from "@/components/job/LateUpdateCard";
import { buildJobProgress } from "@/utils/jobProgress";
import { formatElapsed, useElapsedMs } from "@/utils/elapsedTime";
import { formatDateTime } from "@/utils/datetime";
import AfterPhotoSlots from "@/components/AfterPhotoSlots";
import BusDetailsModal from "@/components/BusDetailsModal";
import type { LocalMedia } from "@/components/ImagePicker";
import TaskEditorCard, { emptyTaskDraft, taskDraftProblem, taskNameFor, type TaskDraft } from "@/components/TaskEditorCard";
import { busSystemLabel } from "@/utils/busSystems";
import ImageViewerOverlay from "@/components/ImageViewerOverlay";
import PhotoStrip, { PhotoIndexBadge } from "@/components/PhotoStrip";
import InstrumentClusterIcon from "@/components/icons/InstrumentClusterIcon";
import JobTaskCard from "@/components/JobTaskCard";
import JobTimeline, { TimelineEvent } from "@/components/JobTimeline";
import type { StatusType } from "@/components/StatusBadge";
import StatusBadge from "@/components/StatusBadge";
import SignoffSheet from "@/components/SignoffSheet";
import { useI18n } from "@/i18n/i18n-ctx";
import { openDirections } from "@/utils/directions";
import { computeJobPendingStage } from "@/utils/jobPendingStage";
import { buildJobTimelineEvents, ODOMETER_TASK_NAME } from "@/utils/jobSignoffs";
import { formatBusLabel } from "@/utils/busLabel";
import { reportTypeTitleLabel } from "@/utils/reportType";
import { usePdfDownload } from "@/hooks/usePdfDownload";
import { KEYBOARD_DONE_ID } from "@/components/KeyboardDone";

type TaskStatus = "pending" | "in_progress" | "blocked" | "done";

// This task is auto-created by the backend the moment the initial odometer
// reading is saved (see upsertOdometerRecordedTask in the lambda) — it's a
// bookkeeping row, not a real repair task, so it's surfaced only in the
// timeline and excluded from the Tasks list.

// Completing a job requires an after photo of the instrument cluster
// (dashboard) and one of the front of the bus: the 2 fixed slots shown in
// the "After Photos" section. Built from translations (like
// buildPriorityOptions in form.tsx) since the labels need to switch with
// the selected language.
type AfterPhotoSlot = "dashboard" | "front";
function buildAfterPhotoSlots(
  t: (key: string) => string,
): { key: AfterPhotoSlot; label: string; icon?: string; iconElement?: React.ReactNode }[] {
  return [
    {
      key: "dashboard",
      label: t("jobDetail.photoSlotDashboard"),
      iconElement: <InstrumentClusterIcon size={18} color="#9CA3AF" />,
    },
    { key: "front", label: t("jobDetail.photoSlotFront"), icon: "arrow-up" },
  ];
}

type JobListItem = {
  job_ref_no?: string | null;
  job_id: number;
  job_desc: string | null;
  job_status: string;
  technician_user_id: number | null;
  job_created_at?: string | null;
  job_accepted_at?: string | null;
  job_completed_at?: string | null;
  job_odometer?: number | null;
  report_id: number | null;
  report_type: string | null;
  report_priority: string | null;
  bus_id: string | null;
  bus_ev_no?: string | null;
  reporter_name: string | null;
  technician_name?: string | null;
  job_verified_name?: string | null;
  job_selfie_view_url?: string | null;
  job_accept_verified_name?: string | null;
  job_accept_selfie_view_url?: string | null;
};

type ReportDto = {
  report_id: number;
  report_type: string;
  report_desc?: string | null;
  report_location?: string | null;
  report_lat?: number | null;
  report_lng?: number | null;
  report_priority?: string | null;
  bus_id?: string | null;
  report_uploaded_at?: string | null;
  reporter_name?: string | null;
  reporter_email?: string | null;
  report_review_by?: string | null;
  report_verified_name?: string | null;
  report_selfie_view_url?: string | null;
  report_review_verified_name?: string | null;
  report_review_selfie_view_url?: string | null;
};

type JobTask = {
  task_id: number;
  job_id: number;
  task_name: string;
  task_desc: string | null;
  task_status: TaskStatus;
  task_order: number;
  completed_at?: string | null;
};

// Brand · how many are in stock. No price: technicians don't need it, so
// it's shown only in Parts Admin.
type PartRow = {
  part_id: number;
  part_name: string;
  part_code: string;
  part_brand?: string | null;
  part_unit?: PartUnit | null;
  part_cost: number | string | null;
  part_stock: number | null;
};

const MAX_ODOMETER = 9_999_999;

function toLower(x: unknown) {
  return String(x ?? "")
    .trim()
    .toLowerCase();
}
function normalisePriority(x: unknown): StatusType {
  const v = toLower(x);
  if (v === "low" || v === "medium" || v === "high" || v === "critical")
    return v;
  return "medium";
}
const isNonEmptyString = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;
function guessMimeFromUrl(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value || "—"}</Text>
    </View>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.cardIconBox}>
          <FontAwesome5 name={icon as any} size={13} color="#6B7280" />
        </View>
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      <View style={s.cardDivider} />
      {children}
    </View>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function TechnicianJobDetailsScreen() {
  const router = useRouter();
  const { id, mode } = useLocalSearchParams<{
    id: string;
    mode?: "view" | "edit";
  }>();
  const canEdit = mode !== "view";
  const jobId = useMemo(() => Number(id), [id]);
  const { t } = useI18n();
  const pdf = usePdfDownload();
  const afterPhotoSlotDefs = useMemo(() => buildAfterPhotoSlots(t), [t]);

  const scrollRef = useRef<ScrollView>(null);
  const odometerInputRef = useRef<TextInput>(null);

  const [loading, setLoading] = useState(false);
  const [jobSummary, setJobSummary] = useState<JobListItem | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [tasks, setTasks] = useState<JobTask[]>([]);

  // The task being written in "Add task" (see TaskEditorCard).
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(emptyTaskDraft);
  const [savingTask, setSavingTask] = useState(false);

  const [parts, setParts] = useState<PartRow[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);

  const [odometerInput, setOdometerInput] = useState("");
  const [savingOdometer, setSavingOdometer] = useState(false);

  // Pre-v2 staging; after photos now upload as they are taken (onAfterSlotPicked).
  const [afterPhotoSlots] = useState<Record<AfterPhotoSlot, LocalMedia[]>>({
    dashboard: [],
    front: [],
  });
  const [reportPhotoUrls, setReportPhotoUrls] = useState<string[]>([]);
  const [loadingReportPhotos, setLoadingReportPhotos] = useState(false);

  const [afterPhotoUrls, setAfterPhotoUrls] = useState<string[]>([]);
  const [afterPhotosUploadedAt, setAfterPhotosUploadedAt] = useState<string | null>(null);
  const [, setLoadingAfterPhotos] = useState(false);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [afterViewerVisible, setAfterViewerVisible] = useState(false);
  const [afterViewerIndex, setAfterViewerIndex] = useState(0);
  const [busDetailsVisible, setBusDetailsVisible] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [verifyVisible, setVerifyVisible] = useState(false);

  // v2.0.0: the job's state, follow-ups, Job Progress events, after-photo
  // slots, send-back and late-arrival state, from GET /jobs/{id}/details.
  const [details, setDetails] = useState<JobDetails | null>(null);
  const [savingFollowup, setSavingFollowup] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<AfterSlot | null>(null);

  const viewerUrls = useMemo(
    () => reportPhotoUrls.map((u) => ({ url: u })),
    [reportPhotoUrls],
  );

  const afterViewerUrls = useMemo(
    () => afterPhotoUrls.map((u) => ({ url: u })),
    [afterPhotoUrls],
  );

  const hasOdometer = useMemo(() => {
    const v = jobSummary?.job_odometer;
    return typeof v === "number" && Number.isFinite(v);
  }, [jobSummary?.job_odometer]);

  const jobLocked = canEdit && !hasOdometer;

  const scrollToOdometerAndFocus = () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    setTimeout(() => odometerInputRef.current?.focus(), 300);
  };

  const handleOdometerRequired = () => {
    Alert.alert(
      t("jobDetail.odometerRequiredTitle"),
      t("jobDetail.odometerRequiredFullMessage"),
    );
    scrollToOdometerAndFocus();
  };

  const handleApiError = (e: unknown, fallbackTitle = t("common.error")) => {
    const err = e as { code?: string; message?: string };
    if (err?.code === "ODOMETER_REQUIRED") {
      handleOdometerRequired();
      return;
    }
    if (err?.code === "ODOMETER_CHECK") {
      const last = (err as { body?: { last_odometer?: number | null } }).body?.last_odometer;
      Alert.alert(
        t("job2.odometer.check"),
        last != null ? t("job2.odometer.checkLast", { km: Number(last).toLocaleString() }) : t("job2.odometer.check"),
      );
      scrollToOdometerAndFocus();
      return;
    }
    if (err?.code === "JOB_NOT_ACCEPTED") {
      Alert.alert(
        t("jobDetail.jobNotAcceptedTitle"),
        t("jobDetail.jobNotAcceptedMessage"),
      );
      return;
    }
    Alert.alert(fallbackTitle, err?.message ?? t("common.unknownError"));
  };

  const openViewer = (index: number) => {
    if (!reportPhotoUrls.length) return;
    setViewerIndex(Math.min(Math.max(index, 0), reportPhotoUrls.length - 1));
    setViewerVisible(true);
  };

  const openAfterViewer = (index: number) => {
    if (!afterPhotoUrls.length) return;
    setAfterViewerIndex(
      Math.min(Math.max(index, 0), afterPhotoUrls.length - 1),
    );
    setAfterViewerVisible(true);
  };

  const loadReportPhotos = async (reportId: number) => {
    if (!Number.isFinite(reportId) || reportId <= 0) return;
    setLoadingReportPhotos(true);
    try {
      const media = (await api.listReportMedia(reportId)) as ReportMedia[];
      const urls = (Array.isArray(media) ? media : [])
        .map((m) => m?.viewUrl ?? null)
        .filter(isNonEmptyString);
      setReportPhotoUrls(Array.from(new Set(urls)));
    } catch {
      setReportPhotoUrls([]);
    } finally {
      setLoadingReportPhotos(false);
    }
  };

  const loadAfterPhotos = async (jId: number) => {
    if (!Number.isFinite(jId) || jId <= 0) return;
    setLoadingAfterPhotos(true);
    try {
      const media = (await api.listJobMedia(jId, {
        untaggedOnly: true,
      })) as JobMedia[];
      const list = Array.isArray(media) ? media : [];
      const urls = list.map((m) => m?.viewUrl ?? null).filter(isNonEmptyString);
      setAfterPhotoUrls(Array.from(new Set(urls)));

      // Latest upload timestamp stands in for "after photos taken" in the
      // timeline — there's no dedicated event for this on the backend.
      const latest = list
        .map((m) => m?.uploaded_at)
        .filter((d): d is string => !!d)
        .sort()
        .pop();
      setAfterPhotosUploadedAt(latest ?? null);
    } catch {
      setAfterPhotoUrls([]);
      setAfterPhotosUploadedAt(null);
    } finally {
      setLoadingAfterPhotos(false);
    }
  };

  const loadParts = async () => {
    setLoadingParts(true);
    try {
      const rows = (await api.parts()) as PartRow[];
      setParts(Array.isArray(rows) ? rows : []);
    } catch (e: unknown) {
      handleApiError(e, t("jobDetail.failedToLoadParts"));
      setParts([]);
    } finally {
      setLoadingParts(false);
    }
  };

  const loadDetails = async () => {
    try {
      setDetails(await api.jobDetails(jobId));
    } catch {
      // A Lambda without /details yet: the screen falls back to the old view.
      setDetails(null);
    }
  };

  const fetchAll = async () => {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    setLoading(true);
    try {
      // Fetched by id — scanning the project's list missed older jobs.
      const allJobs = (await api.listJobs({ job_id: jobId })) as JobListItem[];
      const found = (Array.isArray(allJobs) ? allJobs : []).find(
        (j) => Number(j.job_id) === jobId,
      );
      setJobSummary(found ?? null);
      const od = found?.job_odometer;
      if (od != null && Number.isFinite(Number(od)))
        setOdometerInput(String(od));
      else setOdometerInput("");
      if (found?.report_id) {
        const r = (await api.getReport(found.report_id)) as ReportDto;
        setReport(r ?? null);
        setReportPhotoUrls([]);
        loadReportPhotos(found.report_id);
      } else {
        setReport(null);
        setReportPhotoUrls([]);
      }
      const t = (await api.listJobTasks(jobId)) as JobTask[];
      setTasks(Array.isArray(t) ? t : []);
      setAfterPhotoUrls([]);
      loadAfterPhotos(jobId);
      await loadDetails();
    } catch (e: unknown) {
      handleApiError(e, t("jobDetail.failedToLoadJob"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    loadParts();
  }, [jobId]);

  const doSaveOdometer = async (n: number, confirmHigh = false) => {
    setSavingOdometer(true);
    try {
      await api.patchJob(jobId, confirmHigh ? { job_odometer: n, confirm_high: true } : { job_odometer: n });
      // Saving the odometer also creates a "Recorded odometer reading" task
      // server-side and unlocks the rest of the job — refetch everything
      // rather than just patching jobSummary locally, so that task shows up
      // immediately instead of only after leaving and re-entering the page.
      await fetchAll();
      Alert.alert(t("common.saved"), t("jobDetail.odometerSavedMessage"));
    } catch (e: unknown) {
      // More than 2,000 km past the bus's last reading: allowed once the
      // technician says it is right.
      const err = e as { code?: string; body?: { last_odometer?: number | null } };
      if (err?.code === "ODOMETER_HIGH" && !confirmHigh) {
        const last = Number(err.body?.last_odometer ?? 0);
        Alert.alert(
          t("job2.odometer.highTitle"),
          t("job2.odometer.highBody", {
            value: n.toLocaleString(),
            last: last.toLocaleString(),
            diff: (n - last).toLocaleString(),
          }),
          [
            { text: t("job2.odometer.highEdit"), style: "cancel", onPress: scrollToOdometerAndFocus },
            { text: t("job2.odometer.highConfirm"), onPress: () => doSaveOdometer(n, true) },
          ],
        );
        return;
      }
      handleApiError(e, t("jobDetail.failedToSaveOdometer"));
    } finally {
      setSavingOdometer(false);
    }
  };

  const saveOdometer = () => {
    if (!canEdit) return;
    const raw = odometerInput.trim();
    if (!raw) {
      Alert.alert(
        t("jobDetail.odometerRequiredTitle"),
        t("jobDetail.odometerRequiredMessage"),
      );
      scrollToOdometerAndFocus();
      return;
    }
    // Digits only — rejects things like "1e5", "0x10", "12,345", decimals,
    // and negative signs that `Number()` would otherwise happily parse.
    if (!/^\d+$/.test(raw)) {
      Alert.alert(
        t("jobDetail.invalidOdometerTitle"),
        t("jobDetail.invalidOdometerDigitsMessage"),
      );
      scrollToOdometerAndFocus();
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n > MAX_ODOMETER) {
      Alert.alert(
        t("jobDetail.invalidOdometerTitle"),
        t("jobDetail.invalidOdometerRangeMessage", { max: MAX_ODOMETER.toLocaleString() }),
      );
      scrollToOdometerAndFocus();
      return;
    }
    Alert.alert(
      t("jobDetail.saveOdometer"),
      t("jobDetail.saveOdometerConfirmMessage", { value: n.toLocaleString() }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.save"), style: "default", onPress: () => doSaveOdometer(n) },
      ],
    );
  };

  const doCreateTask = async () => {
    const d = taskDraft;
    setSavingTask(true);
    try {
      const nextOrder = tasks.length
        ? Math.max(...tasks.map((x) => x.task_order ?? 0)) + 1
        : 1;
      const created = await api.createJobTask(jobId, {
        task_name: taskNameFor(d),
        task_job_type: d.jobType,
        task_category: d.category,
        task_desc: d.workDone.trim(),
        task_no_parts: d.noParts,
        task_status: "done",
        task_order: nextOrder,
      });
      const taskId = Number((created as { task_id?: number }).task_id);

      const partEntries = Object.entries(d.parts)
        .map(([k, qty]) => ({ part_id: Number(k), qty: Number(qty) }))
        .filter((x) => Number.isFinite(x.part_id) && x.part_id > 0 && x.qty > 0);
      if (taskId && partEntries.length) {
        for (const p of partEntries) await api.addTaskPart(taskId, { part_id: p.part_id, qty: p.qty });
      }

      if (taskId && d.photos.length) {
        try {
          await uploadAfterPhotos(jobId, d.photos, taskId);
        } catch (e: unknown) {
          // The task itself was created fine — a photo upload hiccup
          // shouldn't look like the whole action failed.
          handleApiError(e, t("jobDetail.taskAddedButPhotosFailed"));
          await fetchAll();
          return;
        }
      }

      setTaskDraft(emptyTaskDraft());
      await fetchAll();
    } catch (e: unknown) {
      handleApiError(e, t("jobDetail.failedToAddTask"));
    } finally {
      setSavingTask(false);
    }
  };

  const createTask = () => {
    if (!canEdit) return;
    if (jobLocked) {
      handleOdometerRequired();
      return;
    }
    // Every task needs the full record (it is printed on the Job Completion
    // Report): issue, work done, parts or "no parts used", and a photo.
    const problem = taskDraftProblem(taskDraft, t);
    if (problem) {
      Alert.alert(t("taskEditor.incompleteTitle"), problem);
      return;
    }
    const issueText =
      taskDraft.jobType === "maintenance"
        ? `${t("taskEditor.type_maintenance")} · ${busSystemLabel(taskDraft.category, t)}`
        : taskDraft.issue.trim();
    const photoNote = t("jobDetail.photoNote", { count: taskDraft.photos.length });
    Alert.alert(
      t("jobDetail.addTaskButton"),
      t("jobDetail.addTaskConfirmMessage", { issue: issueText, photoNote }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("jobDetail.addTaskButton"),
          style: "default",
          onPress: doCreateTask,
        },
      ],
    );
  };

  // The odometer-recorded row is bookkeeping, not a real task — it's shown
  // only in the timeline, never in the Tasks list.
  const visibleTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.task_name !== ODOMETER_TASK_NAME)
        .slice()
        .sort((a, b) => (a.task_order ?? 0) - (b.task_order ?? 0)),
    [tasks],
  );

  const completedTasks = useMemo(
    () => visibleTasks.filter((t) => t.task_status === "done"),
    [visibleTasks],
  );

  const afterMedia = useMemo(
    () => afterPhotoSlotDefs.flatMap((s) => afterPhotoSlots[s.key]),
    [afterPhotoSlotDefs, afterPhotoSlots],
  );

  const timelineEvents = useMemo<TimelineEvent[]>(
    () => buildJobTimelineEvents({ job: jobSummary, report, tasks, afterPhotosUploadedAt, t }),
    [report, jobSummary, tasks, afterPhotosUploadedAt, t],
  );

  const legacyPendingStage = useMemo(
    () => computeJobPendingStage(jobSummary, visibleTasks, t),
    [jobSummary, visibleTasks, t],
  );

  const progress = useMemo(() => (details ? buildJobProgress(details, t) : null), [details, t]);
  const state = details?.job.state ?? null;
  const isTechOrder = details?.job.source === "TECH_ORDER";
  const isFollowUpOrder = details?.job.source === "FOLLOW_UP";
  // Tasks, follow-ups and after photos can change only while the job is in
  // progress (arrived, or sent back) and it is this technician's.
  const workOpen = canEdit && (details ? details.can.edit : hasOdometer);
  // Before the odometer is saved only the title, odometer, report and Job
  // Progress show (C3); everything else unlocks after Save Odometer.
  const showWork = !canEdit || hasOdometer;
  const filledSlots = useMemo(
    () => AFTER_SLOTS.filter((k) => !!details?.after_photos?.[k]),
    [details],
  );
  const refLabel = details?.job.ref_no ?? jobSummary?.job_ref_no ?? `#${jobId}`;
  const lateMs = useElapsedMs(state === "accepted" && details?.late.late ? details.late.accepted_at : null);

  const uploadAfterPhotos = async (
    jId: number,
    media: LocalMedia[],
    taskId?: number,
  ) => {
    for (const m of media) {
      const presign = await api.presignJobMedia(
        jId,
        m.mime_type,
        taskId != null ? { taskId } : undefined,
      );
      const blob = await (await fetch(m.localUri)).blob();
      const put = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": m.mime_type },
        body: blob,
      });
      if (!put.ok) throw new Error(`Photo upload failed (${put.status})`);
      await api.confirmJobMedia(jId, {
        s3_key: presign.s3_key,
        mime_type: m.mime_type,
        size_bytes: blob.size,
        ...(taskId != null ? { task_id: taskId } : {}),
      });
    }
  };

  // What has already reached the server during this completion attempt, so a
  // retry after a part-way failure doesn't upload the selfie or any after
  // photo a second time (they used to show up twice).
  const completionProgress = useRef<{ selfieUri: string | null; selfieName: string | null; photoUris: Set<string> }>({
    selfieUri: null,
    selfieName: null,
    photoUris: new Set(),
  });

  const doCompleteJob = async (selfie: LocalMedia, verifiedName: string) => {
    const reportId = jobSummary?.report_id ?? null;
    const progress = completionProgress.current;
    setCompleting(true);
    try {
      // Identity-verification selfie — a dedicated presign/confirm pair that
      // writes straight onto the JOB row, separate from the after-photo
      // gallery uploaded below.
      if (progress.selfieUri !== selfie.localUri || progress.selfieName !== verifiedName) {
        try {
          const presign = await api.presignJobSelfie(jobId, selfie.mime_type);
          const blob = await (await fetch(selfie.localUri)).blob();
          const put = await fetch(presign.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": selfie.mime_type },
            body: blob,
          });
          if (!put.ok) throw new Error(`Selfie upload failed (${put.status})`);
          await api.confirmJobSelfie(jobId, {
            s3_key: presign.s3_key,
            mime_type: selfie.mime_type,
            size_bytes: blob.size,
            verified_name: verifiedName,
          });
          progress.selfieUri = selfie.localUri;
          progress.selfieName = verifiedName;
        } catch (e: unknown) {
          handleApiError(e, t("verification.failedToVerify"));
          return;
        }
      }

      try {
        for (const m of afterMedia) {
          if (progress.photoUris.has(m.localUri)) continue;
          await uploadAfterPhotos(jobId, [m]);
          progress.photoUris.add(m.localUri);
        }
      } catch (e: unknown) {
        handleApiError(e, t("jobDetail.failedToUploadAfterPhotos"));
        return;
      }

      // Closes the linked report too, server-side and in the same step, so a
      // job can no longer end up closed with its report left Open. Safe to
      // repeat if the first attempt's response was lost.
      try {
        await api.updateJobStatus(jobId, { to_status: "closed" });
      } catch (e: unknown) {
        handleApiError(e, t("jobDetail.failedToCloseJob"));
        return;
      }

      setVerifyVisible(false);
      Alert.alert(
        t("jobDetail.jobCompleted"),
        reportId ? "Job and report have been closed." : "Job has been closed.",
      );
      router.back();
    } finally {
      setCompleting(false);
    }
  };

  // The after-photo slots as they are on the server.
  const slotValue = useMemo(() => {
    const out = {} as Record<AfterSlot, LocalMedia[]>;
    for (const k of AFTER_SLOTS) {
      const ph = details?.after_photos?.[k];
      out[k] = ph?.url ? [{ localUri: ph.url, mime_type: ph.mime_type || "image/jpeg" }] : [];
    }
    return out;
  }, [details]);

  const onAfterSlotPicked = async (slot: AfterSlot, next: LocalMedia[]) => {
    const item = next[next.length - 1];
    if (!item || !workOpen) return;
    setUploadingSlot(slot);
    try {
      await uploadJobKindPhoto(jobId, "after", item, slot);
      await loadDetails();
    } catch (e: unknown) {
      handleApiError(e, t("job2.afterPhotos.failed"));
    } finally {
      setUploadingSlot(null);
    }
  };

  const saveFollowup = async (d: FollowupDraft): Promise<boolean> => {
    setSavingFollowup(true);
    try {
      const keys: string[] = [];
      for (const p of d.photos) keys.push(await uploadJobKindPhoto(jobId, "followup", p));
      await api.addFollowup(jobId, { issue: d.issue, required_action: d.action, photo_keys: keys });
      await loadDetails();
      return true;
    } catch (e: unknown) {
      handleApiError(e, t("job2.followups.saveFailed"));
      return false;
    } finally {
      setSavingFollowup(false);
    }
  };

  const removeFollowup = (followupId: number) => {
    Alert.alert(t("job2.followups.removeConfirmTitle"), t("job2.followups.removeConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("job2.followups.remove"),
        style: "destructive",
        onPress: async () => {
          try {
            await api.removeFollowup(followupId);
            await loadDetails();
          } catch (e: unknown) {
            handleApiError(e);
          }
        },
      },
    ]);
  };

  // C3: names the first missing item; null when Complete Job can run.
  const completeHint = !details
    ? null
    : completedTasks.length === 0
      ? t("job2.complete.needTask")
      : filledSlots.length < AFTER_SLOTS.length
        ? t("job2.complete.needPhotos", { n: filledSlots.length })
        : null;

  // v2.0.0 Complete Job: sign-off, then pending_approval and the R&M Managers
  // are asked to approve. A technician's own job order still closes on submit
  // through the older path.
  const doCompleteJobV2 = async (selfie: LocalMedia, verifiedName: string) => {
    setCompleting(true);
    try {
      const key = await uploadVerificationSelfie("job-complete", jobId, selfie);
      await api.completeJob(jobId, { verified_name: verifiedName, selfie_s3_key: key });
      setVerifyVisible(false);
      Alert.alert(t("jobDetail.jobCompleted"), t("job2.complete.done"));
      await fetchAll();
    } catch (e: unknown) {
      handleApiError(e, t("job2.complete.failed"));
    } finally {
      setCompleting(false);
    }
  };

  const reportPhotoMedia: LocalMedia[] = useMemo(
    () =>
      reportPhotoUrls.map((u) => ({
        localUri: u,
        mime_type: guessMimeFromUrl(u),
      })),
    [reportPhotoUrls],
  );

  const hasLocation = report?.report_lat != null && report?.report_lng != null;

  return (
    <>
      <Stack.Screen options={{ title: "Job Details" }} />

      <KeyboardAwareScrollView
          ref={scrollRef}
          bottomOffset={24}
          style={s.page}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
        >
          {/* ── Hero ── */}
          <View style={s.hero}>
            <View style={s.heroTop}>
              <View style={s.heroLeft}>
                <Text style={s.heroId}>
                  {details
                    ? details.job.source === "REPORT"
                      ? t("job2.problemReportJob")
                      : t("job2.jobOrder")
                    : jobSummary?.report_type === "job_order"
                      ? `${t("jobOrder.title")} #${jobId}`
                      : `${reportTypeTitleLabel(jobSummary?.report_type, t)} Job #${jobId}`}
                </Text>
                {/* C3: one SKSC-JCR reference from submit on. */}
                {!!details?.job.ref_no && <Text style={v2.ref}>{details.job.ref_no}</Text>}
                {!!state && (
                  <View
                    style={[
                      v2.statePill,
                      details?.sent_back
                        ? v2.pillRed
                        : state === "pending_approval"
                          ? v2.pillAmber
                          : state === "closed"
                            ? v2.pillGreen
                            : v2.pillGrey,
                    ]}
                  >
                    <Text style={v2.statePillText}>
                      {state === "closed" ? "✓ " : ""}
                      {details?.sent_back ? t("job2.state.sentBack") : t(`job2.state.${state}`)}
                    </Text>
                  </View>
                )}
                {lateMs != null && (
                  <View style={[v2.statePill, v2.pillRed]}>
                    <Text style={v2.statePillText}>{t("job2.late.pill", { time: formatElapsed(lateMs) })}</Text>
                  </View>
                )}
                {isFollowUpOrder && !!details?.job.parent?.ref_no && (
                  <View style={[v2.statePill, v2.pillGreen]}>
                    <Text style={v2.statePillText}>{t("job2.followUpFrom", { ref: details.job.parent.ref_no })}</Text>
                  </View>
                )}
                {/* The vehicle, right under the title. Tap for bus details. */}
                {jobSummary?.bus_id && (
                  <Pressable
                    style={({ pressed }) => [s.heroVehicle, pressed && { opacity: 0.6 }]}
                    onPress={() => setBusDetailsVisible(true)}
                    hitSlop={6}
                  >
                    <FontAwesome5 name="bus" size={13} color="#2563EB" />
                    <Text style={s.heroVehicleText}>
                      {formatBusLabel(jobSummary.bus_id, jobSummary.bus_ev_no)}
                    </Text>
                    <FontAwesome5 name="chevron-right" size={10} color="#2563EB" />
                  </Pressable>
                )}
                {loading && <Text style={s.loadingText}>{t("common.loading")}</Text>}
              </View>
              <View style={s.badgeStack}>
                <StatusBadge
                  type={normalisePriority(jobSummary?.report_priority)}
                />
              </View>
            </View>

            {report?.report_location && !isFollowUpOrder && (
              <View style={s.heroSubRow}>
                {report?.report_location && (
                  <Pressable
                    style={({ pressed }) => [
                      s.chip,
                      hasLocation && s.chipTappable,
                      pressed && { opacity: 0.6 },
                    ]}
                    onPress={() =>
                      hasLocation &&
                      openDirections(report.report_lat!, report.report_lng!, {
                        title: t("directions.openDirections"),
                        message: t("directions.chooseApp"),
                        cancel: t("common.cancel"),
                      })
                    }
                    disabled={!hasLocation}
                  >
                    <FontAwesome5
                      name="map-marker-alt"
                      size={11}
                      color={hasLocation ? "#2563EB" : "#6B7280"}
                    />
                    <Text
                      style={[s.chipText, hasLocation && { color: "#2563EB" }]}
                    >
                      {report.report_location}
                    </Text>
                    {hasLocation && (
                      <FontAwesome5
                        name="directions"
                        size={11}
                        color="#2563EB"
                      />
                    )}
                  </Pressable>
                )}
              </View>
            )}

            {!canEdit && (
              <View style={s.hintBanner}>
                <FontAwesome5 name="eye" size={12} color="#2563EB" />
                <Text style={s.hintText}>
                  {t("jobDetail.viewOnly")}
                </Text>
              </View>
            )}
          </View>

          {/* ── C13: sent back by the R&M Manager ── */}
          {!!details?.sent_back && (
            <View style={v2.sentBack}>
              <View style={v2.sentBackHead}>
                <FontAwesome5 name="undo" size={13} color="#DC2626" />
                <Text style={v2.sentBackTitle}>{t("job2.sentBack.title")}</Text>
              </View>
              <Text style={v2.sentBackBy}>
                {details.sent_back.by.name ?? "—"}
                {details.sent_back.by.username ? ` @${details.sent_back.by.username}` : ""} · {formatDateTime(details.sent_back.at)}
              </Text>
              {!!details.sent_back.reason && <Text style={v2.sentBackReason}>{details.sent_back.reason}</Text>}
              <Text style={v2.sentBackTodo}>{t("job2.sentBack.whatToDo")}</Text>
            </View>
          )}

          {/* ── C15: not arrived after 1h 30m ── */}
          {canEdit && details?.can.delay_update && (
            <LateUpdateCard
              jobId={jobId}
              refLabel={refLabel}
              limitMin={details.late.limitMin}
              repeatMin={details.late.repeatMin}
              onSent={loadDetails}
            />
          )}

          {/* ── Odometer gate ── */}
          {canEdit && (
            <View style={[s.card, jobLocked && s.cardWarn]}>
              <View style={s.cardHeader}>
                <View
                  style={[
                    s.cardIconBox,
                    jobLocked && { backgroundColor: "#FEE2E2" },
                  ]}
                >
                  <FontAwesome5
                    name="tachometer-alt"
                    size={13}
                    color={jobLocked ? "#DC2626" : "#6B7280"}
                  />
                </View>
                <Text style={[s.cardTitle, jobLocked && { color: "#DC2626" }]}>
                  {t("jobDetail.odometerTitle")}
                </Text>
              </View>
              <View style={s.cardDivider} />

              {hasOdometer ? (
                <View style={v2.odoRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={v2.odoLabel}>{t("job2.odometer.reading")}</Text>
                    <Text style={v2.odoValue}>
                      {jobSummary?.job_odometer != null ? `${jobSummary.job_odometer.toLocaleString()} km` : "—"}
                    </Text>
                    {!!details?.job.arrived_at && (
                      <Text style={v2.odoSub}>
                        {t("job2.odometer.recordedOnArrival", { time: formatDateTime(details.job.arrived_at) })}
                      </Text>
                    )}
                  </View>
                  <View style={[v2.statePill, v2.pillGreen, { marginTop: 0 }]}>
                    <Text style={v2.statePillText}>✓ {t("job2.odometer.recorded")}</Text>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={s.mutedText}>
                    {t("jobDetail.odometerInstructions")}
                  </Text>
                  <View style={[s.inputWrap, { marginTop: 12 }]}>
                    <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
                      ref={odometerInputRef}
                      value={odometerInput}
                      onChangeText={setOdometerInput}
                      placeholder={t("jobDetail.odometerPlaceholder")}
                      placeholderTextColor="#9CA3AF"
                      style={s.input}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      onSubmitEditing={saveOdometer}
                    />
                  </View>
                  <Pressable
                    style={[
                      s.btn,
                      s.btnDark,
                      { marginTop: 12 },
                      savingOdometer && { opacity: 0.7 },
                    ]}
                    onPress={saveOdometer}
                    disabled={savingOdometer}
                  >
                    <Text style={s.btnText}>
                      {savingOdometer ? t("jobDetail.savingOdometer") : t("jobDetail.saveOdometer")}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          )}

          {/* ── Initial Report ── */}
          {isFollowUpOrder && details ? (
            <SectionCard title={t("job2.jobOrderCard.title")} icon="clipboard-list">
              <Field label={t("job2.jobOrderCard.issuedBy")} value={details.events.find((e) => e.type === "JOB_ORDER_ISSUED")?.by.name ?? null} />
              <Field label={t("job2.jobOrderCard.priority")} value={details.job.priority} />
              <Field label={t("job2.jobOrderCard.issue")} value={details.job.desc} />
              <Field label={t("job2.jobOrderCard.requiredAction")} value={details.job.required_action} />
              {!!details.job.remarks && <Field label={t("job2.jobOrderCard.remarks")} value={details.job.remarks} />}
              {!!details.followup_origin?.photos.length && (
                <PhotoStrip urls={details.followup_origin.photos.map((ph) => ph.url)} size={96} />
              )}
            </SectionCard>
          ) : (
          <SectionCard title={t("jobDetail.sectionInitialReport")} icon="file-alt">
            <Field
              label={t("jobDetail.fieldReportedBy")}
              value={jobSummary?.reporter_name ?? report?.reporter_name}
            />
            <Field
              label={t("jobDetail.fieldPriority")}
              value={jobSummary?.report_priority ?? report?.report_priority}
            />
            <Field
              label={t("jobDetail.fieldDescription")}
              value={report?.report_desc ?? jobSummary?.job_desc}
            />

            {/* Report photos */}
            <View style={s.photoSection}>
              <View style={s.photoHeaderRow}>
                <Text style={s.photoSectionLabel}>{t("jobDetail.photos")}</Text>
                <View style={s.countPill}>
                  <Text style={s.countPillText}>
                    {reportPhotoMedia.length} photo
                    {reportPhotoMedia.length === 1 ? "" : "s"}
                  </Text>
                </View>
              </View>
              {loadingReportPhotos ? (
                <Text style={s.mutedText}>{t("jobDetail.loadingPhotos")}</Text>
              ) : reportPhotoUrls.length === 0 ? (
                <Text style={s.mutedText}>{t("jobDetail.noPhotosAttached")}</Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={s.photoStrip}
                >
                  {reportPhotoUrls.map((uri, idx) => (
                    <Pressable
                      key={`${uri}-${idx}`}
                      onPress={() => openViewer(idx)}
                      style={s.thumb}
                    >
                      <Image source={{ uri }} style={s.thumbImg} />
                      <View style={s.thumbOverlay}>
                        <FontAwesome5
                          name="expand-alt"
                          size={14}
                          color="#fff"
                        />
                      </View>
                      <PhotoIndexBadge index={idx} total={reportPhotoUrls.length} />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          </SectionCard>
          )}

          {/* ── Tasks ── */}
          {showWork && (
          <SectionCard title={t("jobDetail.sectionTasks")} icon="tasks">
            {visibleTasks.length === 0 ? (
              <Text style={s.mutedText}>{t("jobDetail.noTasksAddedYet")}</Text>
            ) : (
              visibleTasks.map((t) => (
                <JobTaskCard
                  key={t.task_id}
                  task={t}
                  jobId={jobId}
                  editable={false}
                  onUpdated={fetchAll}
                />
              ))
            )}
          </SectionCard>
          )}

          {/* ── Add Task ── */}
          {workOpen && (
            <SectionCard title={t("jobDetail.sectionAddTask")} icon="plus-circle">
              <Text style={s.helperText}>
                {t("jobDetail.addTaskLockedHelper")}
              </Text>
              <View style={{ marginTop: 12 }}>
                <TaskEditorCard
                  index={visibleTasks.length + 1}
                  value={taskDraft}
                  onChange={setTaskDraft}
                  parts={parts}
                  loadingParts={loadingParts}
                  locked={jobLocked}
                  onLockedPress={handleOdometerRequired}
                  disabled={savingTask}
                  confirmLabel={t("jobDetail.addTaskButton")}
                  onConfirm={createTask}
                  saving={savingTask}
                />
              </View>

              {jobLocked && (
                <Text style={s.helperText}>
                  {t("jobDetail.odometerLockedHelper")}
                </Text>
              )}
            </SectionCard>
          )}

          {/* ── Follow-ups (C3–C4) ── */}
          {showWork && details && (
            <SectionCard title={t("job2.followups.title")} icon="share-square">
              {details.followups.length === 0 ? (
                <Text style={s.mutedText}>{t("job2.followups.empty")}</Text>
              ) : (
                details.followups.map((f, i) => (
                  <FollowupCard
                    key={f.followup_id}
                    followup={f}
                    n={i + 1}
                    onRemove={workOpen ? () => removeFollowup(f.followup_id) : undefined}
                    onOpenJobOrder={(id) => router.push({ pathname: "/technician/job/[id]", params: { id: String(id), mode: "view" } } as any)}
                  />
                ))
              )}
            </SectionCard>
          )}
          {workOpen && details && (
            <SectionCard title={t("job2.followups.add")} icon="plus-circle">
              <Text style={s.helperText}>{t("job2.followups.intro")}</Text>
              <FollowupEditorCard
                n={details.followups.length + 1}
                accent="#C4501A"
                saving={savingFollowup}
                onSave={saveFollowup}
              />
            </SectionCard>
          )}

          {/* The Job Completion Report, once the job is closed. Made on the
              server; this downloads it and opens the share sheet. */}
          {(details ? details.job.pdf_ready : !!jobSummary?.job_completed_at) && (
            <Pressable
              style={({ pressed }) => [pdfStyles.btn, (pdf.busy || pressed) && { opacity: 0.7 }]}
              onPress={() => pdf.run(() => api.jobReportPdf(jobId))}
              disabled={pdf.busy}
            >
              <FontAwesome5 name="file-pdf" size={15} color="#fff" />
              <Text style={pdfStyles.text}>
                {pdf.busy ? t("pdf.preparing") : t("pdf.jobReport")}
              </Text>
            </Pressable>
          )}

          {/* ── Job Progress (from the server's event log) ── */}
          <SectionCard title={t("jobDetail.sectionJobProgress")} icon="stream">
            {progress ? (
              <JobTimeline events={progress.events} pendingStage={progress.pendingStage} />
            ) : (
              <JobTimeline events={timelineEvents} pendingStage={legacyPendingStage} />
            )}
          </SectionCard>

          {/* ── After Photos: dashboard and front, each uploaded as it is taken (C3) ── */}
          {showWork && details && (
            <SectionCard title={t("job2.afterPhotos.title")} icon="camera">
              <Text style={[s.helperText, { marginBottom: 6 }]}>
                {workOpen ? t("job2.afterPhotos.intro") : ""}
              </Text>
              <AfterPhotoSlots
                slots={afterPhotoSlotDefs}
                value={slotValue}
                onChange={(key, next) => onAfterSlotPicked(key as AfterSlot, next)}
                readOnly={!workOpen || !!uploadingSlot}
              />
              {!!uploadingSlot && <Text style={s.helperText}>{t("job2.afterPhotos.uploading")}</Text>}
              {/* Older jobs: back and side photos from when those were asked
                  for, and photos from before the slots. */}
              <PhotoStrip
                urls={[
                  ...AFTER_SLOTS_ALL.filter((k) => !AFTER_SLOTS.includes(k)).map((k) => details.after_photos?.[k]?.url),
                  ...details.after_photos_unslotted.map((ph) => ph.url),
                ]}
                size={96}
                style={{ marginTop: 10 }}
              />
            </SectionCard>
          )}

          {/* Pre-v2 Lambda (no /details): the old uploaded-photos strip. */}
          {!details && afterPhotoUrls.length > 0 && (
            <SectionCard title={t("jobDetail.sectionAfterPhotos")} icon="camera">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoStrip}>
                {afterPhotoUrls.map((uri, idx) => (
                  <Pressable key={`${uri}-${idx}`} onPress={() => openAfterViewer(idx)} style={s.thumb}>
                    <Image source={{ uri }} style={s.thumbImg} />
                    <PhotoIndexBadge index={idx} total={afterPhotoUrls.length} />
                  </Pressable>
                ))}
              </ScrollView>
            </SectionCard>
          )}

          {/* ── Complete Job (C3), or the note that replaces it (C5) ── */}
          {canEdit && state === "pending_approval" && (
            <View style={v2.waitNote}>
              <FontAwesome5 name="hourglass-half" size={13} color="#B45309" />
              <Text style={v2.waitNoteText}>{t("job2.complete.waitingNote")}</Text>
            </View>
          )}
          {workOpen && (
            <View style={s.actions}>
              <Pressable
                style={[s.btn, s.btnGreen, (!!completeHint || completing) && { opacity: 0.6 }]}
                onPress={() => !completeHint && setVerifyVisible(true)}
                disabled={!!completeHint || completing}
              >
                <FontAwesome5 name="check" size={15} color="#fff" style={{ marginRight: 8 }} />
                <Text style={s.btnText}>
                  {completing ? t("jobDetail.completingJob") : t("job2.complete.button")}
                </Text>
              </Pressable>
              {!!completeHint && <Text style={s.helperText}>{completeHint}</Text>}
              {!!details?.sent_back && !completeHint && <Text style={s.helperText}>{t("job2.complete.sentBackNote")}</Text>}
            </View>
          )}
        </KeyboardAwareScrollView>

      <ImageViewerOverlay
        visible={viewerVisible}
        imageUrls={viewerUrls}
        startIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
      />

      <ImageViewerOverlay
        visible={afterViewerVisible}
        imageUrls={afterViewerUrls}
        startIndex={afterViewerIndex}
        onClose={() => setAfterViewerVisible(false)}
      />

      <BusDetailsModal
        visible={busDetailsVisible}
        busId={jobSummary?.bus_id ?? null}
        onClose={() => setBusDetailsVisible(false)}
      />

      <SignoffSheet
        visible={verifyVisible}
        verb="completing"
        action={t("signoff.actions.completeJob")}
        detail={jobSummary ? [refLabel, formatBusLabel(jobSummary.bus_id, jobSummary.bus_ev_no)].filter(Boolean).join(" · ") : null}
        submitting={completing}
        onCancel={() => setVerifyVisible(false)}
        onConfirm={({ selfie, name }) =>
          details && !isTechOrder ? doCompleteJobV2(selfie, name) : doCompleteJob(selfie, name)
        }
      />
    </>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, paddingTop: 14, gap: 14, paddingBottom: 40 },

  // Hero
  hero: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  heroLeft: { flex: 1 },
  heroId: {
    fontSize: 32,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
  },
  loadingText: { fontSize: 13, color: "#9CA3AF", marginTop: 4 },
  badgeStack: {
    flexDirection: "row",
    gap: 6,
    paddingTop: 4,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  heroVehicle: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 6, alignSelf: "flex-start" },
  heroVehicleText: { fontSize: 16, fontWeight: "800", color: "#2563EB" },
  heroSubRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    maxWidth: "100%",
    flexShrink: 1,
  },
  chipTappable: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    flexShrink: 1,
  },
  hintBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 14,
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  hintText: { fontSize: 13, fontWeight: "600", color: "#2563EB" },

  // Cards
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardWarn: { borderColor: "#FECACA", backgroundColor: "#FEF2F2" },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  cardIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 13, fontWeight: "700", color: "#374151" },
  cardDivider: { height: 1, backgroundColor: "#F3F4F6", marginBottom: 14 },

  // Fields
  field: { marginBottom: 12 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  fieldValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    lineHeight: 21,
  },

  mutedText: { fontSize: 14, color: "#9CA3AF", fontWeight: "500" },

  // Photos
  photoSection: { marginTop: 6 },
  photoHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  photoSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.2,
  },
  countPill: {
    backgroundColor: "#F3F4F6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  countPillText: { fontSize: 12, fontWeight: "600", color: "#6B7280" },

  photoStrip: { gap: 10, paddingBottom: 2 },
  thumb: { width: 96, height: 96, borderRadius: 14, overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Buttons
  actions: { gap: 10, marginBottom: 8 },
  btn: {
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  btnDark: { backgroundColor: "#111827" },
  btnGreen: { backgroundColor: "#16A34A" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  helperText: {
    color: "#9CA3AF",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 6,
  },

  // Form inputs
  inputLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  inputWrap: {
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  input: { fontSize: 15, color: "#111827" },
  textarea: { minHeight: 72, fontSize: 15, color: "#111827" },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  // Parts dropdown
  dropdownTrigger: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownTriggerText: { fontSize: 14, fontWeight: "600", color: "#111827" },
  dropdownPanel: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#fff",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  dropdownItemSelected: { borderColor: "#111827", backgroundColor: "#F9FAFB" },
  partName: { fontSize: 14, fontWeight: "700", color: "#111827" },
  partCode: { fontWeight: "600", color: "#6B7280" },
  partMeta: { marginTop: 4, fontSize: 12, fontWeight: "500", color: "#6B7280" },
  qtyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#111827",
  },
  qtyBadgeText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  selectedCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#fff",
  },
  qtyRow: { flexDirection: "column", alignItems: "center", gap: 6 },
  qtyBtn: {
    width: 40,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F9FAFB",
  },
  qtyBtnText: { fontSize: 18, fontWeight: "700", color: "#111827" },
  qtyValue: {
    minWidth: 32,
    textAlign: "center",
    fontWeight: "700",
    color: "#111827",
    fontSize: 15,
  },
  removeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  removeBtnText: { fontSize: 12, fontWeight: "700", color: "#DC2626" },
});

const pdfStyles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 50,
    borderRadius: 14,
    backgroundColor: "#111827",
    marginBottom: 12,
  },
  text: { color: "#fff", fontSize: 15, fontWeight: "800" },
});

// v2.0.0 Part C additions.
const v2 = StyleSheet.create({
  ref: { fontSize: 12.5, fontWeight: "800", color: "#6B7280", marginTop: 3, letterSpacing: 0.2 },
  statePill: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statePillText: { fontSize: 12, fontWeight: "800", color: "#111827" },
  pillGrey: { backgroundColor: "#F3F4F6" },
  pillAmber: { backgroundColor: "#FEF3C7" },
  pillGreen: { backgroundColor: "#DCFCE7" },
  pillRed: { backgroundColor: "#FEE2E2" },
  sentBack: { backgroundColor: "#FEF2F2", borderRadius: 20, borderWidth: 1, borderColor: "#FCA5A5", padding: 16 },
  sentBackHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sentBackTitle: { fontSize: 15, fontWeight: "800", color: "#991B1B" },
  sentBackBy: { fontSize: 12.5, color: "#7F1D1D", marginTop: 6 },
  sentBackReason: { fontSize: 14.5, color: "#111827", fontWeight: "700", marginTop: 8, lineHeight: 20 },
  sentBackTodo: { fontSize: 12.5, color: "#4B5563", marginTop: 8, lineHeight: 17 },
  odoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  odoLabel: { fontSize: 11, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.5 },
  odoValue: { fontSize: 22, fontWeight: "800", color: "#111827", marginTop: 2 },
  odoSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  waitNote: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  waitNoteText: { flex: 1, fontSize: 13, color: "#92400E", lineHeight: 18 },
});
