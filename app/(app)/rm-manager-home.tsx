import { useRouter } from "expo-router";
import RoleHomeScreen from "../components/RoleHomeScreen";
import { useI18n } from "../i18n/i18n-ctx";

export default function RmManagerHomeScreen() {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <RoleHomeScreen
      roleLabel={t("roles.rm_manager")}
      actionTitle={t("rmManagerHome.actionTitle")}
      actionDescription={t("rmManagerHome.actionDescription")}
      actionIcon="clipboard-check"
      accent="#16A34A"
      accentLight="#F0FDF4"
      onPress={() => router.push("./rm-manager")}
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
        onPress: () => router.push("/rm-manager/tyres" as any),
      }}
    />
  );
}
