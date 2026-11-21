// Pill colours for a record's status in the admin's Reports & jobs tool.
export const ADMIN_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: "#F3F4F6", fg: "#6B7280" },
  pending: { bg: "#EFF6FF", fg: "#1D4ED8" },
  declined: { bg: "#FEF2F2", fg: "#B91C1C" },
  approved: { bg: "#F5F3FF", fg: "#6D28D9" },
  accepted: { bg: "#FFF7ED", fg: "#C2410C" },
  arrived: { bg: "#F0F9FF", fg: "#0369A1" },
  pending_approval: { bg: "#FFFBEB", fg: "#B45309" },
  closed: { bg: "#F0FDF4", fg: "#15803D" },
};
