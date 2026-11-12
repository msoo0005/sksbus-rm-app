import { useRouter } from "expo-router";
import RoleHomeScreen from "@/components/RoleHomeScreen";
import { useI18n } from "@/i18n/i18n-ctx";
import { ROLE_COLORS, ROLE_ICONS } from "@/utils/roles";

const { accent, light } = ROLE_COLORS.fleet_manager;

export default function FleetManagerHomeScreen() {
  const router = useRouter();
  const { t } = useI18n();

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
      secondaryAction={{
        title: t("fleetManagerActions.myReportHistoryTitle"),
        description: t("fleetManagerActions.myReportHistoryDesc"),
        icon: "history",
        accent,
        accentLight: light,
        prominent: true,
        onPress: () => router.push("/fleet-manager-history" as any),
      }}
      extraActions={[
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
