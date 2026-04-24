// components/JobDetailsView.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ReportMedia } from "../api/client";
import { api } from "../api/client";
import ImageViewerOverlay from "./ImageViewerOverlay";
import type { StatusType } from "./StatusBadge";
import StatusBadge from "./StatusBadge";

type TaskStatus = "pending" | "in_progress" | "blocked" | "done";

type JobListItem = {
  job_id: number;
  job_desc: string | null;
  job_status: string;
  technician_user_id: number | null;

  job_created_at?: string | null;
  job_accepted_at?: string | null; // ✅ NEW (needs to exist in /jobs row)
  job_odometer?: number | null;

  report_id: number | null;
  report_type: string | null;
  report_priority: string | null;
  bus_id: string | null;
  reporter_name: string | null;

  // ✅ optional (if your /jobs returns it)
  technician_name?: string | null;
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
  completed_at?: string | null;
};

const isNonEmptyString = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;

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

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function formatAssignee(job?: JobListItem | null) {
  if (!job) return "—";
  const name = (job.technician_name ?? "").trim();
  if (name) return name;

  const id = job.technician_user_id;
  if (typeof id === "number" && Number.isFinite(id)) return `User #${id}`;

  return "Unassigned";
}

export default function JobDetailsView({
  jobId,
  headerHint,
}: {
  jobId: number;
  headerHint?: string;
}) {
  const [loading, setLoading] = useState(false);

  const [jobSummary, setJobSummary] = useState<JobListItem | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [tasks, setTasks] = useState<JobTask[]>([]);

  const [reportPhotoUrls, setReportPhotoUrls] = useState<string[]>([]);
  const [loadingReportPhotos, setLoadingReportPhotos] = useState(false);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const viewerUrls = useMemo(
    () => reportPhotoUrls.map((u) => ({ url: u })),
    [reportPhotoUrls],
  );

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

  const fetchAll = async () => {
    if (!Number.isFinite(jobId) || jobId <= 0) return;

    setLoading(true);
    try {
      const allJobs = (await api.listJobs()) as JobListItem[];
      const found = (Array.isArray(allJobs) ? allJobs : []).find(
        (j) => Number(j.job_id) === jobId,
      );
      setJobSummary(found ?? null);

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

  const completedTasks = useMemo(() => {
    return tasks
      .filter((t) => t.task_status === "done")
      .slice()
      .sort((a, b) => {
        const ad = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bd = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        if (bd !== ad) return bd - ad;
        return (b.task_order ?? 0) - (a.task_order ?? 0);
      });
  }, [tasks]);

  const assigneeLabel = useMemo(() => formatAssignee(jobSummary), [jobSummary]);

  const acceptedAtLabel = useMemo(() => {
    const iso =
      jobSummary?.job_accepted_at ??
      // fallback if you never added accepted_at yet:
      (jobSummary?.technician_user_id ? jobSummary?.job_created_at : null);

    return formatDateTime(iso ?? null);
  }, [
    jobSummary?.job_accepted_at,
    jobSummary?.job_created_at,
    jobSummary?.technician_user_id,
  ]);

  return (
    <>
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

            {/* ✅ NEW: Assigned + Accepted */}
            <View style={styles.metaRow}>
              <View style={styles.metaPill}>
                <Text style={styles.metaLabel}>Assigned to</Text>
                <Text style={styles.metaValue}>{assigneeLabel}</Text>
              </View>

              <View style={styles.metaPill}>
                <Text style={styles.metaLabel}>Accepted</Text>
                <Text style={styles.metaValue}>{acceptedAtLabel}</Text>
              </View>
            </View>

            <Text style={styles.readOnlyHint}>{headerHint ?? "View only"}</Text>

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

        {/* Job info */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Job Info</Text>

          <Text style={styles.bodyText}>
            <Text style={{ fontWeight: "900" }}>Status: </Text>
            {jobSummary?.job_status ?? "—"}
          </Text>

          <Text style={styles.bodyText}>
            <Text style={{ fontWeight: "900" }}>Initial Odometer: </Text>
            {jobSummary?.job_odometer ?? "—"}
          </Text>

          {!!jobSummary?.job_desc && (
            <Text style={[styles.bodyText, { marginTop: 10 }]}>
              {jobSummary.job_desc}
            </Text>
          )}
        </View>

        {/* Initial Report */}
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

          {/* Photos */}
          <View style={{ marginTop: 14 }}>
            <View style={styles.photoHeaderRow}>
              <Text style={styles.photoTitle}>Report Photos</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>
                  {reportPhotoUrls.length} photo
                  {reportPhotoUrls.length === 1 ? "" : "s"}
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

        {/* Completed tasks */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Completed Tasks</Text>

          {completedTasks.length === 0 ? (
            <Text style={styles.bodyTextMuted}>No completed tasks yet.</Text>
          ) : (
            completedTasks.map((t) => (
              <View key={t.task_id} style={styles.taskRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskName}>{t.task_name}</Text>
                  {!!t.task_desc && (
                    <Text style={styles.taskDesc}>{t.task_desc}</Text>
                  )}
                  <Text style={styles.taskMeta}>
                    Completed: {formatDateTime(t.completed_at)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

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

  // ✅ NEW header meta row
  metaRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  metaPill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    flexGrow: 1,
    minWidth: 160,
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: "900",
    color: "#6B7280",
  },
  metaValue: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    shadowOpacity: 0.08,
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
