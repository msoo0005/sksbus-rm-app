import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import HomeHeader from "../components/HomeHeader";
import { useSession } from "../ctx";

type RoleKey =
  | "admin"
  | "driver"
  | "fleet_manager"
  | "rm_manager"
  | "technician"
  | "inventory_manager";

const ROLE_REDIRECT: Partial<Record<RoleKey, string>> = {
  fleet_manager: "/fleet-manager-home",
  rm_manager: "/rm-manager-home",
  technician: "/technician-home",
  inventory_manager: "/inventory",
  driver: "/project-selector",
};

const ADMIN_ACCENT = "#4338CA";
const ADMIN_ACCENT_LIGHT = "#EEF2FF";

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

const CONTENT_MAX_WIDTH = 720;
const CONTENT_H_PADDING = 20;
const GRID_GAP = 14;

export default function HomeScreen() {
  const { dbUser } = useSession();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();

  const role = (dbUser?.user_role ?? "driver") as RoleKey;
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

  // Responsive columns: 2 on phones, more as the screen (or split-view pane) widens.
  const contentWidth = Math.min(windowWidth, CONTENT_MAX_WIDTH) - CONTENT_H_PADDING * 2;
  const columns = windowWidth >= 900 ? 4 : windowWidth >= 600 ? 3 : 2;
  const cardWidth = (contentWidth - GRID_GAP * (columns - 1)) / columns;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <HomeHeader
        roleLabel="Administrator"
        roleColor={ADMIN_ACCENT}
        roleColorLight={ADMIN_ACCENT_LIGHT}
      />

      <Text style={styles.sectionLabel}>QUICK ACCESS</Text>

      <View style={styles.grid}>
        {MODULES.map((mod) => (
          <Pressable
            key={mod.id}
            style={{ width: cardWidth }}
            onPress={() => handlePress(mod.id)}
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: mod.accentLight,
                    borderColor: `${mod.accent}33`,
                  },
                  pressed && styles.cardPressed,
                ]}
              >
                <View style={styles.iconBox}>
                  <FontAwesome5 name={mod.icon as any} size={20} color={mod.accent} />
                </View>

                <Text style={styles.cardTitle} numberOfLines={1}>
                  {mod.title}
                </Text>
                <Text style={styles.cardDesc} numberOfLines={2}>
                  {mod.description}
                </Text>

                <View style={styles.cardFooter}>
                  <Text style={[styles.openText, { color: mod.accent }]}>Open</Text>
                  <FontAwesome5 name="arrow-right" size={10} color={mod.accent} />
                </View>
              </View>
            )}
          </Pressable>
        ))}
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
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: CONTENT_H_PADDING,
    paddingTop: 8,
    paddingBottom: 32,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    marginBottom: 14,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  card: {
    minHeight: 172,
    borderRadius: 22,
    borderWidth: 1.5,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  cardPressed: {
    transform: [{ scale: 0.97 }],
    shadowOpacity: 0.03,
  },

  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    backgroundColor: "#FFFFFF",
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
    color: "#4B5563",
    lineHeight: 17,
    // Reserve space for 2 lines regardless of actual length, so cards stay
    // the same height whether the description wraps or not.
    minHeight: 34,
  },

  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
  },
  openText: {
    fontSize: 12,
    fontWeight: "800",
  },
});
