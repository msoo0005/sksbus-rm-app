export type PendingStage = {
  label: string;
  subtitle: string;
  icon: string;
  color: string;
  colorLight: string;
};

type JobLike = {
  technician_user_id?: number | null;
  job_odometer?: number | null;
  job_status?: string | null;
  job_completed_at?: string | null;
};

type TaskLike = { task_status: string };

function toLower(x: unknown) {
  return String(x ?? "").trim().toLowerCase();
}

// Figures out which stage of a job's lifecycle is currently unresolved, so
// the timeline can show a single blinking "pending" node for it. A job only
// exists once R&M manager approval has already happened (job creation IS
// the approval action — see createJobForReport in the Lambda), so approval
// itself never appears here; everything after that point can still be
// waiting on someone.
export function computeJobPendingStage(
  job: JobLike | null | undefined,
  visibleTasks: TaskLike[],
  t: (key: string) => string,
): PendingStage | null {
  if (!job) return null;
  if (job.job_completed_at || toLower(job.job_status) === "closed") return null;

  const subtitle = t("jobDetail.pendingNodeSubtitle");

  if (job.technician_user_id == null) {
    return {
      label: t("jobDetail.pendingAcceptance"),
      subtitle,
      icon: "hand-paper",
      color: "#EA580C",
      colorLight: "#FFF7ED",
    };
  }

  if (job.job_odometer == null) {
    return {
      label: t("jobDetail.pendingOdometer"),
      subtitle,
      icon: "tachometer-alt",
      color: "#0EA5E9",
      colorLight: "#F0F9FF",
    };
  }

  const hasPendingTasks = visibleTasks.some((tk) => tk.task_status !== "done");
  if (visibleTasks.length === 0 || hasPendingTasks) {
    return {
      label: t("jobDetail.pendingTaskCompletion"),
      subtitle,
      icon: "tasks",
      color: "#7C3AED",
      colorLight: "#F5F3FF",
    };
  }

  return {
    label: t("jobDetail.pendingJobCompletion"),
    subtitle,
    icon: "flag-checkered",
    color: "#111827",
    colorLight: "#F3F4F6",
  };
}
