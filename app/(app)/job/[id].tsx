// C1 · A completed job, read only, the same for every role: opened from
// "View report" after a technician submits a job order, and from job lists.
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import JobReviewView from "@/components/job/JobReviewView";
import { useI18n } from "@/i18n/i18n-ctx";

export default function JobReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = useMemo(() => Number(id), [id]);
  const { t } = useI18n();
  return (
    <>
      <Stack.Screen options={{ title: t("job2.jobReport") }} />
      <JobReviewView key={jobId} jobId={jobId} />
    </>
  );
}
