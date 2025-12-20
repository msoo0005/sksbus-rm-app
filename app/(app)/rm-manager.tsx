import { useState } from 'react';
import { ScrollView } from 'react-native';
import ConfirmActionModal from '../components/ConfirmActionModal';
import DeclineReasonModal from '../components/DeclineReasonModal';
import JobDetailsModal from '../components/JobDetailsModal';
import ReportCard from '../components/ReportCard';
import SegmentedTabs from '../components/SegmentedTabs';
import { Report } from '../types/report';

const MANAGER_NAME = 'RM Manager A';

const INITIAL_REPORTS: Report[] = [
  {
    id: 5,
    type: 'problem',
    severity: 'critical',
    vehicle: 'V-004',
    location: 'Route 8',
    description: 'Warning light on dashboard, needs diagnostic check.',
    date: '10/14/2025, 4:00 PM',
    status: 'pending',
    reportedBy: 'Driver John Tan',
  },
];

export default function RMManagerScreen() {
  const [reports, setReports] = useState<Report[]>(INITIAL_REPORTS);
  const [tab, setTab] = useState<'pending' | 'open' | 'closed'>('pending');

  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const [approveTarget, setApproveTarget] = useState<Report | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);

  const [declineTarget, setDeclineTarget] = useState<Report | null>(null);
  const [declineVisible, setDeclineVisible] = useState(false);

  // ----- Counts -----
  const pendingCount = reports.filter(r => r.status === 'pending').length;
  const openCount = reports.filter(r => r.status === 'open').length;
  const closedCount = reports.filter(r => r.status === 'closed').length;

  // ----- Approve -----
  const requestApprove = (report: Report) => {
    setApproveTarget(report);
    setApproveVisible(true);
  };

  const confirmApprove = () => {
    if (!approveTarget) return;

    setReports(prev =>
      prev.map(r =>
        r.id === approveTarget.id
          ? {
              ...r,
              status: 'open',
              audit: {
                action: 'approved',
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

  // ----- Decline -----
  const requestDecline = (report: Report) => {
    setDeclineTarget(report);
    setDeclineVisible(true);
  };

  const submitDecline = (reason: string) => {
    if (!declineTarget) return;

    setReports(prev =>
      prev.map(r =>
        r.id === declineTarget.id
          ? {
              ...r,
              status: 'closed',
              audit: {
                action: 'declined',
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

  const filteredReports = reports.filter(r => r.status === tab);

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: '#f9f9f9' }}>
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'pending', label: `Pending (${pendingCount})` },
            { key: 'open', label: `Open (${openCount})` },
            { key: 'closed', label: `Closed (${closedCount})` },
          ]}
        />

        {filteredReports.map(report => (
          <ReportCard
            key={report.id}
            report={report}
            onViewDetails={r => {
              setSelectedReport(r);
              setDetailsVisible(true);
            }}
            onApprove={tab === 'pending' ? requestApprove : undefined}
            onDecline={tab === 'pending' ? requestDecline : undefined}
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
