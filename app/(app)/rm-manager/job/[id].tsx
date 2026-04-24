// app/(app)/rm-manager/job/[id].tsx
import { Stack, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import JobDetailsView from "../../../components/JobDetailsView";

export default function RMJobDetailsViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = useMemo(() => Number(id), [id]);

  return (
    <>
      <Stack.Screen options={{ title: "Job Details (View)" }} />
      <JobDetailsView jobId={jobId} headerHint="View only — RM Manager" />
    </>
  );
}
