import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';

import ConfirmActionModal from '../../components/ConfirmActionModal';
import ReportCard from '../../components/ReportCard';
import SegmentedTabs from '../../components/SegmentedTabs';
import { Report } from '../../types/report';

const INITIAL_REPORTS: Report[] = [
  {
    id: 2,
    type: 'repair',
    severity: 'low',
    vehicle: 'V-003',
    location: 'Route 12',
    description:
      'Scheduled 50,000 km service due. Needs oil change, filter replacement, and brake inspection.',
    date: '10/13/2025, 2:20 PM',
    assigned: 'Technician B',
    status: 'open',
    beforePhotos: [],
  },
  {
    id: 5,
    type: 'problem',
    severity: 'critical',
    vehicle: 'V-004',
    location: 'Route 8',
    description: 'Warning light on dashboard, needs diagnostic check.',
    date: '10/14/2025, 4:00 PM',
    status: 'open',
    beforePhotos: [],
  },
];

const CURRENT_TECH = 'Technician B';

export default function TechnicianScreen() {
  const router = useRouter();

  const [reports, setReports] = useState<Report[]>(INITIAL_REPORTS);
  const [tab, setTab] = useState<'available' | 'myJobs' | 'completed'>('available');

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [acceptReport, setAcceptReport] = useState<Report | null>(null);

  const availableJobs = useMemo(
    () => reports.filter(r => r.status === 'open' && !r.assigned),
    [reports]
  );

  const myJobs = useMemo(
    () => reports.filter(r => r.assigned === CURRENT_TECH && r.status === 'open'),
    [reports]
  );

  const completedJobs = useMemo(
    () => reports.filter(r => r.status === 'closed' && r.assigned === CURRENT_TECH),
    [reports]
  );

  const tabs = [
    { label: `Available (${availableJobs.length})`, key: 'available' as const },
    { label: `My Jobs (${myJobs.length})`, key: 'myJobs' as const },
    { label: `Completed (${completedJobs.length})`, key: 'completed' as const },
  ];

  const displayedReports =
    tab === 'available' ? availableJobs : tab === 'myJobs' ? myJobs : completedJobs;

  const handleViewDetails = (report: Report) => {
    // ✅ Available & Completed are view-only, My Jobs is editable
    const mode: 'view' | 'edit' = tab === 'myJobs' ? 'edit' : 'view';

    router.push({
      pathname: `/technician/job/[id]`,
      params: { id: report.id, mode },
    });
  };

  const requestAccept = (report: Report) => {
    setAcceptReport(report);
    setConfirmVisible(true);
  };

  const confirmAccept = () => {
    if (!acceptReport) return;

    setReports(prev =>
      prev.map(r => (r.id === acceptReport.id ? { ...r, assigned: CURRENT_TECH } : r))
    );

    setConfirmVisible(false);
    setAcceptReport(null);
  };

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: '#f9f9f9' }}>
        <SegmentedTabs value={tab} onChange={setTab} tabs={tabs} />

        {displayedReports.map(report => (
          <ReportCard
            key={report.id}
            report={report}
            currentTech={CURRENT_TECH}
            onViewDetails={handleViewDetails}
            onAccept={tab === 'available' ? requestAccept : undefined}
          />
        ))}
      </ScrollView>

      <ConfirmActionModal
        visible={confirmVisible}
        title="Accept Job"
        message="Are you sure you want to accept this job? It will be assigned to you."
        confirmLabel="Accept Job"
        confirmColor="#4CAF50"
        onCancel={() => setConfirmVisible(false)}
        onConfirm={confirmAccept}
      />
    </>
  );
}
