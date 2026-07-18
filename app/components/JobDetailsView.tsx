import { FontAwesome5 } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { openDirections } from "../utils/directions";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { JobMedia, ReportMedia } from "../api/client";
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
  job_accepted_at?: string | null;
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
  return String(x ?? "").trim().toLowerCase();
}

function normaliseReportType(x: unknown): StatusType {
  const v = toLower(x);
  if (v === "repair" || v === "problem" || v === "accident") return v;
  return "repair";
}

function normalisePriority(x: unknown): StatusType {
  const v = toLower(x);
  if (v === "low" || v === "medium" || v === "high" || v === "critical") return v;
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
  const [afterPhotoUrls, setAfterPhotoUrls] = useState<string[]>([]);
  const [loadingAfterPhotos, setLoadingAfterPhotos] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [afterViewerVisible, setAfterViewerVisible] = useState(false);
  const [afterViewerIndex, setAfterViewerIndex] = useState(0);

  const viewerUrls = useMemo(
    () => reportPhotoUrls.map((u) => ({ url: u })),
    [reportPhotoUrls],
  );

  const afterViewerUrls = useMemo(
    () => afterPhotoUrls.map((u) => ({ url: u })),
    [afterPhotoUrls],
  );

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
      const media = (await api.listJobMedia(jId)) as JobMedia[];
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

      setAfterPhotoUrls([]);
      loadAfterPhotos(jobId);
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
        return bd !== ad ? bd - ad : (b.task_order ?? 0) - (a.task_order ?? 0);
      });
  }, [tasks]);

  const assigneeLabel = useMemo(() => formatAssignee(jobSummary), [jobSummary]);

  const acceptedAtLabel = useMemo(() => {
    const iso =
      jobSummary?.job_accepted_at ??
      (jobSummary?.technician_user_id ? jobSummary?.job_created_at : null);
    return formatDateTime(iso ?? null);
  }, [jobSummary?.job_accepted_at, jobSummary?.job_created_at, jobSummary?.technician_user_id]);

  return (
    <>
      <ScrollView style={s.page} contentContainerStyle={s.content}>

        {/* ── Hero header ── */}
        <View style={s.hero}>
          <View style={s.heroTop}>
            <View style={s.heroLeft}>
              <Text style={s.heroEyebrow}>JOB</Text>
              <Text style={s.heroId}>#{jobId}</Text>
              {loading && <Text style={s.loadingText}>Loading…</Text>}
            </View>
            <View style={s.badgeStack}>
              <StatusBadge type={normaliseReportType(jobSummary?.report_type)} />
              <StatusBadge type={normalisePriority(jobSummary?.report_priority)} />
            </View>
          </View>

          {(jobSummary?.bus_id || report?.report_location) && (
            <View style={s.heroSubRow}>
              {jobSummary?.bus_id && (
                <View style={s.heroChip}>
                  <FontAwesome5 name="bus" size={11} color="#6B7280" />
                  <Text style={s.heroChipText}>{jobSummary.bus_id}</Text>
                </View>
              )}
              {report?.report_location && (
                <Pressable
                  style={({ pressed }) => [s.heroChip, report.report_lat != null && s.heroChipTappable, pressed && { opacity: 0.6 }]}
                  onPress={() => {
                    if (report.report_lat != null && report.report_lng != null) {
                      openDirections(report.report_lat, report.report_lng);
                    }
                  }}
                  disabled={report.report_lat == null}
                >
                  <FontAwesome5 name="map-marker-alt" size={11} color={report.report_lat != null ? "#2563EB" : "#6B7280"} />
                  <Text style={[s.heroChipText, report.report_lat != null && { color: "#2563EB" }]}>{report.report_location}</Text>
                  {report.report_lat != null && (
                    <FontAwesome5 name="directions" size={11} color="#2563EB" />
                  )}
                </Pressable>
              )}
            </View>
          )}

          {headerHint && (
            <View style={s.hintBanner}>
              <FontAwesome5 name="info-circle" size={12} color="#2563EB" />
              <Text style={s.hintText}>{headerHint}</Text>
            </View>
          )}
        </View>

        {/* ── Meta row ── */}
        <View style={s.metaRow}>
          <View style={s.metaCard}>
            <Text style={s.metaLabel}>ASSIGNED TO</Text>
            <Text style={s.metaValue}>{assigneeLabel}</Text>
          </View>
          <View style={[s.metaCard, { marginLeft: 12 }]}>
            <Text style={s.metaLabel}>ACCEPTED AT</Text>
            <Text style={s.metaValue}>{acceptedAtLabel}</Text>
          </View>
        </View>

        {/* ── Job Info ── */}
        <SectionCard title="Job Info" icon="briefcase">
          <Field label="Status" value={jobSummary?.job_status} />
          <Field
            label="Initial Odometer"
            value={jobSummary?.job_odometer != null ? String(jobSummary.job_odometer) : null}
          />
          {!!jobSummary?.job_desc && (
            <Field label="Notes" value={jobSummary.job_desc} />
          )}
        </SectionCard>

        {/* ── Initial Report ── */}
        <SectionCard title="Initial Report" icon="file-alt">
          <Field
            label="Report ID"
            value={jobSummary?.report_id != null ? `#${jobSummary.report_id}` : null}
          />
          <Field
            label="Reported By"
            value={jobSummary?.reporter_name ?? report?.reporter_name}
          />
          <Field
            label="Priority"
            value={jobSummary?.report_priority ?? report?.report_priority}
          />
          <Field
            label="Description"
            value={report?.report_desc ?? jobSummary?.job_desc}
          />

          {/* Photos */}
          <View style={s.photoSection}>
            <View style={s.photoHeaderRow}>
              <Text style={s.photoTitle}>PHOTOS</Text>
              <View style={s.countPill}>
                <Text style={s.countPillText}>
                  {reportPhotoUrls.length} photo{reportPhotoUrls.length === 1 ? "" : "s"}
                </Text>
              </View>
            </View>

            {loadingReportPhotos ? (
              <Text style={s.mutedText}>Loading photos…</Text>
            ) : reportPhotoUrls.length === 0 ? (
              <Text style={s.mutedText}>No photos attached.</Text>
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
                      <FontAwesome5 name="expand-alt" size={14} color="#fff" />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </SectionCard>

        {/* ── Completed Tasks ── */}
        <SectionCard title="Completed Tasks" icon="check-circle">
          {completedTasks.length === 0 ? (
            <Text style={s.mutedText}>No completed tasks yet.</Text>
          ) : (
            completedTasks.map((t, i) => (
              <View
                key={t.task_id}
                style={[s.taskRow, i > 0 && s.taskRowBorder]}
              >
                <View style={s.taskCheck}>
                  <FontAwesome5 name="check" size={11} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.taskName}>{t.task_name}</Text>
                  {!!t.task_desc && (
                    <Text style={s.taskDesc}>{t.task_desc}</Text>
                  )}
                  <Text style={s.taskMeta}>
                    Completed {formatDateTime(t.completed_at)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </SectionCard>

        {/* ── After Photos ── */}
        <SectionCard title="After Photos" icon="camera">
          <View style={s.photoSection}>
            <View style={s.photoHeaderRow}>
              <Text style={s.photoTitle}>UPLOADED</Text>
              <View style={s.countPill}>
                <Text style={s.countPillText}>
                  {afterPhotoUrls.length} photo{afterPhotoUrls.length === 1 ? "" : "s"}
                </Text>
              </View>
            </View>

            {loadingAfterPhotos ? (
              <Text style={s.mutedText}>Loading photos…</Text>
            ) : afterPhotoUrls.length === 0 ? (
              <Text style={s.mutedText}>No after photos uploaded yet.</Text>
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
          </View>
        </SectionCard>

      </ScrollView>

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
    </>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, paddingTop: 14, gap: 14, paddingBottom: 32 },

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
  heroEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  heroId: {
    fontSize: 36,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -1,
  },
  loadingText: {
    fontSize: 13,
    color: "#9CA3AF",
    marginTop: 4,
  },
  badgeStack: { flexDirection: "row", gap: 6, paddingTop: 4, flexWrap: "wrap", justifyContent: "flex-end" },

  heroSubRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  heroChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F9FAFB",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  heroChipTappable: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  heroChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
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
  hintText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2563EB",
  },

  // Meta row
  metaRow: {
    flexDirection: "row",
  },
  metaCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },

  // Section card
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
  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
    letterSpacing: 0.2,
  },
  cardDivider: {
    height: 1,
    backgroundColor: "#F3F4F6",
    marginBottom: 14,
  },

  // Fields
  field: {
    marginBottom: 12,
  },
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

  // Misc
  mutedText: {
    fontSize: 14,
    color: "#9CA3AF",
    fontWeight: "500",
  },

  // Photos
  photoSection: {
    marginTop: 6,
  },
  photoHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  photoTitle: {
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
  countPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6B7280",
  },
  photoStrip: {
    gap: 10,
    paddingBottom: 2,
  },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: 14,
    overflow: "hidden",
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Tasks
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
  },
  taskRowBorder: {
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  taskCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  taskName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 2,
  },
  taskDesc: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 4,
  },
  taskMeta: {
    fontSize: 12,
    color: "#9CA3AF",
    fontWeight: "500",
  },
});
