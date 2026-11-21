// Job Progress (v2.0.0 Part C) from the server's JOB_EVENT log: one timeline
// for every role and screen, plus the pending step with its live timer.

import type { JobDetails, JobEvent } from "../api/client";
import type { PendingTimelineStage, TimelineEvent } from "../components/JobTimeline";
import { formatElapsed } from "./elapsedTime";

type T = (key: string, vars?: Record<string, string | number>) => string;

const STYLE: Record<string, { icon: string; color: string; colorLight: string }> = {
  REPORT_SUBMITTED: { icon: "file-alt", color: "#2563EB", colorLight: "#EFF6FF" },
  REPORT_APPROVED: { icon: "briefcase", color: "#7C3AED", colorLight: "#F5F3FF" },
  REPORT_DECLINED: { icon: "times-circle", color: "#DC2626", colorLight: "#FEF2F2" },
  JOB_ORDER_ISSUED: { icon: "clipboard-list", color: "#34873F", colorLight: "#F0FDF4" },
  JOB_ORDER_OPENED: { icon: "file-alt", color: "#C4501A", colorLight: "#FFF7ED" },
  ACCEPTED: { icon: "hand-paper", color: "#EA580C", colorLight: "#FFF7ED" },
  DELAY_UPDATE: { icon: "clock", color: "#DC2626", colorLight: "#FEF2F2" },
  ARRIVED: { icon: "tachometer-alt", color: "#0EA5E9", colorLight: "#F0F9FF" },
  ODOMETER_CORRECTED: { icon: "tachometer-alt", color: "#6B7280", colorLight: "#F3F4F6" },
  TASK_COMPLETED: { icon: "check-circle", color: "#16A34A", colorLight: "#F0FDF4" },
  FOLLOWUP_ADDED: { icon: "plus-circle", color: "#B45309", colorLight: "#FFFBEB" },
  FOLLOWUP_REMOVED: { icon: "minus-circle", color: "#6B7280", colorLight: "#F3F4F6" },
  JOB_COMPLETED: { icon: "clipboard-check", color: "#16A34A", colorLight: "#F0FDF4" },
  SENT_BACK: { icon: "undo", color: "#DC2626", colorLight: "#FEF2F2" },
  CLOSED: { icon: "flag-checkered", color: "#111827", colorLight: "#F3F4F6" },
  FM_REMARKS_SAVED: { icon: "comment-alt", color: "#2563EB", colorLight: "#EFF6FF" },
  FM_REMARKS_EDITED: { icon: "comment-alt", color: "#2563EB", colorLight: "#EFF6FF" },
};

// Shown on the timeline; the follow-up add/remove steps are kept in the log
// (and the PDF) but would only clutter the screen.
const HIDDEN = new Set(["FOLLOWUP_ADDED", "FOLLOWUP_REMOVED"]);

function durationLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

function eventTitle(e: JobEvent, taskNo: Map<number, number>, t: T) {
  if (e.type === "TASK_COMPLETED") {
    const n = taskNo.get(Number(e.detail?.task_id)) ?? "";
    const type = e.detail?.job_type;
    return type
      ? t("job2.progress.TASK_COMPLETED", { n, type: type === "repair" ? "Repair" : "Maintenance" })
      : t("job2.progress.TASK_COMPLETED_PLAIN", { n });
  }
  return t(`job2.progress.${e.type}`);
}

function eventSubtitle(e: JobEvent, t: T): string | null {
  switch (e.type) {
    case "ARRIVED":
      return e.detail?.odometer_km != null ? `${Number(e.detail.odometer_km).toLocaleString()} km` : null;
    case "ODOMETER_CORRECTED":
      return `${Number(e.detail?.from_km ?? 0).toLocaleString()} → ${Number(e.detail?.to_km ?? 0).toLocaleString()} km`;
    case "SENT_BACK":
      return e.detail?.reason ?? null;
    case "REPORT_DECLINED":
      return e.detail?.remarks ?? null;
    case "DELAY_UPDATE": {
      const r = e.detail?.reason ? t(`job2.progress.reasons.${e.detail.reason}`) : "";
      return [r, e.detail?.note].filter(Boolean).join(" · ") || null;
    }
    case "JOB_COMPLETED":
      return e.selfie_url ? t("job2.progress.selfieCompletion") : null;
    case "CLOSED": {
      const n = Array.isArray(e.detail?.job_orders) ? e.detail.job_orders.length : 0;
      const parts = [e.selfie_url ? t("job2.progress.selfieApproval") : null, n ? t("job2.progress.jobOrdersIssued", { count: n }) : null];
      return parts.filter(Boolean).join(" · ") || null;
    }
    case "JOB_ORDER_ISSUED":
      return e.detail?.parent_ref_no ?? null;
    default:
      return null;
  }
}

/** The completed steps and the one pending step, ready for <JobTimeline />. */
export function buildJobProgress(d: JobDetails, t: T): { events: TimelineEvent[]; pendingStage: PendingTimelineStage | null } {
  const taskNo = new Map(d.tasks.map((x) => [x.task_id, x.no]));
  const events: TimelineEvent[] = d.events
    .filter((e) => !HIDDEN.has(e.type))
    .map((e) => {
      const st = STYLE[e.type] ?? { icon: "circle", color: "#6B7280", colorLight: "#F3F4F6" };
      return {
        id: `ev-${e.event_id}`,
        ...st,
        title: eventTitle(e, taskNo, t),
        subtitle: eventSubtitle(e, t),
        by: e.by.name,
        username: e.by.username,
        selfieUrl: e.selfie_url,
        at: e.at,
      };
    });

  const state = d.job.state;
  let pendingStage: PendingTimelineStage | null = null;
  const pending = (label: string, icon: string, color: string, colorLight: string, since?: string | null) => ({
    label,
    subtitle: t("job2.progress.currentlyPending"),
    icon,
    color,
    colorLight,
    since: since ?? null,
  });

  if (state === "approved") {
    pendingStage = pending(t("job2.progress.awaitingAccept"), "hand-paper", "#6B7280", "#F3F4F6");
  } else if (state === "accepted") {
    pendingStage = d.late.late
      ? pending(
          t("job2.progress.notArrived", { limit: durationLabel(d.late.limitMin) }),
          "exclamation-triangle",
          "#DC2626",
          "#FEF2F2",
          d.late.accepted_at,
        )
      : pending(t("job2.progress.awaitingArrival"), "route", "#EA580C", "#FFF7ED");
  } else if (state === "arrived") {
    pendingStage = pending(
      d.sent_back ? t("job2.progress.awaitingTasksReopened") : t("job2.progress.awaitingTasks"),
      "tools",
      "#7C3AED",
      "#F5F3FF",
      d.sent_back?.at ?? null,
    );
  } else if (state === "pending_approval") {
    const done = [...d.events].reverse().find((e) => e.type === "JOB_COMPLETED");
    pendingStage = pending(t("job2.progress.awaitingApproval"), "user-check", "#7C3AED", "#F5F3FF", done?.at ?? null);
  }
  return { events, pendingStage };
}

export { formatElapsed };
