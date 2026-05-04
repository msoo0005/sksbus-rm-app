import { Stack, usePathname, useRouter } from "expo-router";
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSession } from "../ctx";

type RoleKey =
  | "admin"
  | "driver"
  | "fleet_manager"
  | "rm_manager"
  | "technician"
  | "inventory_manager";

const ROLE_ALLOWED_PREFIXES: Record<RoleKey, string[]> = {
  admin: ["/fleet-manager", "/rm-manager", "/technician", "/inventory", "/form", "/project-selector", "/buses"],
  fleet_manager: ["/fleet-manager", "/form", "/project-selector"],
  rm_manager: ["/rm-manager"],
  technician: ["/technician"],
  inventory_manager: ["/inventory"],
  driver: ["/form", "/project-selector"],
};

const ROLE_HOME: Record<RoleKey, string> = {
  admin: "/",
  fleet_manager: "/project-selector",
  rm_manager: "/rm-manager",
  technician: "/technician",
  inventory_manager: "/inventory",
  driver: "/project-selector",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  fleet_manager: "Fleet Manager",
  rm_manager: "R&M Manager",
  technician: "Technician",
  inventory_manager: "Inventory Manager",
  driver: "Driver",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function RouteGuard() {
  const { dbUser } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    if (!dbUser) return;
    if (pathname === "/" || pathname === "") return;

    const role = (dbUser.user_role ?? "driver") as RoleKey;
    const allowed = ROLE_ALLOWED_PREFIXES[role] ?? [];
    const isAllowed = allowed.some((prefix) => pathname.startsWith(prefix));

    if (!isAllowed) {
      router.replace(ROLE_HOME[role] as any);
    }
  }, [pathname, dbUser]);

  return null;
}

function ProfileButton() {
  const router = useRouter();
  const { dbUser, signOut } = useSession();
  const [visible, setVisible] = React.useState(false);

  const handleSignOut = async () => {
    setVisible(false);
    await signOut();
    router.replace("/sign-in");
  };

  if (!dbUser) return null;

  const initials = getInitials(dbUser.user_name || dbUser.user_email);
  const roleLabel = ROLE_LABEL[dbUser.user_role] ?? dbUser.user_role;

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={styles.avatarBtn}
        hitSlop={8}
      >
        <Text style={styles.avatarText}>{initials}</Text>
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {/* Large avatar */}
            <View style={styles.avatarLarge}>
              <Text style={styles.avatarLargeText}>{initials}</Text>
            </View>

            {/* User info */}
            <Text style={styles.name}>{dbUser.user_name}</Text>
            <Text style={styles.email}>{dbUser.user_email}</Text>

            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{roleLabel}</Text>
            </View>

            <View style={styles.divider} />

            <Pressable style={styles.signOutBtn} onPress={handleSignOut}>
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export default function RootLayout() {
  return (
    <>
      <RouteGuard />
      <Stack
        screenOptions={{
          headerRight: () => <ProfileButton />,
        }}
      >
        <Stack.Screen name="index" options={{ title: "Home" }} />
        <Stack.Screen name="fleet-manager" options={{ title: "Fleet Manager" }} />
        <Stack.Screen
          name="project-selector"
          options={{ title: "Select Your Project" }}
        />
        <Stack.Screen
          name="fleet-manager-history"
          options={{ title: "Your Submitted Reports" }}
        />
        <Stack.Screen name="rm-manager" options={{ title: "R&M Manager" }} />
        <Stack.Screen name="technician/index" options={{ title: "Technician" }} />
        <Stack.Screen name="inventory" options={{ title: "Inventory Manager" }} />
        <Stack.Screen name="form" options={{ title: "Report Form" }} />
        <Stack.Screen name="buses" options={{ title: "Bus Fleet" }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  avatarBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  avatarText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 80,
    paddingRight: 16,
  },
  sheet: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: 280,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },

  avatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  avatarLargeText: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  name: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    marginBottom: 4,
  },
  email: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 12,
  },

  roleBadge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
    letterSpacing: 0.3,
  },

  divider: {
    width: "100%",
    height: 1,
    backgroundColor: "#F3F4F6",
    marginVertical: 18,
  },

  signOutBtn: {
    width: "100%",
    height: 48,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#DC2626",
  },
});
