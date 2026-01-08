import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView } from "react-native";

import ConfirmActionModal from "../../components/ConfirmActionModal";
import JobDetailsModal from "../../components/JobDetailsModal";
import ReportCard from "../../components/ReportCard";
import SegmentedTabs from "../../components/SegmentedTabs";
import { useSession } from "../../ctx";
import { Report } from "../../types/report";

type Tab = "available" | "myJobs" | "completed";

// -------------------- MOCK DATA --------------------
const INITIAL_TECH_REPORTS: Report[] = [
  {
    id: 201,
    type: "repair",
    severity: "medium",
    vehicle: "BUS205",
    location: "Depot - Bay 2",
    description: "Scheduled service: oil + filter replacement, general inspection.",
    date: "12/24/2025, 8:30 AM",
    status: "open",
    reportedBy: "Driver B",
    // unassigned -> shows in Available
  },
  {
    id: 202,
    type: "problem",
    severity: "high",
    vehicle: "BUS101",
    location: "Depot - Bay 5",
    description: "Battery voltage low, intermittent starting issue.",
    date: "12/24/2025, 9:05 AM",
    status: "open",
    reportedBy: "Driver A",
    assigned: "Technician A",
    // assigned -> My Jobs (if you are Technician A)
  },
  {
    id: 203,
    type: "accident",
    severity: "critical",
    vehicle: "BUS333",
    location: "Depot - Body Shop",
    description: "Rear bumper replacement required after minor collision.",
    date: "12/23/2025, 5:40 PM",
    status: "closed",
    reportedBy: "Driver C",
    assigned: "Technician A",
    // closed -> Completed (if you are Technician A)
  },
];

export default function TechnicianScreen() {
  const router = useRouter();
  const { dbUser } = useSession() as any;
  const TECH_NAME = dbUser?.user_name ?? "Technician A";

  const [tab, setTab] = useState<Tab>("available");
  const [reports, setReports] = useState<Report[]>(INITIAL_TECH_REPORTS);

  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const [acceptTarget, setAcceptTarget] = useState<Report | null>(null);
  const [acceptVisible, setAcceptVisible] = useState(false);

  const availableReports = useMemo(
    () => reports.filter((r) => r.status === "open" && !r.assigned),
    [reports]
  );
  const myOpenReports = useMemo(
    () => reports.filter((r) => r.status === "open" && r.assigned === TECH_NAME),
    [reports, TECH_NAME]
  );
  const myClosedReports = useMemo(
    () => reports.filter((r) => r.status === "closed" && r.assigned === TECH_NAME),
    [reports, TECH_NAME]
  );

  const tabCounts = useMemo(
    () => ({
      available: availableReports.length,
      myJobs: myOpenReports.length,
      completed: myClosedReports.length,
    }),
    [availableReports.length, myOpenReports.length, myClosedReports.length]
  );

  const filtered = useMemo(() => {
    if (tab === "available") return availableReports;
    if (tab === "myJobs") return myOpenReports;
    return myClosedReports;
  }, [tab, availableReports, myOpenReports, myClosedReports]);

  const requestAccept = (report: Report) => {
    setAcceptTarget(report);
    setAcceptVisible(true);
  };

  const confirmAccept = () => {
    if (!acceptTarget) return;

    setReports((prev) =>
      prev.map((r) =>
        r.id === acceptTarget.id ? { ...r, assigned: TECH_NAME } : r
      )
    );

    setAcceptVisible(false);
    setAcceptTarget(null);

    // (Optional) switch them straight to My Jobs
    setTab("myJobs");
  };

  const openDetails = (report: Report) => {
    // keep your nice bottom-sheet modal too
    setSelectedReport(report);
    setDetailsVisible(true);
  };

  const goToJobScreen = (report: Report) => {
    // mode:
    // - available => view (read-only)
    // - myJobs => edit
    // - completed => view
    const mode =
      tab === "myJobs" ? "edit" : "view";

    router.push({
      pathname: "./job/[id]",
      params: { id: String(report.id), mode },
    });
  };

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: "#f9f9f9" }}>
        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "available", label: `Available (${tabCounts.available})` },
            { key: "myJobs", label: `My Jobs (${tabCounts.myJobs})` },
            { key: "completed", label: `Completed (${tabCounts.completed})` },
          ]}
        />

        {filtered.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            currentTech={TECH_NAME}
            onViewDetails={(r) => openDetails(r)}
            onAccept={tab === "available" ? requestAccept : undefined}
          />
        ))}
      </ScrollView>

      <JobDetailsModal
        visible={detailsVisible}
        report={selectedReport}
        onClose={() => setDetailsVisible(false)}
      />

      {/* Simple “go to job screen” shortcut: tap modal close then navigate if you want.
          If you want a button inside the modal, tell me and I’ll add it cleanly. */}
      {selectedReport && detailsVisible ? (
        // Lightweight pattern: when modal closes, user can tap "View Details" again,
        // but better is to add a button in the modal. Keeping your current modal unchanged for now.
        null
      ) : null}

      <ConfirmActionModal
        visible={acceptVisible}
        title="Accept Job"
        message={`Accept this job and assign it to ${TECH_NAME}?`}
        confirmLabel="Accept Job"
        confirmColor="#4CAF50"
        onCancel={() => setAcceptVisible(false)}
        onConfirm={confirmAccept}
      />
    </>
  );
}
