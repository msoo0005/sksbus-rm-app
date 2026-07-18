import { useRouter } from "expo-router";
import RoleHomeScreen from "../components/RoleHomeScreen";

export default function FleetManagerHomeScreen() {
  const router = useRouter();

  return (
    <RoleHomeScreen
      roleLabel="Fleet Manager"
      actionTitle="Submit a Report"
      actionDescription="Select a project to report problems, repairs & accidents"
      actionIcon="truck"
      accent="#2563EB"
      accentLight="#EFF6FF"
      onPress={() => router.push("./project-selector")}
    />
  );
}
