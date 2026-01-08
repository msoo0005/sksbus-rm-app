import { Dimensions, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import RoleSelectionGrid from "../components/RoleSelectionGrid";
import { useSession } from "../ctx";

const { height } = Dimensions.get("window");
const headerHeight = 0.1 * height;
const sidePadding = 10;

type RoleKey =
  | "admin"
  | "driver"
  | "fleet_manager"
  | "rm_manager"
  | "technician"
  | "inventory_manager";

const ROLE_ACCESS: Record<RoleKey, string[]> = {
  admin: ["fleet-manager", "rm-manager", "technician", "inventory", "form"],
  fleet_manager: ["fleet-manager", "form"],
  rm_manager: ["rm-manager"],
  technician: ["technician"],
  inventory_manager: ["inventory"],
  driver: ["form"],
};

export default function HomeScreen() {
  const { dbUser } = useSession();
  console.log("DB USER ROLE:", dbUser)

  // fallback to driver while loading
  const role = (dbUser?.user_role ?? "driver") as RoleKey;
  const allowedRoles = ROLE_ACCESS[role] ?? [];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.container}>
        {/* ✅ FIX: pass allowedRoles */}
        <RoleSelectionGrid allowedRoles={allowedRoles} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: sidePadding,
  },
  header: {
    height: headerHeight,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    backgroundColor: "#fff",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  subHeaderTitle: {
    fontSize: 10,
    fontWeight: "300",
  },
});
