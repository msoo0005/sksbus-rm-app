import { useRouter } from "expo-router";
import RoleHomeScreen from "../components/RoleHomeScreen";

export default function TechnicianHomeScreen() {
  const router = useRouter();

  return (
    <RoleHomeScreen
      roleLabel="Technician"
      actionTitle="Open Technician"
      actionDescription="Complete repairs & maintenance"
      actionIcon="wrench"
      accent="#EA580C"
      accentLight="#FFF7ED"
      onPress={() => router.push("./technician")}
    />
  );
}
