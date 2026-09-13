// Shared "{Type} Report" / "{Type} Request" title phrasing used wherever a
// report/job's type used to be shown as a separate bubble — now folded into
// the title text itself instead (see reportForm.typeProblem/typeRepair/typeAccident).
export function reportTypeTitleLabel(
  type: string | null | undefined,
  t: (key: string) => string,
): string {
  const v = String(type ?? "").toLowerCase();
  if (v === "repair") return t("reportForm.typeRepair");
  if (v === "accident") return t("reportForm.typeAccident");
  return t("reportForm.typeProblem");
}
