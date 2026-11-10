import { useRouter } from "expo-router";
import RoleHomeScreen from "@/components/RoleHomeScreen";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useOutstandingCount } from "@/hooks/useOutstandingCount";
import { useTyreAttention } from "@/hooks/useTyreAttention";
import { useI18n } from "@/i18n/i18n-ctx";

export default function RmManagerHomeScreen() {
  const router = useRouter();
  const { t } = useI18n();
  // Two cheap scans, so the tyre card can say whether anything is waiting
  // instead of making the manager open it to find out.
  const projectId = useProjectFilter();
  const { overdueBuses, lowTread } = useTyreAttention(projectId);
  const waiting = overdueBuses.length + lowTread.length;
  // Pending + Open reports — the red bubble on the reports card.
  const outstanding = useOutstandingCount("rm_manager", projectId);

  return (
    <RoleHomeScreen
      roleLabel={t("roles.rm_manager")}
      actionTitle={t("rmManagerHome.actionTitle")}
      ctaLabel={t("rmManagerHome.ctaLabel")}
      actionDescription={t("rmManagerHome.actionDescription")}
      actionIcon="clipboard-check"
      accent="#16A34A"
      accentLight="#F0FDF4"
      // Straight to the module — the gate has already secured a project. See
      // fleet-manager-home for why this no longer detours via the selector.
      onPress={() => router.push("/rm-manager" as any)}
      alertCount={outstanding}
      highlights={[
        { icon: "check-circle", label: t("rmManagerHome.highlight1") },
        { icon: "tasks", label: t("rmManagerHome.highlight2") },
        { icon: "chart-bar", label: t("rmManagerHome.highlight3") },
      ]}
      secondaryAction={{
        title: t("rmManagerHome.secondaryTitle"),
        description: t("rmManagerHome.secondaryDescription"),
        icon: "dot-circle",
        accent: "#16A34A",
        accentLight: "#F0FDF4",
        // Tyre management is a main job for this role, not a side trip.
        prominent: true,
        badge: waiting > 0 ? t("tyres.section.homeBadge", { count: waiting }) : null,
        onPress: () => router.push("/tyres" as any),
      }}
      extraActions={[
        {
          title: t("rmManagerHome.partsTitle"),
          description: t("rmManagerHome.partsDescription"),
          icon: "cogs",
          accent: "#16A34A",
          accentLight: "#F0FDF4",
          onPress: () => router.push("/inventory" as any),
        },
      ]}
    />
  );
}
