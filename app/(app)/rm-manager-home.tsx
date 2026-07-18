import { useRouter } from "expo-router";
import RoleHomeScreen from "../components/RoleHomeScreen";

export default function RmManagerHomeScreen() {
  const router = useRouter();

  return (
    <RoleHomeScreen
      roleLabel="R&M Manager"
      actionTitle="Open R&M Manager"
      actionDescription="Approve & manage work orders"
      actionIcon="clipboard-check"
      accent="#16A34A"
      accentLight="#F0FDF4"
      onPress={() => router.push("./rm-manager")}
      highlights={[
        { icon: "check-circle", label: "Approve or decline pending reports" },
        { icon: "tasks", label: "Track open & closed jobs" },
        { icon: "chart-bar", label: "Monitor KPIs and completion rates" },
      ]}
    />
  );
}
