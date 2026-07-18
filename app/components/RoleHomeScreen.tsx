import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSession } from "../ctx";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFirstName(name: string) {
  return name?.split(" ")[0] ?? name;
}

type Props = {
  roleLabel: string;
  actionTitle: string;
  actionDescription: string;
  actionIcon: string;
  accent: string;
  accentLight: string;
  onPress: () => void;
};

export default function RoleHomeScreen({
  roleLabel,
  actionTitle,
  actionDescription,
  actionIcon,
  accent,
  accentLight,
  onPress,
}: Props) {
  const { dbUser } = useSession();
  const firstName = getFirstName(dbUser?.user_name ?? "");

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>{getGreeting()},</Text>
        <Text style={styles.name}>{firstName}</Text>
        <Text style={styles.subtitle}>{roleLabel} • SKSBUS R&amp;M System</Text>
      </View>

      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={[styles.iconBox, { backgroundColor: accentLight }]}>
          <FontAwesome5 name={actionIcon as any} size={22} color={accent} />
        </View>

        <View style={styles.textBlock}>
          <Text style={styles.cardTitle}>{actionTitle}</Text>
          <Text style={styles.cardDesc}>{actionDescription}</Text>
        </View>

        <View style={[styles.chevronBox, { backgroundColor: accentLight }]}>
          <FontAwesome5 name="chevron-right" size={12} color={accent} />
        </View>

        <View style={[styles.accentBar, { backgroundColor: accent }]} />
      </Pressable>
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

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 18,
    gap: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    shadowOpacity: 0.03,
  },

  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  textBlock: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 3,
  },
  cardDesc: {
    fontSize: 13,
    fontWeight: "500",
    color: "#6B7280",
  },

  chevronBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
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
