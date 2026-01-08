export type PartUsed = {
  id: number;
  name: string;
  code: string;
  qty: number;
};

export type ReportAudit = {
  // Pending reports will usually have no audit yet
  action?: "approved" | "declined";
  by?: string;
  at?: string; // ISO string from DB
  reason?: string;
};

export type Report = {
  id: number;

  // From DB: report_type
  type: "repair" | "problem" | "accident";

  // From DB: report_priority (you’ve been using "severity" in UI)
  severity: "low" | "medium" | "high" | "critical";

  // From DB: bus_id
  vehicle: string;

  // From DB: report_location
  location: string;

  // From DB: report_desc
  description: string;

  // From DB: report_uploaded_at (formatted for UI)
  date: string;

  // From DB: report_status
  status: "pending" | "open" | "closed";

  // Optional UI helpers
  reportedBy?: string; // e.g. reporter_name or reporter_email
  assigned?: string;   // if you later store technician assignment somewhere

  // NEW: review fields on REPORT
  audit?: ReportAudit;

  // Media (optional - if you later pull from REPORT_MEDIA/JOB_MEDIA)
  beforePhotos?: string[];
  afterPhotos?: string[];

  // Technician job progress (optional - depends on your job screen/backend)
  workPerformed?: string;
  partsUsed?: PartUsed[];

  // History (optional)
  jobHistory?: { date: string; workPerformed: string }[];
};
