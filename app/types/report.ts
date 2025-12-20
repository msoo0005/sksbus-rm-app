// ../types/report.ts
export type Report = {
  id: number;
  type: 'repair' | 'problem';
  severity: 'low' | 'medium' | 'high' | 'critical';
  vehicle: string;
  location: string;
  description: string;
  date: string;
  status: 'pending' | 'open' | 'closed';

  // NEW / existing optional fields
  reportedBy?: string;
  assigned?: string;

  audit?: {
    action: 'approved' | 'declined';
    by: string;
    at: string;
    reason?: string;
  };
};
