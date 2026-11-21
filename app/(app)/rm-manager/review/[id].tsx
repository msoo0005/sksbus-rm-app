// C8 · Review completed job (R&M Manager), from Review & Approve on the Open
// list or from the "waiting for your approval" push.
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import JobReviewView from "@/components/job/JobReviewView";
import { useI18n } from "@/i18n/i18n-ctx";

export default function RMReviewJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = useMemo(() => Number(id), [id]);
  const { t } = useI18n();

  return (
    <>
      <Stack.Screen options={{ title: t("job2.review.title") }} />
      <JobReviewView key={jobId} jobId={jobId} />
    </>
  );
}
