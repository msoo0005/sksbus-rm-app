import React, { useCallback, useEffect, useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";

import { api } from "../api/client"; // ✅ adjust if your api.ts path differs
import ConfirmActionModal from "../components/ConfirmActionModal";
import DeclineReasonModal from "../components/DeclineReasonModal";
import JobDetailsModal from "../components/JobDetailsModal";
import ReportCard from "../components/ReportCard";
import SegmentedTabs from "../components/SegmentedTabs";
import { useSession } from "../ctx";
import { Report } from "../types/report";

type Tab = "pending" | "open" | "closed";

function formatDate(isoLike?: string | null) {
  if (!isoLike) return "—";
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return String(isoLike);
  return d.toLocaleString();
}

function normaliseStatusToUi(raw?: string | null): Report["status"] {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s || s === "submitted" || s === "pending") return "pending";
  if (s === "open") return "open";
  if (s === "closed") return "closed";
  return "pending";
}

/**
 * Maps your Lambda listReports rows -> UI Report
 * listReports returns:
 *  report_id, report_type, report_desc, report_location, report_priority, report_status, report_uploaded_at,
 *  bus_id, reporter_name, reporter_email,
 *  report_review_action, report_review_reason, report_review_by, report_review_at
 */
function mapApiRowToReport(r: any): Report {
  const reportedBy =
    r.reporter_name || r.reporter_email
      ? `${r.reporter_name ?? "Unknown"} (${r.reporter_email ?? "—"})`
      : undefined;

  const audit = r.report_review_action
    ? {
        action: String(r.report_review_action) as any, // approved | declined
        by: r.report_review_by ?? undefined,
        at: r.report_review_at ?? undefined,
        reason: r.report_review_reason ?? undefined,
      }
    : undefined;

  return {
    id: Number(r.report_id),
    type: (r.report_type ?? "problem") as Report["type"],
    severity: (r.report_priority ?? "medium") as Report["severity"],
    vehicle: String(r.bus_id ?? "—"),
    location: String(r.report_location ?? "—"),
    description: String(r.report_desc ?? "—"),
    date: formatDate(r.report_uploaded_at),
    status: normaliseStatusToUi(r.report_status),
    reportedBy,
    audit,
  };
}

export default function RMManagerScreen() {
  const { dbUser } = useSession() as any;
  const MANAGER_NAME = dbUser?.user_name ?? "RM Manager";

  const [tab, setTab] = useState<Tab>("pending");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const [approveTarget, setApproveTarget] = useState<Report | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);

  const [declineTarget, setDeclineTarget] = useState<Report | null>(null);
  const [declineVisible, setDeclineVisible] = useState(false);

  const [counts, setCounts] = useState({ pending: 0, open: 0, closed: 0 });

  const loadReports = useCallback(
    async (opts?: { silent?: boolean }) => {
      try {
        if (!opts?.silent) setLoading(true);

        // Backend expects: status=submitted|open|closed
        // Your backend treats pending as submitted
        const statusParam = tab === "pending" ? "submitted" : tab;

        const rows = await api.listReports({ status: statusParam as any });
        const mapped = Array.isArray(rows) ? rows.map(mapApiRowToReport) : [];
        setReports(mapped);
      } catch (e: any) {
        console.log(e);
        Alert.alert("Couldn’t load reports", e?.message ?? "Unknown error");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [tab],
  );

  const loadCounts = useCallback(async () => {
    try {
      // Pull latest 200 and count locally
      const rows = await api.listReports();
      const mapped = Array.isArray(rows) ? rows.map(mapApiRowToReport) : [];

      setCounts({
        pending: mapped.filter((r) => r.status === "pending").length,
        open: mapped.filter((r) => r.status === "open").length,
        closed: mapped.filter((r) => r.status === "closed").length,
      });
    } catch {
      // ignore count errors; UI still works
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts, tab]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadReports({ silent: true }), loadCounts()]);
    setRefreshing(false);
  }, [loadReports, loadCounts]);

  // ----- approve -----
  const requestApprove = (report: Report) => {
    setApproveTarget(report);
    setApproveVisible(true);
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;

    const reportId = approveTarget.id;

    // optimistic UI
    setReports((prev) =>
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
      await api.updateReportStatus(reportId, {
        report_status: "open",
        report_review_action: "approved",
        report_review_reason: null,
        report_review_by: MANAGER_NAME,
        report_review_at: new Date().toISOString(),
      });

      await loadCounts();

      // Pending tab should drop it
      if (tab === "pending") await loadReports({ silent: true });
    } catch (e: any) {
      Alert.alert("Approve failed", e?.message ?? "Unknown error");
      await loadReports({ silent: true });
      await loadCounts();
    }
  };

  // ----- decline -----
  const requestDecline = (report: Report) => {
    setDeclineTarget(report);
    setDeclineVisible(true);
  };

  const submitDecline = async (reason: string) => {
    if (!declineTarget) return;

    const reportId = declineTarget.id;

    // optimistic UI
    setReports((prev) =>
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

      await loadCounts();

      if (tab === "pending") await loadReports({ silent: true });
    } catch (e: any) {
      Alert.alert("Decline failed", e?.message ?? "Unknown error");
      await loadReports({ silent: true });
      await loadCounts();
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
              onViewDetails={(r) => {
                setSelectedReport(r);
                setDetailsVisible(true);
              }}
              onApprove={tab === "pending" ? requestApprove : undefined}
              onDecline={tab === "pending" ? requestDecline : undefined}
            />
          ))
        )}
      </ScrollView>

      <JobDetailsModal
        visible={detailsVisible}
        report={selectedReport}
        onClose={() => setDetailsVisible(false)}
      />

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
