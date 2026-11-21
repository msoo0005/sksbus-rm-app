// RMManagerScreen.tsx
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";

import { api } from "@/api/client";
import { uploadVerificationSelfie } from "@/api/media";
import type { LocalMedia } from "@/components/ImagePicker";
import SignoffSheet from "@/components/SignoffSheet";
import { formatBusLabel } from "@/utils/busLabel";
import DeclineReasonModal from "@/components/DeclineReasonModal";
import JobDetailsModal from "@/components/JobDetailsModal";
import ReportCard from "@/components/ReportCard";
import SegmentedTabs from "@/components/SegmentedTabs";
import SortMenu, { useJobSort } from "@/components/SortMenu";
import { useI18n } from "@/i18n/i18n-ctx";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { Report } from "@/types/report";
import { sortJobs } from "@/utils/jobSort";

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
  bus_ev_no?: string | null;
  report_issue_type?: string | null;
  reporter_name?: string | null;
  reporter_email?: string | null;
  job_accept_verified_name?: string | null;
  job_accept_selfie_view_url?: string | null;
  // v2.0.0
  job_state?: string | null;
  job_ref_no?: string | null;
  job_source?: string | null;
  job_issued_at?: string | null;
  job_approved_at?: string | null;
  job_late_flag?: number | null;
  technician_username?: string | null;
  reporter_username?: string | null;
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
  if (s === "problem" || s === "repair" || s === "accident" || s === "job_order") return s;
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

function mapApiRowToReport(r: any, job: JobSummary | null | undefined, t: (key: string) => string): Report {
  const id = Number(r?.report_id ?? job?.report_id);
  const safeId = Number.isFinite(id) ? id : 0;

  const reporterName = r?.reporter_name ?? job?.reporter_name;
  const reporterEmail = r?.reporter_email ?? job?.reporter_email;

  const reportedBy =
    reporterName || reporterEmail
      ? `${reporterName ?? t("common.unknown")} (${reporterEmail ?? "—"})`
      : undefined;

  const audit = r?.report_review_action
    ? {
        action: String(r.report_review_action) as any,
        by: r.report_review_by ?? undefined,
        at: r.report_review_at ?? undefined,
        reason: r.report_review_reason ?? undefined,
        person: {
          name: r.report_review_verified_name ?? null,
          username: r.report_review_by ?? null,
          selfieUrl: r.report_review_selfie_view_url ?? null,
        },
      }
    : undefined;

  return {
    id: safeId,
    reporter: {
      name: r?.report_verified_name ?? reporterName ?? null,
      username: r?.reporter_username ?? job?.reporter_username ?? null,
      selfieUrl: r?.report_selfie_view_url ?? null,
    },
    refNo: job?.job_ref_no ?? r?.report_ref_no ?? r?.job_ref_no ?? null,
    jobId: job?.job_id ?? r?.job_id ?? null,
    jobState: job?.job_state ?? null,
    jobSource: job?.job_source ?? null,
    clockStart:
      job?.job_source === "FOLLOW_UP"
        ? job?.job_issued_at ?? null
        : r?.report_uploaded_at ?? job?.report_uploaded_at ?? null,
    clockEnd: job?.job_approved_at ?? null,
    late: !!Number(job?.job_late_flag ?? 0) && job?.job_state === "accepted",
    type: normaliseType(r?.report_type ?? job?.report_type),
    severity: normaliseSeverity(r?.report_priority ?? job?.report_priority),
    vehicle: String(r?.bus_id ?? job?.bus_id ?? "—"),
    evNumber: r?.bus_ev_no ?? job?.bus_ev_no ?? null,
    issueType: r?.report_issue_type ?? job?.report_issue_type ?? null,
    location: String(r?.report_location ?? job?.report_location ?? "—"),
    lat: r?.report_lat ?? null,
    lng: r?.report_lng ?? null,
    description: String(r?.report_desc ?? job?.report_desc ?? job?.job_desc ?? ""),
    date: formatDate(r?.report_uploaded_at ?? job?.report_uploaded_at ?? job?.job_created_at),
    dateIso: r?.report_uploaded_at ?? job?.report_uploaded_at ?? job?.job_created_at ?? null,
    // A job's completion closes its report; a declined report has no job and
    // closed at review time.
    closedAt: r?.job_completed_at ?? job?.job_completed_at ?? r?.report_review_at ?? null,
    status: normaliseStatusToUi(r?.report_status ?? job?.job_status),
    reportedBy,
    assigned: job?.technician_name ?? r?.technician_name ?? undefined,
    assignee:
      job?.technician_user_id != null || r?.technician_user_id != null
        ? {
            name: job?.job_accept_verified_name ?? job?.technician_name ?? r?.job_accept_verified_name ?? r?.technician_name ?? null,
            username: job?.technician_username ?? r?.technician_username ?? null,
            selfieUrl: job?.job_accept_selfie_view_url ?? r?.job_accept_selfie_view_url ?? null,
          }
        : undefined,
    audit,
  };
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function RMManagerScreen() {
  const router = useRouter();
  const projectId = useProjectFilter();
  const { t } = useI18n();

  const [tab, setTab] = useState<Tab>("pending");
  const [allReports, setAllReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [approveTarget, setApproveTarget] = useState<Report | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);
  const [approving, setApproving] = useState(false);

  const [declineTarget, setDeclineTarget] = useState<Report | null>(null);
  const [declineVisible, setDeclineVisible] = useState(false);
  // Declining is signed too (v2.0.0, "Who is declining?"): the reason is typed
  // first, then the sign-off card opens with it held here.
  const [declineReason, setDeclineReason] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);

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

      const mapped = Array.isArray(reportRows)
        ? reportRows.map((r: any) => {
            const reportId = Number(r?.report_id);
            const job = findJobForReport(jobs, reportId);
            return mapApiRowToReport(r, job, t);
          })
        : [];

      setAllReports(mapped.filter((r) => r.id > 0));
    } catch (e: any) {
      console.log(e);
      Alert.alert(t("reports.couldntLoadReports"), e?.message ?? t("common.unknownError"));
      setAllReports([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, t]);

  useFocusEffect(
    useCallback(() => {
      loadAllReports();
    }, [loadAllReports]),
  );

  // Kept across tab switches for the life of the screen.
  const [sort, setSort] = useJobSort();

  const reports = useMemo(() => {
    return sortJobs(allReports.filter((r) => r.status === tab), sort);
  }, [allReports, tab, sort]);

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
        const jobs = await api.listJobs(projectId ? { project_id: projectId } : undefined);
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
    [router, openReportDetails, projectId],
  );

  const requestApprove = (report: Report) => {
    setApproveTarget(report);
    setApproveVisible(true);
  };

  // Approving is a sign-off: the manager's typed name plus a selfie. The
  // report only moves to Open once both are saved, so there's no optimistic
  // update here any more.
  const confirmApprove = async ({ selfie, name }: { selfie: LocalMedia; name: string }) => {
    if (!approveTarget || approving) return;

    const reportId = approveTarget.id;

    if (!Number.isFinite(reportId) || reportId <= 0) {
      Alert.alert(t("reports.approveFailedTitle"), t("reports.invalidReportId"));
      setApproveVisible(false);
      setApproveTarget(null);
      return;
    }

    setApproving(true);
    // Which of the two requests failed goes into the error, so "Internal
    // Server Error" alone can't leave it unclear where to look.
    let step = "selfie upload";
    try {
      const selfieKey = await uploadVerificationSelfie("report-review", reportId, selfie);
      step = "approve";
      // updateReportStatus creates the job itself when approving (and tells
      // technicians about it), so there's no separate createJobForReport call.
      await api.updateReportStatus(reportId, {
        report_status: "open",
        report_review_action: "approved",
        // Reviewer and time are recorded by the server.
        review_verified_name: name,
        review_selfie_s3_key: selfieKey,
      });
    } catch (e: any) {
      Alert.alert(
        t("reports.approveFailedTitle"),
        `${e?.message ?? t("common.unknownError")} (${step})`,
      );
      setApproving(false);
      // e.g. another manager already handled it — show the current state.
      setApproveVisible(false);
      setApproveTarget(null);
      loadAllReports({ refreshing: true });
      return;
    }

    setApproving(false);
    setApproveVisible(false);
    setApproveTarget(null);
    await loadAllReports({ refreshing: true });
  };

  const requestDecline = (report: Report) => {
    setDeclineTarget(report);
    setDeclineVisible(true);
  };

  const submitDecline = (reason: string) => {
    if (!declineTarget) return;
    setDeclineVisible(false);
    setDeclineReason(reason);
  };

  const confirmDecline = async ({ selfie, name }: { selfie: LocalMedia; name: string }) => {
    if (!declineTarget || declineReason == null || declining) return;

    const reportId = declineTarget.id;
    if (!Number.isFinite(reportId) || reportId <= 0) {
      Alert.alert(t("reports.declineFailedTitle"), t("reports.invalidReportId"));
      setDeclineReason(null);
      setDeclineTarget(null);
      return;
    }

    setDeclining(true);
    let step = "selfie upload";
    try {
      const selfieKey = await uploadVerificationSelfie("report-review", reportId, selfie);
      step = "decline";
      await api.updateReportStatus(reportId, {
        report_status: "closed",
        report_review_action: "declined",
        report_review_reason: declineReason,
        review_verified_name: name,
        review_selfie_s3_key: selfieKey,
        signed: true,
      });
    } catch (e: any) {
      Alert.alert(t("reports.declineFailedTitle"), `${e?.message ?? t("common.unknownError")} (${step})`);
    }
    setDeclining(false);
    setDeclineReason(null);
    setDeclineTarget(null);
    await loadAllReports({ refreshing: true });
  };

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: "#F9FAFB" }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "pending", label: t("reports.tabPending"), alertCount: counts.pending },
            { key: "open", label: t("reports.tabOpen"), alertCount: counts.open },
            { key: "closed", label: `${t("reports.tabClosed")} (${counts.closed})` },
          ]}
        />

        <SortMenu value={sort} onChange={setSort} />

        {loading ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: "#666" }}>{t("reports.loading")}</Text>
          </View>
        ) : reports.length === 0 ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: "#666" }}>{t("reports.empty")}</Text>
          </View>
        ) : (
          reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onViewDetails={handleViewDetails}
              onReview={(rep) => rep.jobId && router.push(`/rm-manager/review/${rep.jobId}` as any)}
              onApprove={tab === "pending" ? requestApprove : undefined}
              onDecline={tab === "pending" ? requestDecline : undefined}
            />
          ))
        )}
      </ScrollView>

      <SignoffSheet
        visible={approveVisible}
        verb="approving"
        action={t("signoff.actions.approveReport")}
        detail={approveTarget ? formatBusLabel(approveTarget.vehicle, approveTarget.evNumber) : null}
        submitting={approving}
        onCancel={() => {
          if (approving) return;
          setApproveVisible(false);
        }}
        onConfirm={confirmApprove}
      />

      <DeclineReasonModal
        visible={declineVisible}
        onCancel={() => setDeclineVisible(false)}
        onSubmit={submitDecline}
      />

      <SignoffSheet
        visible={declineReason != null}
        verb="declining"
        action={t("signoff.actions.declineReport")}
        detail={declineTarget ? formatBusLabel(declineTarget.vehicle, declineTarget.evNumber) : null}
        submitting={declining}
        onCancel={() => {
          if (declining) return;
          setDeclineReason(null);
        }}
        onConfirm={confirmDecline}
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
