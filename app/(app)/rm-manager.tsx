import { useMemo, useState } from "react";
import { ScrollView } from "react-native";

import ConfirmActionModal from "../components/ConfirmActionModal";
import DeclineReasonModal from "../components/DeclineReasonModal";
import JobDetailsModal from "../components/JobDetailsModal";
import ReportCard from "../components/ReportCard";
import SegmentedTabs from "../components/SegmentedTabs";
import { useSession } from "../ctx";
import { Report } from "../types/report";

type Tab = "pending" | "open" | "closed";

// -------------------- MOCK DATA --------------------
const INITIAL_REPORTS: Report[] = [
  {
    id: 101,
    type: "problem",
    severity: "high",
    vehicle: "BUS101",
    location: "Depot - Bay 3",
    description: "Engine warning light appeared during route. Needs diagnostic scan.",
    date: "12/24/2025, 9:10 AM",
    status: "pending",
    reportedBy: "Driver A (john.tan@company.com)",
  },
  {
    id: 102,
    type: "repair",
    severity: "medium",
    vehicle: "BUS205",
    location: "Route 8 - Stop 12",
    description: "Brakes squealing. Likely pads worn, schedule inspection.",
    date: "12/24/2025, 9:40 AM",
    status: "pending",
    reportedBy: "Driver B (amy.lim@company.com)",
  },
  {
    id: 103,
    type: "accident",
    severity: "critical",
    vehicle: "BUS333",
    location: "Highway Exit 5",
    description: "Minor collision, rear bumper damage. No injuries reported.",
    date: "12/24/2025, 10:05 AM",
    status: "open",
    reportedBy: "Driver C (mike.ng@company.com)",
    assigned: "Technician A",
    audit: {
      action: "approved",
      by: "RM Manager",
      at: new Date().toISOString(),
    },
  },
  {
    id: 104,
    type: "problem",
    severity: "low",
    vehicle: "BUS150",
    location: "Depot - Bay 1",
    description: "Cabin AC not cold. Can be checked during next service.",
    date: "12/23/2025, 4:25 PM",
    status: "closed",
    reportedBy: "Driver D (sara.lee@company.com)",
    audit: {
      action: "declined",
      by: "RM Manager",
      at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
      reason: "Duplicate report already raised for this bus.",
    },
  },
];

export default function RMManagerScreen() {
  const { dbUser } = useSession() as any;
  const MANAGER_NAME = dbUser?.user_name ?? "RM Manager";

  const [tab, setTab] = useState<Tab>("pending");
  const [reports, setReports] = useState<Report[]>(INITIAL_REPORTS);

  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const [approveTarget, setApproveTarget] = useState<Report | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);

  const [declineTarget, setDeclineTarget] = useState<Report | null>(null);
  const [declineVisible, setDeclineVisible] = useState(false);

  // ----- counts -----
  const pendingCount = useMemo(
    () => reports.filter((r) => r.status === "pending").length,
    [reports]
  );
  const openCount = useMemo(
    () => reports.filter((r) => r.status === "open").length,
    [reports]
  );
  const closedCount = useMemo(
    () => reports.filter((r) => r.status === "closed").length,
    [reports]
  );

  const filteredReports = useMemo(
    () => reports.filter((r) => r.status === tab),
    [reports, tab]
  );

  // ----- approve -----
  const requestApprove = (report: Report) => {
    setApproveTarget(report);
    setApproveVisible(true);
  };

  const confirmApprove = () => {
    if (!approveTarget) return;

    setReports((prev) =>
      prev.map((r) =>
        r.id === approveTarget.id
          ? {
              ...r,
              status: "open",
              // (demo) assign immediately, or leave unassigned if you prefer
              assigned: r.assigned ?? undefined,
              audit: {
                action: "approved",
                by: MANAGER_NAME,
                at: new Date().toISOString(),
              },
            }
          : r
      )
    );

    setApproveVisible(false);
    setApproveTarget(null);
  };

  // ----- decline -----
  const requestDecline = (report: Report) => {
    setDeclineTarget(report);
    setDeclineVisible(true);
  };

  const submitDecline = (reason: string) => {
    if (!declineTarget) return;

    setReports((prev) =>
      prev.map((r) =>
        r.id === declineTarget.id
          ? {
              ...r,
              status: "closed",
              audit: {
                action: "declined",
                by: MANAGER_NAME,
                at: new Date().toISOString(),
                reason,
              },
            }
          : r
      )
    );

    setDeclineVisible(false);
    setDeclineTarget(null);
  };

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: "#f9f9f9" }}>
        <SegmentedTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "pending", label: `Pending (${pendingCount})` },
            { key: "open", label: `Open (${openCount})` },
            { key: "closed", label: `Closed (${closedCount})` },
          ]}
        />

        {filteredReports.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            onViewDetails={(r) => {
              setSelectedReport(r);
              setDetailsVisible(true);
            }}
            onApprove={tab === "pending" ? requestApprove : undefined}
            onDecline={tab === "pending" ? requestDecline : undefined}
          />
        ))}
      </ScrollView>

      <JobDetailsModal
        visible={detailsVisible}
        report={selectedReport}
        onClose={() => setDetailsVisible(false)}
      />

      <ConfirmActionModal
        visible={approveVisible}
        title="Approve Job"
        message="Are you sure you want to approve this job?"
        confirmLabel="Approve Job"
        confirmColor="#4CAF50"
        onCancel={() => setApproveVisible(false)}
        onConfirm={confirmApprove}
      />

      <DeclineReasonModal
        visible={declineVisible}
        onCancel={() => setDeclineVisible(false)}
        onSubmit={submitDecline}
      />
    </>
  );
}
