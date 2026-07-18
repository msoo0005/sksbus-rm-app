// app/(app)/technician/index.tsx
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { api } from "../../api/client";
import ConfirmActionModal from "../../components/ConfirmActionModal";
import JobDetailsModal from "../../components/JobDetailsModal";
import ReportCard from "../../components/ReportCard";
import SegmentedTabs from "../../components/SegmentedTabs";
import { useSession } from "../../ctx";

type Tab = "available" | "myJobs" | "completed";

type JobListItem = {
  job_id: number;
  job_desc: string | null;
  job_status: string;
  technician_user_id: number | null;
  technician_name?: string | null;

  job_created_at?: string | null;
  job_accepted_at?: string | null;
  job_updated_at?: string | null;
  job_completed_at?: string | null;

  report_id: number | null;
  report_type: string | null;
  report_priority: string | null;
  report_desc?: string | null;
  report_location?: string | null;
  report_uploaded_at?: string | null;

  bus_id: string | null;
  reporter_name: string | null;
  reporter_email?: string | null;
};

function formatDate(isoLike?: string | null) {
  if (!isoLike) return "—";
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return String(isoLike);
  return d.toLocaleString();
}

export default function TechnicianScreen() {
  const router = useRouter();
  const { dbUser } = useSession() as any;

  const myUserId = dbUser?.user_id ? Number(dbUser.user_id) : null;

  const [tab, setTab] = useState<Tab>("available");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [jobs, setJobs] = useState<JobListItem[]>([]);

  const [selectedJob, setSelectedJob] = useState<JobListItem | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const [acceptTarget, setAcceptTarget] = useState<JobListItem | null>(null);
  const [acceptVisible, setAcceptVisible] = useState(false);

  const fetchJobs = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const rows = await api.listJobs();

      setJobs(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      Alert.alert("Failed to load jobs", e?.message ?? "Unknown error");
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableJobs = useMemo(
    () => jobs.filter((j) => j.job_status === "open" && !j.technician_user_id),
    [jobs],
  );

  const myOpenJobs = useMemo(() => {
    if (!myUserId) return [];

    return jobs.filter(
      (j) => j.job_status === "open" && j.technician_user_id === myUserId,
    );
  }, [jobs, myUserId]);

  const myClosedJobs = useMemo(() => {
    if (!myUserId) return [];

    return jobs.filter(
      (j) => j.job_status === "closed" && j.technician_user_id === myUserId,
    );
  }, [jobs, myUserId]);

  const tabCounts = useMemo(
    () => ({
      available: availableJobs.length,
      myJobs: myOpenJobs.length,
      completed: myClosedJobs.length,
    }),
    [availableJobs.length, myOpenJobs.length, myClosedJobs.length],
  );

  const filtered = useMemo(() => {
    if (tab === "available") return availableJobs;
    if (tab === "myJobs") return myOpenJobs;
    return myClosedJobs;
  }, [tab, availableJobs, myOpenJobs, myClosedJobs]);

  const requestAccept = (job: JobListItem) => {
    setAcceptTarget(job);
    setAcceptVisible(true);
  };

  const confirmAccept = async () => {
    if (!acceptTarget) return;

    try {
      await api.assignJob(acceptTarget.job_id);

      setAcceptVisible(false);
      setAcceptTarget(null);
      setTab("myJobs");

      await fetchJobs(true);
    } catch (e: any) {
      Alert.alert("Accept failed", e?.message ?? "Unknown error");
    }
  };

  const goToJobScreen = (job: JobListItem) => {
    const mode = tab === "myJobs" ? "edit" : "view";

    router.push({
      pathname: "/technician/job/[id]",
      params: {
        id: String(job.job_id),
        mode,
      },
    });
  };

  const showTopSpinner = loading || refreshing;

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: "#f9f9f9" }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchJobs(true)}
          />
        }
      >
        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "available", label: `Available (${tabCounts.available})` },
            { key: "myJobs", label: `My Jobs (${tabCounts.myJobs})` },
            { key: "completed", label: `Completed (${tabCounts.completed})` },
          ]}
        />

        {showTopSpinner && (
          <View
            style={{
              paddingVertical: 12,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator size="small" />
          </View>
        )}

        {loading ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: "#666" }}>Loading jobs…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: "#666" }}>No jobs in this tab.</Text>
          </View>
        ) : (
          filtered.map((job) => {
            const reportLike: any = {
              id: job.report_id ?? job.job_id,
              type: job.report_type ?? "repair",
              severity: job.report_priority ?? "medium",
              vehicle: job.bus_id ?? "—",
              location: job.report_location ?? "—",
              description: job.report_desc ?? job.job_desc ?? "",
              date: formatDate(job.report_uploaded_at ?? job.job_created_at),
              status: job.job_status === "closed" ? "closed" : "open",
              reportedBy: job.reporter_name ?? "—",
              assigned: job.technician_name ?? undefined,
            };

            return (
              <Pressable key={job.job_id} onPress={() => goToJobScreen(job)}>
                <View pointerEvents="box-none">
                  <ReportCard
                    report={reportLike}
                    currentTech={dbUser?.user_name}
                    onViewDetails={() => goToJobScreen(job)}
                    onAccept={
                      tab === "available" ? () => requestAccept(job) : undefined
                    }
                  />
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <JobDetailsModal
        visible={detailsVisible}
        report={
          selectedJob
            ? ({
                id: selectedJob.report_id ?? selectedJob.job_id,
                type: selectedJob.report_type ?? "repair",
                severity: selectedJob.report_priority ?? "medium",
                vehicle: selectedJob.bus_id ?? "—",
                location: selectedJob.report_location ?? "—",
                description:
                  selectedJob.report_desc ?? selectedJob.job_desc ?? "",
                date: formatDate(
                  selectedJob.report_uploaded_at ?? selectedJob.job_created_at,
                ),
                status: selectedJob.job_status === "closed" ? "closed" : "open",
                reportedBy: selectedJob.reporter_name ?? "—",
                assigned: selectedJob.technician_name ?? undefined,
              } as any)
            : null
        }
        onClose={() => setDetailsVisible(false)}
      />

      <ConfirmActionModal
        visible={acceptVisible}
        title="Accept Job"
        message="Accept this job and assign it to you?"
        confirmLabel="Accept Job"
        confirmColor="#4CAF50"
        onCancel={() => setAcceptVisible(false)}
        onConfirm={confirmAccept}
      />
    </>
  );
}
