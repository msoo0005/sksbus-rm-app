// app/(app)/technician/job/[id].tsx
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ReportMedia } from "../../../api/client";
import { api } from "../../../api/client";
import type { LocalMedia } from "../../../components/ImagePicker";
import ImagePickerField from "../../../components/ImagePicker";
import ImageViewerOverlay from "../../../components/ImageViewerOverlay";
import type { StatusType } from "../../../components/StatusBadge";
import StatusBadge from "../../../components/StatusBadge";
import { useSession } from "../../../ctx";

type TaskStatus = "pending" | "in_progress" | "blocked" | "done";

type JobListItem = {
  job_id: number;
  job_desc: string | null;
  job_status: string;
  technician_user_id: number | null;
  job_created_at?: string | null;

  report_id: number | null;
  report_type: string | null;
  report_priority: string | null;
  bus_id: string | null;
  reporter_name: string | null;
};

type ReportDto = {
  report_id: number;
  report_type: string;
  report_desc?: string | null;
  report_location?: string | null;
  report_priority?: string | null;
  bus_id?: string | null;
  report_uploaded_at?: string | null;
  reporter_name?: string | null;
  reporter_email?: string | null;
};

type JobTask = {
  task_id: number;
  job_id: number;
  task_name: string;
  task_desc: string | null;
  task_status: TaskStatus;
  task_order: number;
};

// ---------- API helpers (kept because tasks/jobs endpoints aren't in api.ts yet) ----------
function getBearer(session: any): string | null {
  const token =
    typeof session === "string"
      ? session
      : (session?.token ?? session?.idToken ?? session?.accessToken ?? null);

  if (!token) return null;
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

function mergeHeaders(base?: HeadersInit, extra?: Record<string, string>) {
  const h = new Headers(base);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== "") h.set(k, v);
    }
  }
  return h;
}

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || "";

async function apiFetch<T = any>(
  path: string,
  opts: RequestInit = {},
  session?: any,
): Promise<T> {
  const bearer = getBearer(session);

  const headers = mergeHeaders(opts.headers, {
    "Content-Type": "application/json",
    ...(bearer ? { Authorization: bearer } : {}),
  });

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok)
    throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

// ---------- STATUS HELPERS ----------
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

function guessMimeFromUrl(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

const isNonEmptyString = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;

export default function TechnicianJobDetailsScreen() {
  const router = useRouter();
  const { session } = useSession() as any;

  const { id, mode } = useLocalSearchParams<{
    id: string;
    mode?: "view" | "edit";
  }>();

  const canEdit = mode !== "view";
  const jobId = useMemo(() => Number(id), [id]);

  const [loading, setLoading] = useState(false);

  const [jobSummary, setJobSummary] = useState<JobListItem | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [tasks, setTasks] = useState<JobTask[]>([]);

  // Add task form
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");

  // After photos (local)
  const [afterMedia, setAfterMedia] = useState<LocalMedia[]>([]);

  // ✅ Report photos (remote)
  const [reportPhotoUrls, setReportPhotoUrls] = useState<string[]>([]);
  const [loadingReportPhotos, setLoadingReportPhotos] = useState(false);

  // ✅ viewer overlay state
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // For overlay component
  const viewerUrls = useMemo(
    () => reportPhotoUrls.map((u) => ({ url: u })),
    [reportPhotoUrls],
  );

  // Convert remote URLs to LocalMedia (used only if you want ImagePickerField style in future)
  const reportPhotoMedia: LocalMedia[] = useMemo(() => {
    return reportPhotoUrls.map((u) => ({
      localUri: u,
      mime_type: guessMimeFromUrl(u),
    }));
  }, [reportPhotoUrls]);

  const openViewer = (index: number) => {
    if (!reportPhotoUrls.length) return;
    const safe = Math.min(Math.max(index, 0), reportPhotoUrls.length - 1);
    setViewerIndex(safe);
    setViewerVisible(true);
  };

  const loadReportPhotos = async (reportId: number) => {
    if (!Number.isFinite(reportId) || reportId <= 0) return;

    setLoadingReportPhotos(true);
    try {
      const media = (await api.listReportMedia(reportId)) as ReportMedia[];

      console.log("[report media raw]", media);

      // ✅ Your API returns signed URLs as viewUrl
      const urls = (Array.isArray(media) ? media : [])
        .map((m) => m?.viewUrl ?? null)
        .filter(isNonEmptyString);

      setReportPhotoUrls(Array.from(new Set(urls)));
    } catch (e: any) {
      console.log("[loadReportPhotos error]", e);
      setReportPhotoUrls([]);
    } finally {
      setLoadingReportPhotos(false);
    }
  };

  const fetchAll = async () => {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    setLoading(true);
    try {
      // 1) Find job summary (includes report_id)
      const allJobs = await apiFetch<JobListItem[]>(
        `/jobs`,
        { method: "GET" },
        session,
      );

      const found = (Array.isArray(allJobs) ? allJobs : []).find(
        (j) => Number(j.job_id) === jobId,
      );

      setJobSummary(found ?? null);

      // 2) Fetch report details (if linked)
      if (found?.report_id) {
        const r = await apiFetch<ReportDto>(
          `/reports/${found.report_id}`,
          { method: "GET" },
          session,
        );
        setReport(r ?? null);

        // ✅ also fetch report photos
        setReportPhotoUrls([]);
        loadReportPhotos(found.report_id);
      } else {
        setReport(null);
        setReportPhotoUrls([]);
      }

      // 3) Fetch tasks
      const t = await apiFetch<JobTask[]>(
        `/jobs/${jobId}/tasks`,
        { method: "GET" },
        session,
      );
      setTasks(Array.isArray(t) ? t : []);
    } catch (e: any) {
      Alert.alert("Failed to load job", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const createTask = async () => {
    if (!canEdit) return;

    const name = newTaskName.trim();
    if (!name) {
      Alert.alert("Task name required", "Please enter a task name.");
      return;
    }

    try {
      const nextOrder = tasks.length
        ? Math.max(...tasks.map((x) => x.task_order ?? 0)) + 1
        : 1;

      await apiFetch(
        `/jobs/${jobId}/tasks`,
        {
          method: "POST",
          body: JSON.stringify({
            task_name: name,
            task_desc: newTaskDesc.trim() || null,
            task_status: "pending",
            task_order: nextOrder,
          }),
        },
        session,
      );

      setNewTaskName("");
      setNewTaskDesc("");
      await fetchAll();
    } catch (e: any) {
      Alert.alert("Failed to create task", e?.message ?? "Unknown error");
    }
  };

  const setTaskStatus = async (taskId: number, status: TaskStatus) => {
    if (!canEdit) return;

    try {
      await apiFetch(
        `/tasks/${taskId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ task_status: status }),
        },
        session,
      );

      setTasks((prev) =>
        prev.map((t) =>
          t.task_id === taskId ? { ...t, task_status: status } : t,
        ),
      );
    } catch (e: any) {
      Alert.alert("Update failed", e?.message ?? "Unknown error");
    }
  };

  const allDone =
    tasks.length > 0 && tasks.every((t) => t.task_status === "done");

  const completeJob = async () => {
    if (!canEdit) return;

    if (!tasks.length) {
      Alert.alert(
        "Add tasks first",
        "Please add at least 1 task before completing the job.",
      );
      return;
    }
    if (!allDone) {
      Alert.alert(
        "Tasks not complete",
        "All tasks must be marked as Done before completing the job.",
      );
      return;
    }

    const reportId = jobSummary?.report_id ?? null;

    try {
      // 1) close the job
      await apiFetch(
        `/jobs/${jobId}/status`,
        { method: "PATCH", body: JSON.stringify({ to_status: "closed" }) },
        session,
      );

      // 2) close the linked report (if any)
      if (Number.isFinite(reportId) && (reportId as number) > 0) {
        await api.updateReportStatus(reportId as number, {
          report_status: "closed",
          // optional audit fields - only include if your backend expects them
          report_review_action: null,
          report_review_reason: null,
          report_review_by: null,
          report_review_at: new Date().toISOString(),
        });
      }

      Alert.alert(
        "Job completed",
        reportId ? "Job and report have been closed." : "Job has been closed.",
      );
      router.back();
    } catch (e: any) {
      Alert.alert("Failed to complete job", e?.message ?? "Unknown error");
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Job Details" }} />

      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Job #{jobId}</Text>

            <Text style={styles.headerSubtitle}>
              {jobSummary?.bus_id ?? "—"}
              {report?.report_location ? ` • ${report.report_location}` : ""}
            </Text>

            {!canEdit && (
              <Text style={styles.readOnlyHint}>
                View only — accept the job to update tasks.
              </Text>
            )}

            {loading && <Text style={styles.readOnlyHint}>Loading…</Text>}
          </View>

          <View style={styles.headerRight}>
            <StatusBadge type={normaliseReportType(jobSummary?.report_type)} />
            <StatusBadge
              type={normalisePriority(jobSummary?.report_priority)}
            />
          </View>
        </View>

        <View style={styles.divider} />

        {/* Initial Report details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Initial Report</Text>

          <Text style={styles.bodyText}>
            <Text style={{ fontWeight: "900" }}>Report ID: </Text>
            {jobSummary?.report_id ?? "—"}
          </Text>

          <Text style={styles.bodyText}>
            <Text style={{ fontWeight: "900" }}>Reported by: </Text>
            {jobSummary?.reporter_name ?? report?.reporter_name ?? "—"}
          </Text>

          <Text style={styles.bodyText}>
            <Text style={{ fontWeight: "900" }}>Priority: </Text>
            {jobSummary?.report_priority ?? report?.report_priority ?? "—"}
          </Text>

          <Text style={[styles.bodyText, { marginTop: 10 }]}>
            {report?.report_desc ?? jobSummary?.job_desc ?? "—"}
          </Text>

          {/* ✅ Report photos (tappable thumbnails) */}
          <View style={{ marginTop: 14 }}>
            <View style={styles.photoHeaderRow}>
              <Text style={styles.photoTitle}>Report Photos</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>
                  {reportPhotoMedia.length} photo
                  {reportPhotoMedia.length === 1 ? "" : "s"}
                </Text>
              </View>
            </View>

            {loadingReportPhotos ? (
              <Text style={styles.bodyTextMuted}>Loading photos…</Text>
            ) : reportPhotoUrls.length === 0 ? (
              <Text style={styles.bodyTextMuted}>No photos uploaded.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.previewRow}
                contentContainerStyle={styles.previewContent}
              >
                {reportPhotoUrls.map((uri, idx) => (
                  <Pressable
                    key={`${uri}-${idx}`}
                    style={styles.thumbWrap}
                    onPress={() => openViewer(idx)}
                  >
                    <View style={styles.thumbClip}>
                      <Image source={{ uri }} style={styles.thumb} />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>

        {/* Add Task form */}
        {canEdit && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add Task</Text>

            <View style={styles.inputWrap}>
              <TextInput
                value={newTaskName}
                onChangeText={setNewTaskName}
                placeholder="Task name (e.g., Replace brake pads)"
                placeholderTextColor="#6B7280"
                style={styles.input}
              />
            </View>

            <View style={[styles.inputWrap, { marginTop: 10 }]}>
              <TextInput
                value={newTaskDesc}
                onChangeText={setNewTaskDesc}
                placeholder="Notes / details (optional)"
                placeholderTextColor="#6B7280"
                style={styles.textarea}
                multiline
              />
            </View>

            <Pressable
              style={[styles.actionBtn, styles.updateBtn, { marginTop: 12 }]}
              onPress={createTask}
            >
              <Text style={styles.actionText}>Add Task</Text>
            </Pressable>
          </View>
        )}

        {/* Task list */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tasks</Text>

          {tasks.length === 0 ? (
            <Text style={styles.bodyTextMuted}>No tasks yet.</Text>
          ) : (
            tasks
              .slice()
              .sort((a, b) => (a.task_order ?? 0) - (b.task_order ?? 0))
              .map((t) => {
                const doingActive = t.task_status === "in_progress";
                const doneActive = t.task_status === "done";

                return (
                  <View key={t.task_id} style={styles.taskRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.taskName}>{t.task_name}</Text>
                      {!!t.task_desc && (
                        <Text style={styles.taskDesc}>{t.task_desc}</Text>
                      )}
                      <Text style={styles.taskMeta}>
                        Status: {t.task_status}
                      </Text>
                    </View>

                    {canEdit && (
                      <View style={styles.taskActions}>
                        <Pressable
                          style={[
                            styles.pillBtn,
                            doingActive && styles.pillActive,
                          ]}
                          onPress={() =>
                            setTaskStatus(t.task_id, "in_progress")
                          }
                        >
                          <Text
                            style={[
                              styles.pillTextSmall,
                              doingActive && styles.pillTextActive,
                            ]}
                          >
                            Doing
                          </Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.pillBtn,
                            doneActive && styles.pillActive,
                          ]}
                          onPress={() => setTaskStatus(t.task_id, "done")}
                        >
                          <Text
                            style={[
                              styles.pillTextSmall,
                              doneActive && styles.pillTextActive,
                            ]}
                          >
                            Done
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })
          )}
        </View>

        {/* After photos (local) */}
        <ImagePickerField
          title="After Photos"
          value={afterMedia}
          onChange={setAfterMedia}
          captureLabel="Capture After Photo"
          uploadLabel="Upload After Photo"
          showUploadButton
          readOnly={!canEdit}
        />

        {/* Complete job */}
        {canEdit && (
          <View style={styles.actions}>
            <Pressable
              style={[
                styles.actionBtn,
                styles.completeBtn,
                !allDone && { opacity: 0.6 },
              ]}
              onPress={completeJob}
            >
              <Text style={styles.actionText}>Complete Job</Text>
            </Pressable>

            {!allDone && tasks.length > 0 && (
              <Text style={styles.helperText}>
                All tasks must be marked as Done to complete the job.
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* ✅ Full screen image viewer */}
      <ImageViewerOverlay
        visible={viewerVisible}
        imageUrls={viewerUrls}
        startIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  pageContent: { padding: 16, paddingTop: 14, gap: 16 },

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerLeft: { flex: 1 },
  headerTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: "#111827",
    lineHeight: 38,
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: "700",
    color: "#6B7280",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },

  readOnlyHint: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: "800",
    color: "#6B7280",
  },

  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginTop: 8,
    marginBottom: 6,
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },

  bodyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    lineHeight: 22,
  },
  bodyTextMuted: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6B7280",
    lineHeight: 22,
  },

  inputWrap: {
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: { fontSize: 16, color: "#111827" },
  textarea: { minHeight: 70, fontSize: 16, color: "#111827" },

  taskRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  taskName: { fontSize: 16, fontWeight: "900", color: "#111827" },
  taskDesc: { marginTop: 4, fontSize: 14, fontWeight: "700", color: "#374151" },
  taskMeta: { marginTop: 6, fontSize: 13, fontWeight: "800", color: "#6B7280" },

  taskActions: { gap: 8, justifyContent: "center" },
  pillBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
  },
  pillActive: { backgroundColor: "#111827", borderColor: "#111827" },
  pillTextSmall: { fontSize: 13, fontWeight: "900", color: "#111827" },
  pillTextActive: { color: "#FFFFFF" },

  actions: { gap: 10, marginTop: 4, marginBottom: 28 },
  actionBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  updateBtn: { backgroundColor: "#111827" },
  completeBtn: { backgroundColor: "#16A34A" },
  actionText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  helperText: {
    color: "#6B7280",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },

  // report photo strip
  photoHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  photoTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  pillText: { fontSize: 14, fontWeight: "600", color: "#111827" },
  previewRow: { marginTop: 4 },
  previewContent: { paddingRight: 4 },
  thumbWrap: { marginRight: 10 },
  thumbClip: {
    width: 86,
    height: 86,
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  thumb: { width: "100%", height: "100%" },
});
