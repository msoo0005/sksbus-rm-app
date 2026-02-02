// app/(app)/technician/index.tsx
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";

import ConfirmActionModal from "../../components/ConfirmActionModal";
import JobDetailsModal from "../../components/JobDetailsModal"; // optional (kept)
import ReportCard from "../../components/ReportCard";
import SegmentedTabs from "../../components/SegmentedTabs";
import { useSession } from "../../ctx";

type Tab = "available" | "myJobs" | "completed";

/**
 * Shape based on your Lambda listJobs() SELECT.
 * Add/remove fields if your SQL differs.
 */
type JobListItem = {
  job_id: number;
  job_desc: string | null;
  job_status: string; // "open" | "closed" etc
  technician_user_id: number | null;

  job_created_at?: string | null;
  job_accepted_at?: string | null;
  job_updated_at?: string | null;
  job_completed_at?: string | null;

  // joined report bits:
  report_id: number | null;
  report_type: string | null;
  report_priority: string | null;
  bus_id: string | null;
  reporter_name: string | null;

  // if you add these later, you can map them too:
  report_location?: string | null;
};

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

export default function TechnicianScreen() {
  const router = useRouter();
  const { session, dbUser } = useSession() as any;

  const myUserId = dbUser?.user_id ? Number(dbUser.user_id) : null;

  const [tab, setTab] = useState<Tab>("available");
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<JobListItem[]>([]);

  const [selectedJob, setSelectedJob] = useState<JobListItem | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const [acceptTarget, setAcceptTarget] = useState<JobListItem | null>(null);
  const [acceptVisible, setAcceptVisible] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<JobListItem[]>(
        `/jobs`,
        { method: "GET" },
        session,
      );
      setJobs(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      Alert.alert("Failed to load jobs", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
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
      await apiFetch(
        `/jobs/${acceptTarget.job_id}/assign`,
        { method: "PATCH" },
        session,
      );
      setAcceptVisible(false);
      setAcceptTarget(null);
      setTab("myJobs");
      await fetchJobs();
    } catch (e: any) {
      Alert.alert("Accept failed", e?.message ?? "Unknown error");
    }
  };

  const openDetails = (job: JobListItem) => {
    setSelectedJob(job);
    setDetailsVisible(true);
  };

  const goToJobScreen = (job: JobListItem) => {
    const mode = tab === "myJobs" ? "edit" : "view";

    router.push({
      pathname: "/technician/job/[id]",
      params: { id: String(job.job_id), mode },
    });
  };

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: "#f9f9f9" }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchJobs} />
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

        {filtered.map((job) => {
          const reportLike: any = {
            id: job.report_id ?? job.job_id,
            type: job.report_type ?? "repair",
            severity: job.report_priority ?? "medium",
            vehicle: job.bus_id ?? "—",
            location: job.report_location ?? "—",
            description: job.job_desc ?? "—",
            date: job.job_created_at ?? "",
            status: job.job_status === "closed" ? "closed" : "open",
            reportedBy: job.reporter_name ?? "—",
            assigned: job.technician_user_id ? "assigned" : undefined,
          };

          return (
            <Pressable key={job.job_id} onPress={() => goToJobScreen(job)}>
              {/* 
                IMPORTANT:
                ReportCard has inner buttons (View Details / Accept).
                To stop the outer Pressable firing when those are tapped,
                we wrap ReportCard with a View that cancels the parent press
                when any child press happens.
              */}
              <View
                // This prevents parent press on some RN versions by capturing touches.
                // Keeps buttons working normally.
                pointerEvents="box-none"
              >
                <ReportCard
                  report={reportLike}
                  currentTech={"(api)"}
                  onViewDetails={() => goToJobScreen(job)}
                  onAccept={
                    tab === "available" ? () => requestAccept(job) : undefined
                  }
                />
              </View>
            </Pressable>
          );
        })}
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
                description: selectedJob.job_desc ?? "—",
                date: selectedJob.job_created_at ?? "",
                status: selectedJob.job_status === "closed" ? "closed" : "open",
                reportedBy: selectedJob.reporter_name ?? "—",
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
