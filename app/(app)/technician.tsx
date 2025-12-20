import { useState } from 'react';
import { ScrollView } from 'react-native';
import ReportCard from '../components/ReportCard';
import SegmentedTabs from '../components/SegmentedTabs';

type Report = {
  id: number;
  type: 'repair' | 'problem';
  severity: 'medium' | 'high' | 'low' | 'critical';
  vehicle: string;
  location: string;
  description: string;
  date: string;
  assigned?: string;
  status: 'pending' | 'open' | 'closed';
};

const REPORTS: Report[] = [
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
  },
];

const CURRENT_TECH = 'Technician B'; // replace with actual logged-in technician

export default function TechnicianJobsScreen() {
  const [tab, setTab] = useState<'available' | 'myJobs' | 'completed'>('available');

  const availableJobs = REPORTS.filter(r => r.status === 'open' && !r.assigned);
  const myJobs = REPORTS.filter(r => r.assigned === CURRENT_TECH && r.status === 'open');
  const completedJobs = REPORTS.filter(r => r.status === 'closed' && r.assigned === CURRENT_TECH);

  const tabs = [
    { label: `Available (${availableJobs.length})`, key: 'available' as const },
    { label: `My Jobs (${myJobs.length})`, key: 'myJobs' as const },
    { label: `Completed (${completedJobs.length})`, key: 'completed' as const },
  ];

  // Determine which reports to show based on selected tab
  const displayedReports = 
    tab === 'available' ? availableJobs :
    tab === 'myJobs' ? myJobs :
    completedJobs;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f9f9f9' }}>
      <SegmentedTabs value={tab} onChange={setTab} tabs={tabs} />

      {displayedReports.map(report => (
        <ReportCard key={report.id} report={report} />
      ))}
    </ScrollView>
  );
}
