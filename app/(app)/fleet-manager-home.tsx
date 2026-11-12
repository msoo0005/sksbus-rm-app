import { useRouter } from "expo-router";
import RoleHomeScreen from "@/components/RoleHomeScreen";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { usePuspakomCount } from "@/hooks/usePuspakomCount";
import { useI18n } from "@/i18n/i18n-ctx";
import { ROLE_COLORS, ROLE_ICONS } from "@/utils/roles";

const { accent, light } = ROLE_COLORS.fleet_manager;

export default function FleetManagerHomeScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const projectId = useProjectFilter();
  const puspakomCount = usePuspakomCount("fleet_manager", projectId);

  return (
    <RoleHomeScreen
      roleLabel={t("roles.fleet_manager")}
      roleIcon={ROLE_ICONS.fleet_manager}
      actionTitle={t("fleetManagerHome.actionTitle")}
      actionDescription={t("fleetManagerHome.actionDescription")}
      ctaLabel={t("fleetManagerHome.ctaLabel")}
      actionIcon="exclamation-triangle"
      accent={accent}
      accentLight={light}
      // Straight to the problem report form. Fleet managers only report
      // problems for now (Request Repair and Report Accident are hidden), so
      // the old in-between action page is gone. Switching project is the
      // logo tile's job.
      onPress={() => router.push({ pathname: "/form", params: { type: "problem" } } as any)}
      // Rows by importance (v2.0.0 A1): PUSPAKOM, then report history, then KPIs.
      secondaryAction={{
        title: t("puspakom.home.fmTitle"),
        description: t("puspakom.home.fmDesc"),
        icon: "clipboard-check",
        iconElement: <PuspakomMark size={22} withText={false} />,
        accent,
        accentLight: light,
        prominent: true,
        alertCount: puspakomCount,
        onPress: () => router.push("/puspakom" as any),
      }}
      extraActions={[
        {
          title: t("fleetManagerActions.myReportHistoryTitle"),
          description: t("fleetManagerActions.myReportHistoryDesc"),
          icon: "history",
          accent,
          accentLight: light,
          prominent: true,
          onPress: () => router.push("/fleet-manager-history" as any),
        },
        {
          title: t("performance.homeTitle"),
          description: t("performance.homeDescription"),
          icon: "chart-bar",
          accent,
          accentLight: light,
          prominent: true,
          onPress: () => router.push("/performance" as any),
        },
      ]}
    />
  );
}
