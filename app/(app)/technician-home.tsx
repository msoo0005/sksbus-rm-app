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
      highlights={[
        { icon: "hand-paper", label: "Accept available jobs" },
        { icon: "camera", label: "Log before & after photos" },
        { icon: "check-double", label: "Mark jobs complete" },
      ]}
      secondaryAction={{
        title: "Tyre Inspections",
        description: "Submit a periodic tyre inspection for a bus",
        icon: "dot-circle",
        accent: "#EA580C",
        accentLight: "#FFF7ED",
        onPress: () => router.push("/technician/tyres" as any),
      }}
    />
  );
}
