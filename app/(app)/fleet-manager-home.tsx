import { useRouter } from "expo-router";
import RoleHomeScreen from "@/components/RoleHomeScreen";
import { useI18n } from "@/i18n/i18n-ctx";

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
      // Straight to the module. This used to route via the project selector,
      // because back then nothing else guaranteed a project had been chosen —
      // the gate in _layout.tsx does now, so going through the selector again
      // would show it twice in one flow: once on the way in, once on the way to
      // the very first thing you do. Switching project is the chip's job.
      onPress={() => router.push("/fleet-manager" as any)}
      highlights={[
        { icon: "exclamation-triangle", label: t("fleetManagerHome.highlight1") },
        { icon: "wrench", label: t("fleetManagerHome.highlight2") },
        { icon: "history", label: t("fleetManagerHome.highlight3") },
      ]}
    />
  );
}
