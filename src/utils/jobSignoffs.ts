// Shared by the R&M job view (JobDetailsView) and the technician job screen,
// which used to build their timelines separately and had drifted apart.
import type { TimelineEvent } from "@/components/JobTimeline";
import type { Signoff } from "@/components/SignoffCard";

type T = (key: string, vars?: Record<string, string | number>) => string;

export const ODOMETER_TASK_NAME = "Recorded odometer reading";

// The job fields the timeline and sign-offs read (GET /jobs row).
export type SignoffJob = {
  technician_name?: string | null;
  job_created_at?: string | null;
  job_accepted_at?: string | null;
  job_completed_at?: string | null;
  job_odometer?: number | null;
  job_verified_name?: string | null;
  job_selfie_view_url?: string | null;
  job_accept_verified_name?: string | null;
  job_accept_selfie_view_url?: string | null;
};

// The report fields they read (GET /reports/:id row).
export type SignoffReport = {
  report_uploaded_at?: string | null;
  reporter_name?: string | null;
  report_verified_name?: string | null;
  report_selfie_view_url?: string | null;
  report_review_by?: string | null;
  report_review_verified_name?: string | null;
  report_review_selfie_view_url?: string | null;
};

type TimelineTask = {
  task_id: number;
  task_name: string;
  task_status: string;
  task_order?: number | null;
  completed_at?: string | null;
};

type Person = { name: string | null; username: string | null; selfieUrl: string | null };

function reporter(report?: SignoffReport | null): Person {
  return {
    name: report?.report_verified_name ?? null,
    username: report?.reporter_name ?? null,
    selfieUrl: report?.report_selfie_view_url ?? null,
  };
}

function approver(report?: SignoffReport | null): Person {
  return {
    name: report?.report_review_verified_name ?? null,
    // report_review_by holds the approving manager's username.
    username: report?.report_review_by ?? null,
    selfieUrl: report?.report_review_selfie_view_url ?? null,
  };
}

function accepter(job?: SignoffJob | null): Person {
  return {
    name: job?.job_accept_verified_name ?? null,
    username: job?.technician_name ?? null,
    selfieUrl: job?.job_accept_selfie_view_url ?? null,
  };
}

function completer(job?: SignoffJob | null): Person {
  return {
    name: job?.job_verified_name ?? null,
    username: job?.technician_name ?? null,
    selfieUrl: job?.job_selfie_view_url ?? null,
  };
}

// One row per sign-off stage, for SignoffCard. A stage that hasn't happened
// yet has no `at`, and the card shows it as still to come.
export function buildJobSignoffs(
  job: SignoffJob | null | undefined,
  report: SignoffReport | null | undefined,
  t: T,
): Signoff[] {
  const p = (person: Person) => ({
    name: person.name,
    username: person.username,
    selfieUrl: person.selfieUrl,
  });
  return [
    { key: "reported", label: t("signoffs.reportedBy"), at: report?.report_uploaded_at ?? null, ...p(reporter(report)) },
    // The job is created at the moment of approval, so its creation time is
    // the approval time. (report_review_at can't be used: on reports closed
    // before migration 020's deploy it was overwritten by the job's close.)
    { key: "approved", label: t("signoffs.approvedBy"), at: job?.job_created_at ?? null, ...p(approver(report)) },
    { key: "accepted", label: t("signoffs.acceptedBy"), at: job?.job_accepted_at ?? null, ...p(accepter(job)) },
    { key: "completed", label: t("signoffs.completedBy"), at: job?.job_completed_at ?? null, ...p(completer(job)) },
  ];
}

export function buildJobTimelineEvents(args: {
  job: SignoffJob | null | undefined;
  report: SignoffReport | null | undefined;
  // Every task row, including the odometer bookkeeping row.
  tasks: TimelineTask[];
  afterPhotosUploadedAt: string | null;
  t: T;
}): TimelineEvent[] {
  const { job, report, tasks, afterPhotosUploadedAt, t } = args;
  const events: TimelineEvent[] = [];
  const by = (person: Person) => ({
    by: person.name ?? person.username,
    username: person.username,
    selfieUrl: person.selfieUrl,
  });

  if (report?.report_uploaded_at) {
    events.push({
      id: "report-submitted",
      icon: "file-alt",
      color: "#2563EB",
      colorLight: "#EFF6FF",
      title: t("jobDetail.eventReportSubmitted"),
      ...by(reporter(report)),
      at: report.report_uploaded_at,
    });
  }

  if (job?.job_created_at) {
    events.push({
      id: "job-created",
      icon: "briefcase",
      color: "#7C3AED",
      colorLight: "#F5F3FF",
      title: t("jobDetail.eventJobCreated"),
      ...by(approver(report)),
      at: job.job_created_at,
    });
  }

  if (job?.job_accepted_at) {
    events.push({
      id: "job-accepted",
      icon: "hand-paper",
      color: "#EA580C",
      colorLight: "#FFF7ED",
      title: t("jobDetail.eventJobAccepted"),
      ...by(accepter(job)),
      at: job.job_accepted_at,
    });
  }

  const odometerTask = tasks.find((tk) => tk.task_name === ODOMETER_TASK_NAME);
  if (odometerTask?.completed_at) {
    events.push({
      id: "odometer",
      icon: "tachometer-alt",
      color: "#0EA5E9",
      colorLight: "#F0F9FF",
      title: t("jobDetail.eventOdometerRecorded"),
      subtitle: job?.job_odometer != null ? `${job.job_odometer.toLocaleString()} km` : undefined,
      at: odometerTask.completed_at,
    });
  }

  // Only when and by whom — the task's own details live in the Tasks card.
  const tech = accepter(job);
  let taskNumber = 0;
  const ordered = tasks
    .filter((tk) => tk.task_name !== ODOMETER_TASK_NAME)
    .sort((a, b) => (a.task_order ?? 0) - (b.task_order ?? 0));
  for (const task of ordered) {
    if (task.task_status === "done" && task.completed_at) {
      taskNumber += 1;
      events.push({
        id: `task-${task.task_id}`,
        icon: "check-circle",
        color: "#16A34A",
        colorLight: "#F0FDF4",
        title: t("jobDetail.eventTaskCompleted", { number: taskNumber }),
        ...by(tech),
        at: task.completed_at,
      });
    }
  }

  if (afterPhotosUploadedAt) {
    events.push({
      id: "after-photos",
      icon: "camera",
      color: "#7C3AED",
      colorLight: "#F5F3FF",
      title: t("jobDetail.eventAfterPhotosTaken"),
      at: afterPhotosUploadedAt,
    });
  }

  if (job?.job_completed_at) {
    events.push({
      id: "job-completed",
      icon: "flag-checkered",
      color: "#111827",
      colorLight: "#F3F4F6",
      title: t("jobDetail.eventJobCompleted"),
      ...by(completer(job)),
      at: job.job_completed_at,
    });
  }

  return events;
}
