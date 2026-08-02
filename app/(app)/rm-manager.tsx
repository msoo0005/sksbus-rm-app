// RMManagerScreen.tsx
import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DeclineReasonModal from "../components/DeclineReasonModal";
import JobDetailsModal from "../components/JobDetailsModal";
import ReportCard from "../components/ReportCard";
import SegmentedTabs from "../components/SegmentedTabs";
import { useSession } from "../ctx";
import { useProject } from "../project-ctx";
import { Report } from "../types/report";

type Tab = "pending" | "open" | "closed" | "kpi";

type JobSummary = {
  job_id: number;
  report_id: number | null;
  job_status?: string | null;
  job_desc?: string | null;
  technician_user_id?: number | null;
  technician_name?: string | null;

  job_created_at?: string | null;
  job_accepted_at?: string | null;
  job_updated_at?: string | null;
  job_completed_at?: string | null;

  report_type?: string | null;
  report_priority?: string | null;
  report_desc?: string | null;
  report_location?: string | null;
  report_uploaded_at?: string | null;
  bus_id?: string | null;
  reporter_name?: string | null;
  reporter_email?: string | null;
};

function formatDate(isoLike?: string | null) {
  if (!isoLike) return "—";
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return String(isoLike);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function toLower(x: unknown) {
  return String(x ?? "").trim().toLowerCase();
}

function normaliseStatusToUi(raw?: string | null): Report["status"] {
  const s = toLower(raw);
  if (!s || s === "submitted" || s === "pending") return "pending";
  if (s === "open") return "open";
  if (s === "closed") return "closed";
  return "pending";
}

function normaliseType(raw?: string | null): Report["type"] {
  const s = toLower(raw);
  if (s === "problem" || s === "repair" || s === "accident") return s;
  return "problem";
}

function normaliseSeverity(raw?: string | null): Report["severity"] {
  const s = toLower(raw);
  if (s === "low" || s === "medium" || s === "high" || s === "critical") return s;
  return "medium";
}

function findJobForReport(jobs: JobSummary[], reportId: number) {
  return jobs.find((j) => Number(j?.report_id) === Number(reportId)) ?? null;
}

function mapApiRowToReport(r: any, job?: JobSummary | null): Report {
  const id = Number(r?.report_id ?? job?.report_id);
  const safeId = Number.isFinite(id) ? id : 0;

  const reporterName = r?.reporter_name ?? job?.reporter_name;
  const reporterEmail = r?.reporter_email ?? job?.reporter_email;

  const reportedBy =
    reporterName || reporterEmail
      ? `${reporterName ?? "Unknown"} (${reporterEmail ?? "—"})`
      : undefined;

  const audit = r?.report_review_action
    ? {
        action: String(r.report_review_action) as any,
        by: r.report_review_by ?? undefined,
        at: r.report_review_at ?? undefined,
        reason: r.report_review_reason ?? undefined,
      }
    : undefined;

  return {
    id: safeId,
    type: normaliseType(r?.report_type ?? job?.report_type),
    severity: normaliseSeverity(r?.report_priority ?? job?.report_priority),
    vehicle: String(r?.bus_id ?? job?.bus_id ?? "—"),
    location: String(r?.report_location ?? job?.report_location ?? "—"),
    lat: r?.report_lat ?? null,
    lng: r?.report_lng ?? null,
    description: String(r?.report_desc ?? job?.report_desc ?? job?.job_desc ?? ""),
    date: formatDate(r?.report_uploaded_at ?? job?.report_uploaded_at ?? job?.job_created_at),
    status: normaliseStatusToUi(r?.report_status ?? job?.job_status),
    reportedBy,
    assigned: job?.technician_name ?? undefined,
    audit,
  };
}

// ── KPI helpers ──────────────────────────────────────────────────────────────

function avgCompletionHours(jobs: JobSummary[]): number | null {
  const durations: number[] = [];
  for (const j of jobs) {
    const start = j.job_accepted_at ?? j.job_created_at;
    const end = j.job_completed_at;
    if (!start || !end) continue;
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms > 0) durations.push(ms / 3_600_000);
  }
  if (!durations.length) return null;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

const COMPLETED_STATUSES = new Set(["completed", "closed", "done"]);
const ACTIVE_STATUSES = new Set(["open", "assigned", "in_progress", "in progress", "active"]);

function jobCompletionHours(j: JobSummary): number | null {
  const start = j.job_accepted_at ?? j.job_created_at;
  const end = j.job_completed_at;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms > 0 ? ms / 3_600_000 : null;
}

function formatShortDate(isoLike?: string | null) {
  if (!isoLike) return "—";
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

type BadgeVariant = "filled-red" | "filled-dark" | "filled-blue" | "outline";

function getBadgeVariant(value: string): BadgeVariant {
  const v = toLower(value);
  if (v === "problem" || v === "high" || v === "critical") return "filled-red";
  if (v === "repair" || v === "medium" || v === "completed" || v === "in_progress" || v === "in progress") return "filled-dark";
  if (v === "open" || v === "assigned") return "filled-blue";
  return "outline";
}

function Badge({ label, neutral }: { label: string; neutral?: boolean }) {
  const variant = neutral ? "outline" : getBadgeVariant(label);
  const bg =
    variant === "filled-red" ? "#EF4444"
    : variant === "filled-dark" ? "#111827"
    : variant === "filled-blue" ? "#3B82F6"
    : "transparent";
  const textCol = variant === "outline" ? "#374151" : "#fff";
  const border = variant === "outline" ? "#D1D5DB" : bg;

  return (
    <View style={[tblStyles.badge, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[tblStyles.badgeText, { color: textCol }]}>{label.replace(/_/g, " ")}</Text>
    </View>
  );
}

function JobsTable({ jobs }: { jobs: JobSummary[] }) {
  const cols = ["Job ID", "Vehicle", "Category", "Priority", "Status", "Submitted", "Completion", "Technician", "Reporter"];
  const colWidths = [64, 80, 100, 90, 120, 100, 100, 130, 130];

  return (
    <View style={kpiStyles.section}>
      <Text style={kpiStyles.sectionTitle}>All Jobs</Text>
      {jobs.length === 0 ? (
        <Text style={kpiStyles.empty}>No jobs yet.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {/* Header */}
            <View style={[tblStyles.row, tblStyles.headerRow]}>
              {cols.map((c, i) => (
                <Text key={c} style={[tblStyles.headerCell, { width: colWidths[i] }]}>{c}</Text>
              ))}
            </View>
            {/* Rows */}
            {jobs.map((j, idx) => {
              const hrs = jobCompletionHours(j);
              return (
                <View key={j.job_id} style={[tblStyles.row, idx % 2 === 1 && tblStyles.rowAlt]}>
                  <Text style={[tblStyles.cell, { width: colWidths[0] }]}>#{j.job_id}</Text>
                  <Text style={[tblStyles.cell, { width: colWidths[1] }]}>{j.bus_id ?? "—"}</Text>
                  <View style={{ width: colWidths[2], justifyContent: "center" }}>
                    {j.report_type ? <Badge label={j.report_type} neutral /> : <Text style={tblStyles.cell}>—</Text>}
                  </View>
                  <View style={{ width: colWidths[3], justifyContent: "center" }}>
                    {j.report_priority ? <Badge label={j.report_priority} /> : <Text style={tblStyles.cell}>—</Text>}
                  </View>
                  <View style={{ width: colWidths[4], justifyContent: "center" }}>
                    {j.job_status ? <Badge label={j.job_status} /> : <Text style={tblStyles.cell}>—</Text>}
                  </View>
                  <Text style={[tblStyles.cell, { width: colWidths[5] }]}>
                    {formatShortDate(j.report_uploaded_at ?? j.job_created_at)}
                  </Text>
                  <Text style={[tblStyles.cell, { width: colWidths[6] }]}>
                    {hrs != null ? `${hrs.toFixed(1)}h` : "—"}
                  </Text>
                  <Text style={[tblStyles.cell, { width: colWidths[7] }]}>
                    {j.technician_name ?? "—"}
                  </Text>
                  <Text style={[tblStyles.cell, { width: colWidths[8] }]}>
                    {j.reporter_name ?? "—"}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  color = "#111827",
}: {
  icon: string;
  label: string;
  value: string;
  sub: string;
  color?: string;
}) {
  return (
    <View style={kpiStyles.card}>
      <View style={kpiStyles.cardHeader}>
        <Text style={kpiStyles.cardLabel}>{label}</Text>
        <FontAwesome5 name={icon} size={14} color="#9CA3AF" />
      </View>
      <Text style={[kpiStyles.cardValue, { color }]}>{value}</Text>
      <Text style={kpiStyles.cardSub}>{sub}</Text>
    </View>
  );
}

function KpiTab({
  reports,
  jobs,
}: {
  reports: Report[];
  jobs: JobSummary[];
}) {
  const totalJobs = jobs.length;
  const pendingCount = reports.filter((r) => r.status === "pending").length;
  const inProgressCount = jobs.filter((j) =>
    ACTIVE_STATUSES.has(toLower(j.job_status))
  ).length;
  const completedCount = jobs.filter((j) =>
    COMPLETED_STATUSES.has(toLower(j.job_status))
  ).length;
  const openCasesCount = reports.filter((r) => r.status === "open").length;

  const avgHrs = avgCompletionHours(jobs);
  const avgLabel = avgHrs == null ? "—" : `${avgHrs.toFixed(1)}h`;

  const completionRate = totalJobs > 0 ? completedCount / totalJobs : 0;
  const completionPct = `${(completionRate * 100).toFixed(1)}%`;

  // Report type breakdown
  const byType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of reports) {
      counts[r.type] = (counts[r.type] ?? 0) + 1;
    }
    return counts;
  }, [reports]);

  const totalReports = reports.length;

  return (
    <View style={kpiStyles.page}>
      {/* ── Row 1: stat cards ── */}
      <View style={kpiStyles.cardRow}>
        <KpiCard icon="chart-bar" label="Total Jobs" value={String(totalJobs)} sub="All time" />
        <KpiCard icon="clock" label="Pending Approval" value={String(pendingCount)} sub="Requires review" color="#D97706" />
      </View>
      <View style={kpiStyles.cardRow}>
        <KpiCard icon="chart-line" label="In Progress" value={String(inProgressCount)} sub="Active jobs" color="#2563EB" />
        <KpiCard icon="calendar-check" label="Avg. Completion" value={avgLabel} sub="Per job" color="#059669" />
      </View>

      {/* ── Completion Rate ── */}
      <View style={kpiStyles.section}>
        <Text style={kpiStyles.sectionTitle}>Completion Rate</Text>

        <View style={kpiStyles.progressRow}>
          <Text style={kpiStyles.progressLabel}>Overall Progress</Text>
          <Text style={kpiStyles.progressPct}>{completionPct}</Text>
        </View>
        <View style={kpiStyles.progressTrack}>
          <View style={[kpiStyles.progressFill, { flex: completionRate }]} />
          <View style={{ flex: 1 - completionRate }} />
        </View>

        <View style={kpiStyles.summaryRow}>
          <View style={kpiStyles.summaryCard}>
            <Text style={kpiStyles.summaryLabel}>Completed</Text>
            <Text style={kpiStyles.summaryValue}>{completedCount}</Text>
          </View>
          <View style={kpiStyles.summaryCard}>
            <Text style={kpiStyles.summaryLabel}>In Progress</Text>
            <Text style={kpiStyles.summaryValue}>{inProgressCount}</Text>
          </View>
          <View style={kpiStyles.summaryCard}>
            <Text style={kpiStyles.summaryLabel}>Open Cases</Text>
            <Text style={kpiStyles.summaryValue}>{openCasesCount}</Text>
          </View>
        </View>
      </View>

      {/* ── Report Breakdown ── */}
      <View style={kpiStyles.section}>
        <Text style={kpiStyles.sectionTitle}>Reports by Type</Text>
        {totalReports === 0 ? (
          <Text style={kpiStyles.empty}>No reports yet.</Text>
        ) : (
          Object.entries(byType).map(([type, count]) => {
            const pct = count / totalReports;
            return (
              <View key={type} style={{ marginBottom: 14 }}>
                <View style={kpiStyles.barLabelRow}>
                  <Text style={kpiStyles.barLabel}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Text>
                  <Text style={kpiStyles.barCount}>{count}</Text>
                </View>
                <View style={kpiStyles.progressTrack}>
                  <View style={[kpiStyles.progressFill, kpiStyles.typeFill, { flex: pct }]} />
                  <View style={{ flex: 1 - pct }} />
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* ── Report Status Overview ── */}
      <View style={kpiStyles.section}>
        <Text style={kpiStyles.sectionTitle}>Report Status Overview</Text>
        {[
          { label: "Pending Approval", count: pendingCount, color: "#F59E0B" },
          { label: "Open / In Progress", count: openCasesCount, color: "#3B82F6" },
          { label: "Closed", count: reports.filter((r) => r.status === "closed").length, color: "#10B981" },
        ].map(({ label, count, color }) => (
          <View key={label} style={kpiStyles.statusRow}>
            <View style={[kpiStyles.dot, { backgroundColor: color }]} />
            <Text style={kpiStyles.statusLabel}>{label}</Text>
            <Text style={kpiStyles.statusCount}>{count}</Text>
          </View>
        ))}
      </View>

      {/* ── All Jobs table ── */}
      <JobsTable jobs={jobs} />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function RMManagerScreen() {
  const router = useRouter();
  const { dbUser } = useSession() as any;
  const { projectId } = useProject();

  const MANAGER_NAME = dbUser?.user_name ?? "RM Manager";

  const [tab, setTab] = useState<Tab>("pending");
  const [allReports, setAllReports] = useState<Report[]>([]);
  const [rawJobs, setRawJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [approveTarget, setApproveTarget] = useState<Report | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);

  const [declineTarget, setDeclineTarget] = useState<Report | null>(null);
  const [declineVisible, setDeclineVisible] = useState(false);

  const [detailsReport, setDetailsReport] = useState<Report | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsMedia, setDetailsMedia] = useState<any[]>([]);
  const [loadingDetailsMedia, setLoadingDetailsMedia] = useState(false);

  const loadAllReports = useCallback(async (opts?: { refreshing?: boolean }) => {
    try {
      if (opts?.refreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const [reportRows, jobRows] = await Promise.all([
        api.listReports(projectId ? { project_id: projectId } : undefined),
        api.listJobs(projectId ? { project_id: projectId } : undefined),
      ]);

      const jobs = Array.isArray(jobRows) ? (jobRows as JobSummary[]) : [];
      setRawJobs(jobs);

      const mapped = Array.isArray(reportRows)
        ? reportRows.map((r: any) => {
            const reportId = Number(r?.report_id);
            const job = findJobForReport(jobs, reportId);
            return mapApiRowToReport(r, job);
          })
        : [];

      setAllReports(mapped.filter((r) => r.id > 0));
    } catch (e: any) {
      console.log(e);
      Alert.alert("Couldn't load reports", e?.message ?? "Unknown error");
      setAllReports([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      loadAllReports();
    }, [loadAllReports]),
  );

  const reports = useMemo(() => {
    return allReports.filter((r) => r.status === tab);
  }, [allReports, tab]);

  const counts = useMemo(
    () => ({
      pending: allReports.filter((r) => r.status === "pending").length,
      open: allReports.filter((r) => r.status === "open").length,
      closed: allReports.filter((r) => r.status === "closed").length,
    }),
    [allReports],
  );

  const onRefresh = useCallback(async () => {
    await loadAllReports({ refreshing: true });
  }, [loadAllReports]);

  const openReportDetails = useCallback(async (report: Report) => {
    setDetailsReport(report);
    setDetailsVisible(true);
    setDetailsMedia([]);
    setLoadingDetailsMedia(true);
    try {
      const media = await api.listReportMedia(report.id);
      setDetailsMedia(Array.isArray(media) ? media : []);
    } catch (e) {
      console.log(e);
    } finally {
      setLoadingDetailsMedia(false);
    }
  }, []);

  const handleViewDetails = useCallback(
    async (report: Report) => {
      const reportId = report.id;
      if (!Number.isFinite(reportId) || reportId <= 0) return;

      // If a job already exists for this report (approved/open/closed), show the full job view.
      try {
        const jobs = await api.listJobs();
        const list = Array.isArray(jobs) ? (jobs as JobSummary[]) : [];
        const found = findJobForReport(list, reportId);
        const jobId = Number(found?.job_id);

        if (Number.isFinite(jobId) && jobId > 0) {
          router.push({
            pathname: "/(app)/rm-manager/job/[id]",
            params: { id: String(jobId) },
          });
          return;
        }
      } catch (e: any) {
        console.log(e);
      }

      // No job yet (e.g. still pending review) — show the report details inline.
      await openReportDetails(report);
    },
    [router, openReportDetails],
  );

  const requestApprove = (report: Report) => {
    setApproveTarget(report);
    setApproveVisible(true);
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;

    const reportId = approveTarget.id;

    if (!Number.isFinite(reportId) || reportId <= 0) {
      Alert.alert("Approve failed", "Invalid report id");
      setApproveVisible(false);
      setApproveTarget(null);
      return;
    }

    setAllReports((prev) =>
      prev.map((r) =>
        r.id === reportId
          ? {
              ...r,
              status: "open",
              audit: { action: "approved", by: MANAGER_NAME, at: new Date().toISOString() },
            }
          : r,
      ),
    );

    setApproveVisible(false);
    setApproveTarget(null);

    try {
      await api.createJobForReport(reportId, { job_desc: null });

      await api.updateReportStatus(reportId, {
        report_status: "open",
        report_review_action: "approved",
        report_review_reason: null,
        report_review_by: MANAGER_NAME,
        report_review_at: new Date().toISOString(),
      });

      await loadAllReports({ refreshing: true });
    } catch (e: any) {
      Alert.alert("Approve failed", e?.message ?? "Unknown error");
      await loadAllReports({ refreshing: true });
    }
  };

  const requestDecline = (report: Report) => {
    setDeclineTarget(report);
    setDeclineVisible(true);
  };

  const submitDecline = async (reason: string) => {
    if (!declineTarget) return;

    const reportId = declineTarget.id;

    if (!Number.isFinite(reportId) || reportId <= 0) {
      Alert.alert("Decline failed", "Invalid report id");
      setDeclineVisible(false);
      setDeclineTarget(null);
      return;
    }

    setAllReports((prev) =>
      prev.map((r) =>
        r.id === reportId
          ? {
              ...r,
              status: "closed",
              audit: {
                action: "declined",
                by: MANAGER_NAME,
                at: new Date().toISOString(),
                reason,
              },
            }
          : r,
      ),
    );

    setDeclineVisible(false);
    setDeclineTarget(null);

    try {
      await api.updateReportStatus(reportId, {
        report_status: "closed",
        report_review_action: "declined",
        report_review_reason: reason,
        report_review_by: MANAGER_NAME,
        report_review_at: new Date().toISOString(),
      });

      await loadAllReports({ refreshing: true });
    } catch (e: any) {
      Alert.alert("Decline failed", e?.message ?? "Unknown error");
      await loadAllReports({ refreshing: true });
    }
  };

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: "#f9f9f9" }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Pressable
          style={styles.projectFilterChip}
          onPress={() => router.push("/project-selector?returnTo=/rm-manager&allowClear=1" as any)}
        >
          <FontAwesome5 name="folder" size={12} color="#374151" />
          <Text style={styles.projectFilterChipText}>
            {projectId ? `Project: ${projectId}` : "All Projects"}
          </Text>
          <FontAwesome5 name="chevron-down" size={10} color="#9CA3AF" />
        </Pressable>

        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "pending", label: `Pending (${counts.pending})` },
            { key: "open", label: `Open (${counts.open})` },
            { key: "closed", label: `Closed (${counts.closed})` },
            { key: "kpi", label: "KPIs", icon: "chart-bar" },
          ]}
        />

        {tab === "kpi" ? (
          <KpiTab reports={allReports} jobs={rawJobs} />
        ) : loading ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: "#666" }}>Loading reports…</Text>
          </View>
        ) : reports.length === 0 ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: "#666" }}>No reports in this tab.</Text>
          </View>
        ) : (
          reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onViewDetails={handleViewDetails}
              onApprove={tab === "pending" ? requestApprove : undefined}
              onDecline={tab === "pending" ? requestDecline : undefined}
            />
          ))
        )}
      </ScrollView>

      <ConfirmActionModal
        visible={approveVisible}
        title="Approve Job"
        message="Are you sure you want to approve this job?"
        confirmLabel="Approve Job"
        confirmColor="#4CAF50"
        onCancel={() => setApproveVisible(false)}
        onConfirm={confirmApprove}
      />

      <DeclineReasonModal
        visible={declineVisible}
        onCancel={() => setDeclineVisible(false)}
        onSubmit={submitDecline}
      />

      <JobDetailsModal
        visible={detailsVisible}
        report={detailsReport}
        media={detailsMedia}
        loadingMedia={loadingDetailsMedia}
        onClose={() => setDetailsVisible(false)}
      />
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  projectFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  projectFilterChipText: { fontSize: 13, fontWeight: "700", color: "#374151" },
});

const kpiStyles = StyleSheet.create({
  page: { padding: 16, gap: 16, paddingBottom: 40 },

  cardRow: { flexDirection: "row", gap: 12 },
  card: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    gap: 6,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardLabel: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  cardValue: { fontSize: 32, fontWeight: "800", color: "#111827" },
  cardSub: { fontSize: 12, color: "#9CA3AF", fontWeight: "500" },

  section: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },

  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { fontSize: 13, fontWeight: "600", color: "#6B7280" },
  progressPct: { fontSize: 13, fontWeight: "700", color: "#111827" },
  progressTrack: {
    flexDirection: "row",
    height: 10,
    borderRadius: 999,
    backgroundColor: "#E5E7EB",
    overflow: "hidden",
  },
  progressFill: { backgroundColor: "#111827", borderRadius: 999 },
  typeFill: { backgroundColor: "#3B82F6" },

  summaryRow: { flexDirection: "row", gap: 10 },
  summaryCard: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  summaryLabel: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  summaryValue: { fontSize: 22, fontWeight: "800", color: "#111827" },

  barLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  barLabel: { fontSize: 13, fontWeight: "600", color: "#374151" },
  barCount: { fontSize: 13, fontWeight: "700", color: "#111827" },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { flex: 1, fontSize: 14, color: "#374151", fontWeight: "600" },
  statusCount: { fontSize: 14, fontWeight: "800", color: "#111827" },

  empty: { fontSize: 13, color: "#9CA3AF", fontWeight: "500" },
});

const tblStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  headerRow: { borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  rowAlt: { backgroundColor: "#FAFAFA" },
  headerCell: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6B7280",
    paddingRight: 8,
  },
  cell: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    paddingRight: 8,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
});
