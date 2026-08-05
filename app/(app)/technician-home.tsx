import { useRouter } from "expo-router";
import RoleHomeScreen from "../components/RoleHomeScreen";
import { useI18n } from "../i18n/i18n-ctx";

export default function TechnicianHomeScreen() {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <RoleHomeScreen
      roleLabel={t("roles.technician")}
      actionTitle={t("technicianHome.actionTitle")}
      actionDescription={t("technicianHome.actionDescription")}
      actionIcon="wrench"
      accent="#EA580C"
      accentLight="#FFF7ED"
      onPress={() => router.push("./technician")}
      highlights={[
        { icon: "hand-paper", label: t("technicianHome.highlight1") },
        { icon: "camera", label: t("technicianHome.highlight2") },
        { icon: "check-double", label: t("technicianHome.highlight3") },
      ]}
      secondaryAction={{
        title: t("technicianHome.secondaryTitle"),
        description: t("technicianHome.secondaryDescription"),
        icon: "dot-circle",
        accent: "#EA580C",
        accentLight: "#FFF7ED",
        onPress: () => router.push("/technician/tyres" as any),
      }}
    />
  );
}
