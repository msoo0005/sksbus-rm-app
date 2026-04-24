// RMManagerScreen.tsx
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";

import { api } from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DeclineReasonModal from "../components/DeclineReasonModal";
import ReportCard from "../components/ReportCard";
import SegmentedTabs from "../components/SegmentedTabs";
import { useSession } from "../ctx";
import { Report } from "../types/report";

type Tab = "pending" | "open" | "closed";

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
  return d.toLocaleString();
}

function toLower(x: unknown) {
  return String(x ?? "")
    .trim()
    .toLowerCase();
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
  if (s === "low" || s === "medium" || s === "high" || s === "critical") {
    return s;
  }
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
    description: String(
      r?.report_desc ?? job?.report_desc ?? job?.job_desc ?? "",
    ),
    date: formatDate(
      r?.report_uploaded_at ?? job?.report_uploaded_at ?? job?.job_created_at,
    ),
    status: normaliseStatusToUi(r?.report_status ?? job?.job_status),
    reportedBy,
    assigned: job?.technician_name ?? undefined,
    audit,
  };
}

export default function RMManagerScreen() {
  const router = useRouter();
  const { dbUser } = useSession() as any;

  const MANAGER_NAME = dbUser?.user_name ?? "RM Manager";

  const [tab, setTab] = useState<Tab>("pending");
  const [allReports, setAllReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [approveTarget, setApproveTarget] = useState<Report | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);

  const [declineTarget, setDeclineTarget] = useState<Report | null>(null);
  const [declineVisible, setDeclineVisible] = useState(false);

  const loadAllReports = useCallback(
    async (opts?: { refreshing?: boolean }) => {
      try {
        if (opts?.refreshing) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const [reportRows, jobRows] = await Promise.all([
          api.listReports(),
          api.listJobs(),
        ]);

        const jobs = Array.isArray(jobRows) ? (jobRows as JobSummary[]) : [];

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
        Alert.alert("Couldn’t load reports", e?.message ?? "Unknown error");
        setAllReports([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    loadAllReports();
  }, [loadAllReports]);

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

  const openJobViewForReport = useCallback(
    async (reportId: number) => {
      if (!Number.isFinite(reportId) || reportId <= 0) return;

      try {
        const jobs = await api.listJobs();
        const list = Array.isArray(jobs) ? (jobs as JobSummary[]) : [];

        const found = findJobForReport(list, reportId);
        const jobId = Number(found?.job_id);

        if (!Number.isFinite(jobId) || jobId <= 0) {
          Alert.alert(
            "No job yet",
            "This report does not have a job created yet.",
          );
          return;
        }

        router.push({
          pathname: "/(app)/rm-manager/job/[id]",
          params: { id: String(jobId) },
        });
      } catch (e: any) {
        console.log(e);
        Alert.alert("Couldn’t open job", e?.message ?? "Unknown error");
      }
    },
    [router],
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
              audit: {
                action: "approved",
                by: MANAGER_NAME,
                at: new Date().toISOString(),
              },
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
        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "pending", label: `Pending (${counts.pending})` },
            { key: "open", label: `Open (${counts.open})` },
            { key: "closed", label: `Closed (${counts.closed})` },
          ]}
        />

        {loading ? (
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
              onViewDetails={(r) => openJobViewForReport(r.id)}
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
    </>
  );
}
