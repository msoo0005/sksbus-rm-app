// app/(app)/rm-manager/job/[id].tsx
//
// Any job, read only (v2.0.0): the closed job (C11), a job order, or a job
// still in progress. A job awaiting approval also shows Send back / Approve
// here, so a push or a link can land on either route.
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import JobReviewView from "@/components/job/JobReviewView";
import { useI18n } from "@/i18n/i18n-ctx";

export default function RMJobDetailsViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = useMemo(() => Number(id), [id]);
  const { t } = useI18n();

  return (
    <>
      <Stack.Screen options={{ title: t("jobDetail.title") === "jobDetail.title" ? "Job Details" : t("jobDetail.title") }} />
      <JobReviewView key={jobId} jobId={jobId} />
    </>
  );
}
