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
    description:
      'Warning light on dashboard, needs diagnostic check.',
    date: '10/14/2025, 4:00 PM',
    status: 'open',
  },
];

export default function RMManagerScreen() {
  const [tab, setTab] = useState<'open' | 'closed' | 'pending'>('open');

  const openCount = REPORTS.filter(r => r.status === 'open').length;
  const closedCount = REPORTS.filter(r => r.status === 'closed').length;
  const pendingCount = REPORTS.filter(r => r.status === 'pending').length;

  const tabs = [
    { label: `Pending (${pendingCount})`, key: 'pending' as const },
    { label: `Open (${openCount})`, key: 'open' as const },
    { label: `Closed (${closedCount})`, key: 'closed' as const },
    
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f9f9f9' }}>
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        tabs={tabs}
      />

      {REPORTS.filter(r => r.status === tab).map(report => (
        <ReportCard key={report.id} report={report} />
      ))}
    </ScrollView>
  );
}
