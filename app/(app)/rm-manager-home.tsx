import { useRouter } from "expo-router";
import RoleHomeScreen from "@/components/RoleHomeScreen";
import TyreIcon from "@/components/icons/TyreIcon";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useOutstandingCount } from "@/hooks/useOutstandingCount";
import { useTyreAttention } from "@/hooks/useTyreAttention";
import { useI18n } from "@/i18n/i18n-ctx";
import { ROLE_COLORS, ROLE_ICONS } from "@/utils/roles";

const { accent, light } = ROLE_COLORS.rm_manager;

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
      roleIcon={ROLE_ICONS.rm_manager}
      actionTitle={t("rmManagerHome.actionTitle")}
      ctaLabel={t("rmManagerHome.ctaLabel")}
      actionDescription={t("rmManagerHome.actionDescription")}
      actionIcon="clipboard-check"
      accent={accent}
      accentLight={light}
      // Straight to the module — the gate has already secured a project. See
      // fleet-manager-home for why this no longer detours via the selector.
      onPress={() => router.push("/rm-manager" as any)}
      alertCount={outstanding}
      // Daily work only; performance figures have their own row below.
      highlights={[
        { icon: "check-circle", label: t("rmManagerHome.highlight1") },
        { icon: "tasks", label: t("rmManagerHome.highlight2") },
      ]}
      secondaryAction={{
        title: t("performance.homeTitle"),
        description: t("performance.homeDescription"),
        icon: "chart-bar",
        accent,
        accentLight: light,
        prominent: true,
        onPress: () => router.push("/performance" as any),
      }}
      extraActions={[
        {
          title: t("rmManagerHome.secondaryTitle"),
          description: t("rmManagerHome.secondaryDescription"),
          icon: "dot-circle",
          iconElement: <TyreIcon size={20} color={accent} />,
          accent,
          accentLight: light,
          // Tyre management is a main job for this role, not a side trip.
          prominent: true,
          badge: waiting > 0 ? t("tyres.section.homeBadge", { count: waiting }) : null,
          onPress: () => router.push("/tyres" as any),
        },
        {
          title: t("rmManagerHome.partsTitle"),
          description: t("rmManagerHome.partsDescription"),
          icon: "box-open",
          accent,
          accentLight: light,
          prominent: true,
          onPress: () => router.push("/inventory" as any),
        },
      ]}
    />
  );
}
