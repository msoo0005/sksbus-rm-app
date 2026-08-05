import { FontAwesome5 } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { JobMedia, ReportMedia } from "../../../api/client";
import { api } from "../../../api/client";
import AfterPhotoSlots from "../../../components/AfterPhotoSlots";
import BusDetailsModal from "../../../components/BusDetailsModal";
import type { LocalMedia } from "../../../components/ImagePicker";
import ImagePickerField from "../../../components/ImagePicker";
import ImageViewerOverlay from "../../../components/ImageViewerOverlay";
import JobTaskCard from "../../../components/JobTaskCard";
import JobTimeline, { TimelineEvent } from "../../../components/JobTimeline";
import type { StatusType } from "../../../components/StatusBadge";
import StatusBadge from "../../../components/StatusBadge";
import { useI18n } from "../../../i18n/i18n-ctx";
import { openDirections } from "../../../utils/directions";

type TaskStatus = "pending" | "in_progress" | "blocked" | "done";

// This task is auto-created by the backend the moment the initial odometer
// reading is saved (see upsertOdometerRecordedTask in the lambda) — it's a
// bookkeeping row, not a real repair task, so it's surfaced only in the
// timeline and excluded from the Tasks list.
const ODOMETER_TASK_NAME = "Recorded odometer reading";

// Completing a job requires exactly one after-photo per side of the bus —
// these are the 4 fixed slots shown in the "After Photos" section. Built
// from translations (like buildPriorityOptions in form.tsx) since the
// labels need to switch with the selected language.
type AfterPhotoSlot = "front" | "back" | "left" | "right";
function buildAfterPhotoSlots(t: (key: string) => string): { key: AfterPhotoSlot; label: string }[] {
  return [
    { key: "front", label: t("jobDetail.photoSlotFront") },
    { key: "back", label: t("jobDetail.photoSlotBack") },
    { key: "left", label: t("jobDetail.photoSlotLeft") },
    { key: "right", label: t("jobDetail.photoSlotRight") },
  ];
}

type JobListItem = {
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
  reporter_name: string | null;
  technician_name?: string | null;
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

type PartRow = {
  part_id: number;
  part_name: string;
  part_code: string;
  part_cost: number | null;
  part_stock: number | null;
};

const MAX_ODOMETER = 9_999_999;

function toLower(x: unknown) {
  return String(x ?? "")
    .trim()
    .toLowerCase();
}
function normaliseReportType(x: unknown): StatusType {
  const v = toLower(x);
  if (v === "repair" || v === "problem" || v === "accident") return v;
  return "repair";
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
  const afterPhotoSlotDefs = useMemo(() => buildAfterPhotoSlots(t), [t]);

  const scrollRef = useRef<ScrollView>(null);
  const odometerInputRef = useRef<TextInput>(null);

  const [loading, setLoading] = useState(false);
  const [jobSummary, setJobSummary] = useState<JobListItem | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [tasks, setTasks] = useState<JobTask[]>([]);

  const [issue, setIssue] = useState("");
  const [solution, setSolution] = useState("");
  const [newTaskPhotos, setNewTaskPhotos] = useState<LocalMedia[]>([]);
  const [savingTask, setSavingTask] = useState(false);

  const [parts, setParts] = useState<PartRow[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);
  const [selectedParts, setSelectedParts] = useState<Record<number, number>>(
    {},
  );
  const [partsOpen, setPartsOpen] = useState(false);
  const [partsSearch, setPartsSearch] = useState("");

  const [odometerInput, setOdometerInput] = useState("");
  const [savingOdometer, setSavingOdometer] = useState(false);

  const [afterPhotoSlots, setAfterPhotoSlots] = useState<Record<AfterPhotoSlot, LocalMedia[]>>({
    front: [],
    back: [],
    left: [],
    right: [],
  });
  const [reportPhotoUrls, setReportPhotoUrls] = useState<string[]>([]);
  const [loadingReportPhotos, setLoadingReportPhotos] = useState(false);

  const [afterPhotoUrls, setAfterPhotoUrls] = useState<string[]>([]);
  const [loadingAfterPhotos, setLoadingAfterPhotos] = useState(false);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [afterViewerVisible, setAfterViewerVisible] = useState(false);
  const [afterViewerIndex, setAfterViewerIndex] = useState(0);
  const [busDetailsVisible, setBusDetailsVisible] = useState(false);
  const [completing, setCompleting] = useState(false);

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
      const urls = (Array.isArray(media) ? media : [])
        .map((m) => m?.viewUrl ?? null)
        .filter(isNonEmptyString);
      setAfterPhotoUrls(Array.from(new Set(urls)));
    } catch {
      setAfterPhotoUrls([]);
    } finally {
      setLoadingAfterPhotos(false);
    }
  };

  const loadParts = async () => {
    setLoadingParts(true);
    try {
      const rows = (await api.parts({ limit: 200 })) as PartRow[];
      setParts(Array.isArray(rows) ? rows : []);
    } catch (e: unknown) {
      handleApiError(e, t("jobDetail.failedToLoadParts"));
      setParts([]);
    } finally {
      setLoadingParts(false);
    }
  };

  const fetchAll = async () => {
    if (!Number.isFinite(jobId) || jobId <= 0) return;
    setLoading(true);
    try {
      const allJobs = (await api.listJobs()) as JobListItem[];
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

  const doSaveOdometer = async (n: number) => {
    setSavingOdometer(true);
    try {
      await api.patchJob(jobId, { job_odometer: n });
      // Saving the odometer also creates a "Recorded odometer reading" task
      // server-side and unlocks the rest of the job — refetch everything
      // rather than just patching jobSummary locally, so that task shows up
      // immediately instead of only after leaving and re-entering the page.
      await fetchAll();
      Alert.alert(t("common.saved"), t("jobDetail.odometerSavedMessage"));
    } catch (e: unknown) {
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

  const partsById = useMemo(() => {
    const m = new Map<number, PartRow>();
    for (const p of parts) m.set(p.part_id, p);
    return m;
  }, [parts]);

  const filteredDropdownParts = useMemo(() => {
    const q = partsSearch.trim().toLowerCase();
    const list = Array.isArray(parts) ? parts : [];
    if (!q) return list.slice(0, 50);
    return list
      .filter(
        (p) =>
          String(p.part_name ?? "")
            .toLowerCase()
            .includes(q) ||
          String(p.part_code ?? "")
            .toLowerCase()
            .includes(q),
      )
      .slice(0, 50);
  }, [parts, partsSearch]);

  const selectedPartIds = useMemo(
    () =>
      Object.keys(selectedParts)
        .map(Number)
        .filter((pid) => Number.isFinite(pid) && (selectedParts[pid] ?? 0) > 0),
    [selectedParts],
  );

  const addOrIncPart = (partId: number) =>
    setSelectedParts((prev) => ({
      ...prev,
      [partId]: (prev[partId] ?? 0) + 1,
    }));
  const changeQty = (partId: number, delta: number) =>
    setSelectedParts((prev) => {
      const cur = prev[partId] ?? 0;
      const next = cur + delta;
      const copy = { ...prev };
      if (next <= 0) delete copy[partId];
      else copy[partId] = next;
      return copy;
    });
  const removePart = (partId: number) =>
    setSelectedParts((prev) => {
      const next = { ...prev };
      delete next[partId];
      return next;
    });

  const doCreateTask = async () => {
    setSavingTask(true);
    try {
      const nextOrder = tasks.length
        ? Math.max(...tasks.map((x) => x.task_order ?? 0)) + 1
        : 1;
      const created = await api.createJobTask(jobId, {
        task_name: issue.trim(),
        task_desc: solution.trim() || null,
        task_status: "done",
        task_order: nextOrder,
      });
      const taskId = Number((created as { task_id?: number }).task_id);

      const partEntries = Object.entries(selectedParts)
        .map(([k, qty]) => ({ part_id: Number(k), qty: Number(qty) }))
        .filter(
          (x) => Number.isFinite(x.part_id) && x.part_id > 0 && x.qty > 0,
        );
      if (taskId && partEntries.length) {
        for (const p of partEntries)
          await api.addTaskPart(taskId, { part_id: p.part_id, qty: p.qty });
      }

      if (taskId && newTaskPhotos.length) {
        try {
          await uploadAfterPhotos(jobId, newTaskPhotos, taskId);
        } catch (e: unknown) {
          // The task itself was created fine — a photo upload hiccup
          // shouldn't look like the whole action failed.
          handleApiError(e, t("jobDetail.taskAddedButPhotosFailed"));
          await fetchAll();
          return;
        }
      }

      setIssue("");
      setSolution("");
      setSelectedParts({});
      setPartsSearch("");
      setPartsOpen(false);
      setNewTaskPhotos([]);
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
    const issueText = issue.trim();
    if (!issueText) {
      Alert.alert(
        t("jobDetail.taskIssueRequiredTitle"),
        t("jobDetail.taskIssueRequiredMessage"),
      );
      return;
    }
    const photoNote = newTaskPhotos.length
      ? t("jobDetail.photoNote", { count: newTaskPhotos.length })
      : "";
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

  const pendingTasks = useMemo(
    () => visibleTasks.filter((t) => t.task_status !== "done"),
    [visibleTasks],
  );

  const afterMedia = useMemo(
    () => afterPhotoSlotDefs.flatMap((s) => afterPhotoSlots[s.key]),
    [afterPhotoSlotDefs, afterPhotoSlots],
  );

  const missingAfterPhotoSlots = useMemo(
    () => afterPhotoSlotDefs.filter((s) => afterPhotoSlots[s.key].length === 0),
    [afterPhotoSlotDefs, afterPhotoSlots],
  );

  const timelineEvents = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];

    if (report?.report_uploaded_at) {
      events.push({
        id: "report-submitted",
        icon: "file-alt",
        color: "#2563EB",
        colorLight: "#EFF6FF",
        title: t("jobDetail.eventReportSubmitted"),
        by: report.reporter_name,
        at: report.report_uploaded_at,
      });
    }

    if (jobSummary?.job_created_at) {
      events.push({
        id: "job-created",
        icon: "briefcase",
        color: "#7C3AED",
        colorLight: "#F5F3FF",
        title: t("jobDetail.eventJobCreated"),
        by: report?.report_review_by,
        at: jobSummary.job_created_at,
      });
    }

    if (jobSummary?.job_accepted_at) {
      events.push({
        id: "job-accepted",
        icon: "hand-paper",
        color: "#EA580C",
        colorLight: "#FFF7ED",
        title: t("jobDetail.eventJobAccepted"),
        by: jobSummary.technician_name,
        at: jobSummary.job_accepted_at,
      });
    }

    const odometerTask = tasks.find((t) => t.task_name === ODOMETER_TASK_NAME);
    if (odometerTask?.completed_at) {
      events.push({
        id: "odometer",
        icon: "tachometer-alt",
        color: "#0EA5E9",
        colorLight: "#F0F9FF",
        title: t("jobDetail.eventOdometerRecorded"),
        subtitle: hasOdometer
          ? `${jobSummary?.job_odometer?.toLocaleString()} km`
          : undefined,
        by: jobSummary?.technician_name,
        at: odometerTask.completed_at,
      });
    }

    for (const t of visibleTasks) {
      if (t.task_status === "done" && t.completed_at) {
        events.push({
          id: `task-${t.task_id}`,
          icon: "check-circle",
          color: "#16A34A",
          colorLight: "#F0FDF4",
          title: t.task_name,
          subtitle: t.task_desc ?? undefined,
          by: jobSummary?.technician_name,
          at: t.completed_at,
        });
      }
    }

    if (jobSummary?.job_completed_at) {
      events.push({
        id: "job-completed",
        icon: "flag-checkered",
        color: "#111827",
        colorLight: "#F3F4F6",
        title: t("jobDetail.eventJobCompleted"),
        by: jobSummary.technician_name,
        at: jobSummary.job_completed_at,
      });
    }

    return events;
  }, [report, jobSummary, tasks, visibleTasks, hasOdometer, t]);

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

  const doCompleteJob = async () => {
    const reportId = jobSummary?.report_id ?? null;
    setCompleting(true);
    try {
      try {
        await uploadAfterPhotos(jobId, afterMedia);
      } catch (e: unknown) {
        handleApiError(e, t("jobDetail.failedToUploadAfterPhotos"));
        return;
      }

      try {
        await api.updateJobStatus(jobId, { to_status: "closed" });
      } catch (e: unknown) {
        handleApiError(e, t("jobDetail.failedToCloseJob"));
        return;
      }

      if (Number.isFinite(reportId) && (reportId as number) > 0) {
        try {
          await api.updateReportStatus(reportId as number, {
            report_status: "closed",
            report_review_action: null,
            report_review_reason: null,
            report_review_by: null,
            report_review_at: new Date().toISOString(),
          });
        } catch (e: unknown) {
          // The job itself is already closed at this point — don't leave the
          // technician stuck retrying just because the report side failed.
          handleApiError(
            e,
            "Job closed, but failed to close the linked report",
          );
          router.back();
          return;
        }
      }

      Alert.alert(
        "Job completed",
        reportId ? "Job and report have been closed." : "Job has been closed.",
      );
      router.back();
    } finally {
      setCompleting(false);
    }
  };

  const completeJob = () => {
    if (!canEdit) return;
    if (jobLocked) {
      handleOdometerRequired();
      return;
    }
    if (completedTasks.length === 0) {
      Alert.alert(
        t("jobDetail.completedTaskFirstTitle"),
        t("jobDetail.completedTaskFirstMessage"),
      );
      return;
    }
    if (pendingTasks.length > 0) {
      Alert.alert(
        t("jobDetail.tasksPendingTitle"),
        t("jobDetail.tasksPendingMessage", { count: pendingTasks.length }),
      );
      return;
    }
    if (missingAfterPhotoSlots.length > 0) {
      Alert.alert(
        t("jobDetail.afterPhotosRequiredTitle"),
        t("jobDetail.afterPhotosRequiredMessage", {
          list: missingAfterPhotoSlots.map((slot) => slot.label).join(", "),
        }),
      );
      return;
    }
    Alert.alert(
      t("jobDetail.completeJob"),
      t("jobDetail.completeJobConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("jobDetail.completeJob"), style: "default", onPress: doCompleteJob },
      ],
    );
  };

  const reportPhotoMedia: LocalMedia[] = useMemo(
    () =>
      reportPhotoUrls.map((u) => ({
        localUri: u,
        mime_type: guessMimeFromUrl(u),
      })),
    [reportPhotoUrls],
  );

  const onAfterPhotoSlotChange = (slot: AfterPhotoSlot, next: LocalMedia[]) => {
    if (jobLocked && next.length > afterPhotoSlots[slot].length) {
      handleOdometerRequired();
      return;
    }
    setAfterPhotoSlots((prev) => ({ ...prev, [slot]: next }));
  };

  const hasLocation = report?.report_lat != null && report?.report_lng != null;

  return (
    <>
      <Stack.Screen options={{ title: "Job Details" }} />

      <KeyboardAvoidingView
        style={s.page}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={scrollRef}
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
                <Text style={s.heroId}>Job #{jobId}</Text>
                {loading && <Text style={s.loadingText}>Loading…</Text>}
              </View>
              <View style={s.badgeStack}>
                <StatusBadge
                  type={normaliseReportType(jobSummary?.report_type)}
                />
                <StatusBadge
                  type={normalisePriority(jobSummary?.report_priority)}
                />
              </View>
            </View>

            {(jobSummary?.bus_id || report?.report_location) && (
              <View style={s.heroSubRow}>
                {jobSummary?.bus_id && (
                  <Pressable
                    style={({ pressed }) => [s.chip, s.chipTappable, pressed && { opacity: 0.6 }]}
                    onPress={() => setBusDetailsVisible(true)}
                  >
                    <FontAwesome5 name="bus" size={11} color="#2563EB" />
                    <Text style={[s.chipText, { color: "#2563EB" }]}>{jobSummary.bus_id}</Text>
                  </Pressable>
                )}
                {report?.report_location && (
                  <Pressable
                    style={({ pressed }) => [
                      s.chip,
                      hasLocation && s.chipTappable,
                      pressed && { opacity: 0.6 },
                    ]}
                    onPress={() =>
                      hasLocation &&
                      openDirections(report.report_lat!, report.report_lng!)
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
                  View only — accept the job to update tasks.
                </Text>
              </View>
            )}
          </View>

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
                <Field
                  label={t("jobDetail.odometerRecordedReading")}
                  value={
                    jobSummary?.job_odometer != null
                      ? `${jobSummary.job_odometer.toLocaleString()} km`
                      : undefined
                  }
                />
              ) : (
                <>
                  <Text style={s.mutedText}>
                    {t("jobDetail.odometerInstructions")}
                  </Text>
                  <View style={[s.inputWrap, { marginTop: 12 }]}>
                    <TextInput
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
          <SectionCard title={t("jobDetail.sectionInitialReport")} icon="file-alt">
            <Field
              label={t("jobDetail.fieldReportId")}
              value={
                jobSummary?.report_id != null
                  ? `#${jobSummary.report_id}`
                  : null
              }
            />
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
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          </SectionCard>

          {/* ── Tasks ── */}
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

          {/* ── Add Task ── */}
          {canEdit && (
            <SectionCard title={t("jobDetail.sectionAddTask")} icon="plus-circle">
              <Text style={s.helperText}>
                {t("jobDetail.addTaskLockedHelper")}
              </Text>

              <Text style={s.inputLabel}>{t("jobDetail.taskIssue")}</Text>
              <View style={s.inputWrap}>
                <TextInput
                  value={issue}
                  onChangeText={setIssue}
                  placeholder={t("jobDetail.taskIssuePlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  style={s.input}
                  editable={!jobLocked}
                  onFocus={() => jobLocked && handleOdometerRequired()}
                />
              </View>

              <Text style={[s.inputLabel, { marginTop: 12 }]}>
                {t("jobDetail.taskSolution")}
              </Text>
              <View style={s.inputWrap}>
                <TextInput
                  value={solution}
                  onChangeText={setSolution}
                  placeholder={t("jobDetail.taskSolutionPlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  style={s.textarea}
                  multiline
                  editable={!jobLocked}
                  onFocus={() => jobLocked && handleOdometerRequired()}
                />
              </View>

              <View style={[s.rowBetween, { marginTop: 14 }]}>
                <Text style={s.inputLabel}>Parts Used</Text>
                <View style={s.countPill}>
                  <Text style={s.countPillText}>
                    {selectedPartIds.length} selected
                  </Text>
                </View>
              </View>

              <Pressable
                style={[s.dropdownTrigger, jobLocked && { opacity: 0.6 }]}
                onPress={() => {
                  if (jobLocked) return handleOdometerRequired();
                  setPartsOpen((v) => !v);
                }}
              >
                <Text style={s.dropdownTriggerText}>
                  {loadingParts
                    ? "Loading parts…"
                    : partsOpen
                      ? "Close parts list"
                      : "Select parts (search)"}
                </Text>
                <FontAwesome5
                  name={partsOpen ? "chevron-up" : "chevron-down"}
                  size={12}
                  color="#6B7280"
                />
              </Pressable>

              {partsOpen && (
                <View style={s.dropdownPanel}>
                  <View style={s.inputWrap}>
                    <TextInput
                      value={partsSearch}
                      onChangeText={setPartsSearch}
                      placeholder="Search by name or code…"
                      placeholderTextColor="#9CA3AF"
                      style={s.input}
                      autoCorrect={false}
                      editable={!jobLocked}
                    />
                  </View>
                  <ScrollView
                    style={{ maxHeight: 240, marginTop: 10 }}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    {filteredDropdownParts.length === 0 ? (
                      <Text style={s.mutedText}>
                        {loadingParts ? "Loading parts…" : "No matching parts."}
                      </Text>
                    ) : (
                      filteredDropdownParts.map((p) => {
                        const qty = selectedParts[p.part_id] ?? 0;
                        return (
                          <Pressable
                            key={p.part_id}
                            style={[
                              s.dropdownItem,
                              qty > 0 && s.dropdownItemSelected,
                            ]}
                            onPress={() => {
                              if (jobLocked) return handleOdometerRequired();
                              addOrIncPart(p.part_id);
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={s.partName}>
                                {p.part_name}{" "}
                                <Text style={s.partCode}>({p.part_code})</Text>
                              </Text>
                              <Text style={s.partMeta}>
                                Stock: {p.part_stock ?? "—"} · Cost:{" "}
                                {p.part_cost ?? "—"}
                              </Text>
                            </View>
                            {qty > 0 && (
                              <View style={s.qtyBadge}>
                                <Text style={s.qtyBadgeText}>×{qty}</Text>
                              </View>
                            )}
                          </Pressable>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
              )}

              <View style={{ marginTop: 12, gap: 10 }}>
                {selectedPartIds.length === 0 ? (
                  <Text style={s.mutedText}>No parts selected.</Text>
                ) : (
                  selectedPartIds.map((pid) => {
                    const p = partsById.get(pid);
                    const qty = selectedParts[pid] ?? 0;
                    if (!p) return null;
                    return (
                      <View key={pid} style={s.selectedCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.partName}>
                            {p.part_name}{" "}
                            <Text style={s.partCode}>({p.part_code})</Text>
                          </Text>
                          <Text style={s.partMeta}>
                            Stock: {p.part_stock ?? "—"} · Cost:{" "}
                            {p.part_cost ?? "—"}
                          </Text>
                        </View>
                        <View style={s.qtyRow}>
                          <Pressable
                            style={s.qtyBtn}
                            onPress={() =>
                              jobLocked
                                ? handleOdometerRequired()
                                : changeQty(pid, -1)
                            }
                            disabled={jobLocked}
                          >
                            <Text style={s.qtyBtnText}>−</Text>
                          </Pressable>
                          <Text style={s.qtyValue}>{qty}</Text>
                          <Pressable
                            style={s.qtyBtn}
                            onPress={() =>
                              jobLocked
                                ? handleOdometerRequired()
                                : changeQty(pid, +1)
                            }
                            disabled={jobLocked}
                          >
                            <Text style={s.qtyBtnText}>+</Text>
                          </Pressable>
                          <Pressable
                            style={s.removeBtn}
                            onPress={() =>
                              jobLocked
                                ? handleOdometerRequired()
                                : removePart(pid)
                            }
                            disabled={jobLocked}
                          >
                            <Text style={s.removeBtnText}>Remove</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>

              <View style={{ marginTop: 14 }}>
                {jobLocked ? (
                  <Pressable onPress={handleOdometerRequired}>
                    <ImagePickerField
                      title="Task Photos"
                      value={newTaskPhotos}
                      onChange={setNewTaskPhotos}
                      captureLabel="Capture Photo"
                      uploadLabel="Upload Photo"
                      showUploadButton
                      readOnly
                    />
                  </Pressable>
                ) : (
                  <ImagePickerField
                    title="Task Photos"
                    value={newTaskPhotos}
                    onChange={setNewTaskPhotos}
                    captureLabel="Capture Photo"
                    uploadLabel="Upload Photo"
                    showUploadButton
                  />
                )}
              </View>

              <Pressable
                style={[
                  s.btn,
                  s.btnDark,
                  { marginTop: 14 },
                  (jobLocked || savingTask) && { opacity: 0.6 },
                ]}
                onPress={createTask}
                disabled={jobLocked || savingTask}
              >
                <Text style={s.btnText}>
                  {savingTask ? t("common.saving") : t("jobDetail.addTaskButton")}
                </Text>
              </Pressable>

              {jobLocked && (
                <Text style={s.helperText}>
                  {t("jobDetail.odometerLockedHelper")}
                </Text>
              )}
            </SectionCard>
          )}

          {/* ── Job Progress Timeline ── */}
          <SectionCard title={t("jobDetail.sectionJobProgress")} icon="stream">
            <JobTimeline events={timelineEvents} />
          </SectionCard>

          {/* ── After Photos (already uploaded) ── */}
          <SectionCard title={t("jobDetail.sectionAfterPhotos")} icon="camera">
            <View style={s.photoHeaderRow}>
              <Text style={s.photoSectionLabel}>{t("jobDetail.uploaded")}</Text>
              <View style={s.countPill}>
                <Text style={s.countPillText}>
                  {afterPhotoUrls.length} photo
                  {afterPhotoUrls.length === 1 ? "" : "s"}
                </Text>
              </View>
            </View>
            {loadingAfterPhotos ? (
              <Text style={s.mutedText}>{t("jobDetail.loadingPhotos")}</Text>
            ) : afterPhotoUrls.length === 0 ? (
              <Text style={s.mutedText}>{t("jobDetail.noAfterPhotosYet")}</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.photoStrip}
              >
                {afterPhotoUrls.map((uri, idx) => (
                  <Pressable
                    key={`${uri}-${idx}`}
                    onPress={() => openAfterViewer(idx)}
                    style={s.thumb}
                  >
                    <Image source={{ uri }} style={s.thumbImg} />
                    <View style={s.thumbOverlay}>
                      <FontAwesome5 name="expand-alt" size={14} color="#fff" />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </SectionCard>

          {/* ── Add After Photos (staging, only while editable) ── */}
          {canEdit &&
            (jobLocked ? (
              <Pressable onPress={handleOdometerRequired}>
                <AfterPhotoSlots
                  slots={afterPhotoSlotDefs}
                  value={afterPhotoSlots}
                  onChange={(key, next) => onAfterPhotoSlotChange(key as AfterPhotoSlot, next)}
                  readOnly
                  onPressReadOnly={handleOdometerRequired}
                />
                <Text style={[s.helperText, { marginTop: 8 }]}>
                  {t("jobDetail.odometerRequiredForPhotos")}
                </Text>
              </Pressable>
            ) : (
              <>
                <Text style={[s.helperText, { marginBottom: 4 }]}>
                  {t("jobDetail.addPhotosHint")}
                </Text>
                <AfterPhotoSlots
                  slots={afterPhotoSlotDefs}
                  value={afterPhotoSlots}
                  onChange={(key, next) => onAfterPhotoSlotChange(key as AfterPhotoSlot, next)}
                />
              </>
            ))}

          {/* ── Complete Job ── */}
          {canEdit && (
            <View style={s.actions}>
              <Pressable
                style={[
                  s.btn,
                  s.btnGreen,
                  (jobLocked ||
                    completedTasks.length === 0 ||
                    pendingTasks.length > 0 ||
                    missingAfterPhotoSlots.length > 0 ||
                    completing) && { opacity: 0.6 },
                ]}
                onPress={completeJob}
                disabled={
                  jobLocked ||
                  completedTasks.length === 0 ||
                  pendingTasks.length > 0 ||
                  missingAfterPhotoSlots.length > 0 ||
                  completing
                }
              >
                <FontAwesome5
                  name="check"
                  size={15}
                  color="#fff"
                  style={{ marginRight: 8 }}
                />
                <Text style={s.btnText}>
                  {completing ? t("jobDetail.completingJob") : t("jobDetail.completeJob")}
                </Text>
              </Pressable>
              {jobLocked ? (
                <Text style={s.helperText}>
                  {t("jobDetail.odometerLockedHelper")}
                </Text>
              ) : completedTasks.length === 0 ? (
                <Text style={s.helperText}>
                  {t("jobDetail.completedTaskFirstMessage")}
                </Text>
              ) : pendingTasks.length > 0 ? (
                <Text style={s.helperText}>
                  {t("jobDetail.tasksPendingMessage", { count: pendingTasks.length })}
                </Text>
              ) : missingAfterPhotoSlots.length > 0 ? (
                <Text style={s.helperText}>
                  {t("jobDetail.missingAfterPhotoHelper", {
                    list: missingAfterPhotoSlots.map((slot) => slot.label).join(", "),
                  })}
                </Text>
              ) : null}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

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
