import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Pressable,
  ScrollView,
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

const ROLE_ACCESS: Record<RoleKey, string[]> = {
  admin: ["fleet-manager", "rm-manager", "technician", "inventory", "form", "buses"],
  fleet_manager: ["fleet-manager", "form"],
  rm_manager: ["rm-manager"],
  technician: ["technician"],
  inventory_manager: ["inventory"],
  driver: ["form"],
};

const ROLE_REDIRECT: Partial<Record<RoleKey, string>> = {
  fleet_manager: "/fleet-manager-home",
  rm_manager: "/rm-manager-home",
  technician: "/technician-home",
  inventory_manager: "/inventory",
  driver: "/project-selector",
};

const MODULES = [
  {
    id: "fleet-manager",
    title: "Fleet Manager",
    description: "Report problems, repairs & accidents",
    icon: "truck",
    accent: "#2563EB",
    accentLight: "#EFF6FF",
  },
  {
    id: "rm-manager",
    title: "R&M Manager",
    description: "Approve & manage work orders",
    icon: "clipboard-check",
    accent: "#16A34A",
    accentLight: "#F0FDF4",
  },
  {
    id: "technician",
    title: "Technician",
    description: "Complete repairs & maintenance",
    icon: "wrench",
    accent: "#EA580C",
    accentLight: "#FFF7ED",
  },
  {
    id: "inventory",
    title: "Inventory",
    description: "Manage parts & supplies",
    icon: "boxes",
    accent: "#7C3AED",
    accentLight: "#F5F3FF",
  },
  {
    id: "buses",
    title: "Bus Fleet",
    description: "View & manage buses",
    icon: "bus",
    accent: "#0284C7",
    accentLight: "#F0F9FF",
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFirstName(name: string) {
  return name?.split(" ")[0] ?? name;
}

export default function HomeScreen() {
  const { dbUser } = useSession();
  const router = useRouter();

  const role = (dbUser?.user_role ?? "driver") as RoleKey;
  const allowedIds = ROLE_ACCESS[role] ?? [];
  const redirect = ROLE_REDIRECT[role];

  React.useEffect(() => {
    if (redirect) router.replace(redirect as any);
  }, [redirect]);

  if (redirect) return null;

  const handlePress = (moduleId: string) => {
    if (moduleId === "fleet-manager") {
      router.push("./project-selector");
    } else {
      router.push(`./${moduleId}` as any);
    }
  };

  const firstName = getFirstName(dbUser?.user_name ?? "");

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{getGreeting()},</Text>
        <Text style={styles.name}>{firstName}</Text>
        <Text style={styles.subtitle}>SKSBUS R&amp;M System</Text>
      </View>

      {/* Section label */}
      <Text style={styles.sectionLabel}>MODULES</Text>

      {/* Card grid */}
      <View style={styles.grid}>
        {MODULES.map((mod) => {
          const enabled = allowedIds.includes(mod.id);
          return (
            <Pressable
              key={mod.id}
              style={styles.cardWrap}
              disabled={!enabled}
              onPress={() => handlePress(mod.id)}
            >
              {({ pressed }) => (
                <View
                  style={[
                    styles.card,
                    pressed && enabled && styles.cardPressed,
                    !enabled && styles.cardDisabled,
                  ]}
                >
                  {/* Icon */}
                  <View
                    style={[
                      styles.iconBox,
                      { backgroundColor: enabled ? mod.accentLight : "#F3F4F6" },
                    ]}
                  >
                    <FontAwesome5
                      name={mod.icon as any}
                      size={22}
                      color={enabled ? mod.accent : "#9CA3AF"}
                    />
                  </View>

                  {/* Text */}
                  <Text style={[styles.cardTitle, !enabled && styles.textMuted]}>
                    {mod.title}
                  </Text>
                  <Text style={[styles.cardDesc, !enabled && styles.textMuted]}>
                    {mod.description}
                  </Text>

                  {/* Footer row */}
                  <View style={styles.cardFooter}>
                    {enabled ? (
                      <View style={[styles.openPill, { backgroundColor: mod.accentLight }]}>
                        <Text style={[styles.openPillText, { color: mod.accent }]}>
                          Open
                        </Text>
                        <FontAwesome5 name="arrow-right" size={9} color={mod.accent} />
                      </View>
                    ) : (
                      <View style={styles.lockedPill}>
                        <FontAwesome5 name="lock" size={9} color="#9CA3AF" />
                        <Text style={styles.lockedText}>No access</Text>
                      </View>
                    )}
                  </View>

                  {/* Accent bar */}
                  {enabled && (
                    <View style={[styles.accentBar, { backgroundColor: mod.accent }]} />
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },

  header: {
    paddingVertical: 24,
    marginBottom: 4,
  },
  greeting: {
    fontSize: 16,
    fontWeight: "500",
    color: "#6B7280",
    marginBottom: 2,
  },
  name: {
    fontSize: 34,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9CA3AF",
    letterSpacing: 0.3,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    marginBottom: 14,
    marginTop: 4,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  cardWrap: {
    width: "47.5%",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 18,
    minHeight: 170,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPressed: {
    transform: [{ scale: 0.97 }],
    shadowOpacity: 0.03,
  },
  cardDisabled: {
    backgroundColor: "#FAFAFA",
    borderColor: "#F3F4F6",
  },

  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },

  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
    lineHeight: 20,
  },
  cardDesc: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6B7280",
    lineHeight: 17,
    flex: 1,
  },
  textMuted: {
    color: "#D1D5DB",
  },

  cardFooter: {
    marginTop: 16,
  },
  openPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  openPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  lockedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
  },
  lockedText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9CA3AF",
  },

  accentBar: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 4,
    height: "100%",
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
  },
});
