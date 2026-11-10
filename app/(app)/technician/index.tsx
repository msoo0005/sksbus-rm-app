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

import { api } from "@/api/client";
import { uploadVerificationSelfie } from "@/api/media";
import type { LocalMedia } from "@/components/ImagePicker";
import VerificationModal from "@/components/VerificationModal";
import JobDetailsModal from "@/components/JobDetailsModal";
import ReportCard from "@/components/ReportCard";
import SegmentedTabs from "@/components/SegmentedTabs";
import { useSession } from "@/ctx";
import { useI18n } from "@/i18n/i18n-ctx";
import { useProjectFilter } from "@/hooks/useProjectFilter";

type Tab = "available" | "myJobs" | "assigned" | "completed";

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
  report_verified_name?: string | null;
  report_selfie_view_url?: string | null;
  job_accept_verified_name?: string | null;
  job_accept_selfie_view_url?: string | null;
};

// The technician who took a job, as signed off at acceptance.
function assigneeOf(job: JobListItem) {
  if (job.technician_user_id == null) return undefined;
  return {
    name: job.job_accept_verified_name ?? null,
    username: job.technician_name ?? null,
    selfieUrl: job.job_accept_selfie_view_url ?? null,
  };
}

function formatDate(isoLike?: string | null) {
  if (!isoLike) return "—";
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return String(isoLike);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function TechnicianScreen() {
  const router = useRouter();
  const { dbUser } = useSession() as any;
  const { t } = useI18n();
  const projectId = useProjectFilter();

  const myUserId = dbUser?.user_id ? Number(dbUser.user_id) : null;

  const [tab, setTab] = useState<Tab>("available");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [jobs, setJobs] = useState<JobListItem[]>([]);

  const [selectedJob, setSelectedJob] = useState<JobListItem | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const [acceptTarget, setAcceptTarget] = useState<JobListItem | null>(null);
  const [acceptVisible, setAcceptVisible] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const fetchJobs = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const rows = await api.listJobs(projectId ? { project_id: projectId } : undefined);

      setJobs(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      Alert.alert(t("jobsList.failedToLoadJobs"), e?.message ?? t("common.unknownError"));
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

  // Open jobs another technician has taken — view-only, so the team can see
  // who is working on what.
  const othersJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.job_status === "open" &&
          j.technician_user_id != null &&
          j.technician_user_id !== myUserId,
      ),
    [jobs, myUserId],
  );

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
      assigned: othersJobs.length,
      completed: myClosedJobs.length,
    }),
    [availableJobs.length, myOpenJobs.length, othersJobs.length, myClosedJobs.length],
  );

  const filtered = useMemo(() => {
    if (tab === "available") return availableJobs;
    if (tab === "myJobs") return myOpenJobs;
    if (tab === "assigned") return othersJobs;
    return myClosedJobs;
  }, [tab, availableJobs, myOpenJobs, othersJobs, myClosedJobs]);

  const requestAccept = (job: JobListItem) => {
    setAcceptTarget(job);
    setAcceptVisible(true);
  };

  // Accepting is a sign-off (typed name + selfie). The `accepting` guard
  // matters: a second tap used to send a second accept, which failed with
  // "already assigned" after the first had succeeded — the error the
  // technician saw while the job quietly moved to My Jobs.
  const confirmAccept = async ({ selfie, name }: { selfie: LocalMedia; name: string }) => {
    if (!acceptTarget || accepting) return;
    const jobId = acceptTarget.job_id;

    setAccepting(true);
    try {
      const selfieKey = await uploadVerificationSelfie("job-accept", jobId, selfie);
      await api.assignJob(jobId, { verified_name: name, selfie_s3_key: selfieKey });
    } catch (e: any) {
      Alert.alert(t("jobsList.acceptFailedTitle"), e?.message ?? t("common.unknownError"));
      setAccepting(false);
      // The list may be stale (e.g. someone else took the job) — refresh it.
      fetchJobs(true);
      return;
    }

    setAccepting(false);
    setAcceptVisible(false);
    setAcceptTarget(null);
    setTab("myJobs");
    // Outside the try: a failed refresh is reported by fetchJobs itself and
    // must not read as a failed accept.
    fetchJobs(true);
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
        style={{ flex: 1, backgroundColor: "#F9FAFB" }}
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
            { key: "available", label: t("jobsList.tabAvailable"), alertCount: tabCounts.available },
            { key: "myJobs", label: t("jobsList.tabMyJobs"), alertCount: tabCounts.myJobs },
            { key: "assigned", label: `${t("jobsList.tabAssigned")} (${tabCounts.assigned})` },
            { key: "completed", label: `${t("jobsList.tabCompleted")} (${tabCounts.completed})` },
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
            <Text style={{ color: "#666" }}>{t("jobsList.loading")}</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: "#666" }}>{t("jobsList.empty")}</Text>
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
              dateIso: job.report_uploaded_at ?? job.job_created_at ?? null,
              closedAt: job.job_completed_at ?? null,
              status: job.job_status === "closed" ? "closed" : "open",
              reportedBy: job.reporter_name ?? "—",
              reporter: {
                name: job.report_verified_name ?? null,
                username: job.reporter_name ?? null,
                selfieUrl: job.report_selfie_view_url ?? null,
              },
              assigned: job.technician_name ?? undefined,
              assignee: assigneeOf(job),
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
                reporter: {
                  name: selectedJob.report_verified_name ?? null,
                  username: selectedJob.reporter_name ?? null,
                  selfieUrl: selectedJob.report_selfie_view_url ?? null,
                },
                assigned: selectedJob.technician_name ?? undefined,
                assignee: assigneeOf(selectedJob),
              } as any)
            : null
        }
        onClose={() => setDetailsVisible(false)}
      />

      <VerificationModal
        visible={acceptVisible}
        title={t("jobsList.acceptTitle")}
        message={t("verification.acceptJobMessage")}
        confirmLabel={t("jobsList.acceptConfirm")}
        submitting={accepting}
        onCancel={() => {
          if (accepting) return;
          setAcceptVisible(false);
        }}
        onConfirm={confirmAccept}
      />
    </>
  );
}
