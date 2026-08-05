import { useRouter } from "expo-router";
import RoleHomeScreen from "../components/RoleHomeScreen";
import { useI18n } from "../i18n/i18n-ctx";

export default function FleetManagerHomeScreen() {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <RoleHomeScreen
      roleLabel={t("roles.fleet_manager")}
      actionTitle={t("fleetManagerHome.actionTitle")}
      actionDescription={t("fleetManagerHome.actionDescription")}
      actionIcon="truck"
      accent="#2563EB"
      accentLight="#EFF6FF"
      onPress={() => router.push("./project-selector")}
      highlights={[
        { icon: "exclamation-triangle", label: t("fleetManagerHome.highlight1") },
        { icon: "wrench", label: t("fleetManagerHome.highlight2") },
        { icon: "history", label: t("fleetManagerHome.highlight3") },
      ]}
    />
  );
}
