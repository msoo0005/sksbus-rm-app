// app/(app)/fleet-manager-history.tsx
import { FontAwesome5 } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "../api/client";
import JobDetailsView from "../components/JobDetailsView";
import ReportCard from "../components/ReportCard";
import SegmentedTabs from "../components/SegmentedTabs";
import { useSession } from "../ctx";
import { Report } from "../types/report";

type Tab = "submitted" | "open" | "closed";

type FleetReport = Report & {
  job_id?: number | null;
};

function formatDate(isoLike?: string | null) {
  if (!isoLike) return "—";
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return String(isoLike);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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

function mapApiRowToReport(r: any): FleetReport {
  const id = Number(r?.report_id);
  const safeId = Number.isFinite(id) ? id : 0;

  const jobId = Number(r?.job_id);
  const safeJobId = Number.isFinite(jobId) && jobId > 0 ? jobId : null;

  const reportedBy =
    r?.reporter_name || r?.reporter_email
      ? `${r?.reporter_name ?? "Unknown"} (${r?.reporter_email ?? "—"})`
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
    job_id: safeJobId,
    type: normaliseType(r?.report_type),
    severity: normaliseSeverity(r?.report_priority),
    vehicle: String(r?.bus_id ?? "—"),
    location: String(r?.report_location ?? "—"),
    lat: r?.report_lat ?? null,
    lng: r?.report_lng ?? null,
    description: String(r?.report_desc ?? "—"),
    date: formatDate(r?.report_uploaded_at),
    status: normaliseStatusToUi(r?.report_status),
    reportedBy,
    audit,
  };
}

export default function FleetManagerHistoryScreen() {
  const { dbUser } = useSession() as any;
  const name = dbUser?.user_name ?? "Fleet Manager";
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("submitted");
  const [reports, setReports] = useState<FleetReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [counts, setCounts] = useState({
    submitted: 0,
    open: 0,
    closed: 0,
  });

  const [jobModalVisible, setJobModalVisible] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  const statusParam = useMemo(() => {
    if (tab === "submitted") return "submitted" as const;
    return tab as "open" | "closed";
  }, [tab]);

  const loadReports = useCallback(async () => {
    setLoading(true);

    try {
      const rows = await api.listReports({
        mine: true,
        status: statusParam as any,
      });

      const mapped = Array.isArray(rows) ? rows.map(mapApiRowToReport) : [];
      setReports(mapped.filter((r) => r.id > 0));
    } catch (e: any) {
      console.log(e);
      Alert.alert("Couldn’t load your reports", e?.message ?? "Unknown error");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [statusParam]);

  const loadCounts = useCallback(async () => {
    try {
      const rows = await api.listReports({ mine: true });
      const mapped = Array.isArray(rows) ? rows.map(mapApiRowToReport) : [];

      setCounts({
        submitted: mapped.filter((r) => r.status === "pending").length,
        open: mapped.filter((r) => r.status === "open").length,
        closed: mapped.filter((r) => r.status === "closed").length,
      });
    } catch {
      // ignore count errors
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadReports(), loadCounts()]);
    setRefreshing(false);
  }, [loadReports, loadCounts]);

  const openDetailsUsingJobView = useCallback((report: FleetReport) => {
    const jobId = Number(report.job_id);

    if (!Number.isFinite(jobId) || jobId <= 0) {
      Alert.alert(
        "No job created yet",
        "This report has not been approved or linked to a job yet.",
      );
      return;
    }

    setSelectedJobId(jobId);
    setJobModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setJobModalVisible(false);
    setSelectedJobId(null);
  }, []);

  const headerLabel = useMemo(() => {
    if (tab === "submitted") return "Submitted Reports";
    if (tab === "open") return "Open Reports";
    return "Closed Reports";
  }, [tab]);

  return (
    <>
      <ScrollView
        style={styles.page}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Report History</Text>
          <Text style={styles.headerSubtitle}>Logged in as {name}</Text>
        </View>

        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "submitted", label: `Submitted (${counts.submitted})` },
            { key: "open", label: `Open (${counts.open})` },
            { key: "closed", label: `Closed (${counts.closed})` },
          ]}
        />

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderTitle}>{headerLabel}</Text>
        </View>

        {loading && !reports.length ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator />
          </View>
        ) : reports.length ? (
          reports.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              onViewDetails={() => openDetailsUsingJobView(r)}
            />
          ))
        ) : (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              No reports found in this category yet.
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={jobModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={[styles.modalScreen, { paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderLeft}>
              <Text style={styles.modalEyebrow}>JOB</Text>
              <Text style={styles.modalTitle}>
                {selectedJobId ? `#${selectedJobId}` : "—"}
              </Text>
            </View>
            <Pressable onPress={closeModal} style={styles.closeBtn} hitSlop={8}>
              <FontAwesome5 name="times" size={14} color="#374151" />
            </Pressable>
          </View>
          <View style={styles.modalDivider} />

          {selectedJobId ? (
            <JobDetailsView
              jobId={selectedJobId}
              headerHint="View only (opened from My Report History)"
            />
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No job selected.</Text>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#f9f9f9",
  },

  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  headerSubtitle: {
    marginTop: 4,
    color: "#6b7280",
  },

  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  sectionHeaderTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },

  loadingWrap: {
    paddingVertical: 30,
  },
  emptyWrap: {
    padding: 16,
  },
  emptyText: {
    color: "#6b7280",
  },

  modalScreen: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: "#fff",
    gap: 12,
  },
  modalHeaderLeft: { flex: 1 },
  modalEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  modalTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
  },
  modalDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
});
