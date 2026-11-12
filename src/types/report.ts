export type PartUsed = {
  id: number;
  name: string;
  code: string;
  qty: number;
};

// A person shown with their sign-off: the name they typed, their account
// username, and the selfie taken at that moment (see PersonChip).
export type ReportPerson = {
  name?: string | null;
  username?: string | null;
  selfieUrl?: string | null;
};

export type ReportAudit = {
  // Pending reports will usually have no audit yet
  action?: "approved" | "declined";
  by?: string;
  // Approval sign-off (verified name + selfie), when there is one.
  person?: ReportPerson;
  at?: string; // ISO string from DB
  reason?: string;
};

export type Report = {
  id: number;

  // From DB: report_type. "job_order" is a job a technician logged directly
  // (no breakdown report, no approval).
  type: "repair" | "problem" | "accident" | "job_order";

  // From DB: report_priority (you’ve been using "severity" in UI)
  severity: "low" | "medium" | "high" | "critical";

  // From DB: bus_id (the plate)
  vehicle: string;
  // From DB: bus_ev_no, the bus's own fleet number. Shown after the plate:
  // "VMQ6372 (EV012)" — see utils/busLabel.
  evNumber?: string | null;

  // From DB: report_issue_type (null on reports filed before issue types).
  issueType?: string | null;

  // From DB: report_location
  location: string;
  lat?: number | null;
  lng?: number | null;

  // From DB: report_desc
  description: string;

  // From DB: report_uploaded_at (formatted for UI)
  date: string;
  // Same value as `date`, but the raw ISO timestamp — kept alongside the
  // formatted string so a live "time since" readout can be computed from it.
  dateIso?: string | null;

  // When the report left the "open" state (decline or job completion) —
  // used to freeze the elapsed-time readout instead of letting it keep
  // ticking past resolution.
  closedAt?: string | null;

  // From DB: report_status
  status: "pending" | "open" | "closed";

  // Optional UI helpers
  reportedBy?: string; // e.g. reporter_name or reporter_email
  // The reporter as signed off at submission — photo, typed name, username.
  reporter?: ReportPerson;
  assigned?: string;   // technician's username, when the job has been taken
  // The technician who accepted the job, as signed off at acceptance —
  // photo, typed name, username. Shown like `reporter`.
  assignee?: ReportPerson;

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
