import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSession } from "../ctx";
import { useI18n } from "../i18n/i18n-ctx";

function getGreetingKey() {
  const hour = new Date().getHours();
  if (hour < 12) return "greeting.morning";
  if (hour < 17) return "greeting.afternoon";
  return "greeting.evening";
}

function getFirstName(name: string) {
  return name?.split(" ")[0] ?? name;
}

type Props = {
  roleLabel: string;
  roleColor: string;
  roleColorLight: string;
};

export default function HomeHeader({ roleLabel, roleColor, roleColorLight }: Props) {
  const { dbUser } = useSession();
  const { t } = useI18n();
  const firstName = getFirstName(dbUser?.user_name ?? "");

  return (
    <View style={styles.header}>
      <Text style={styles.greeting}>{t(getGreetingKey())},</Text>
      <Text style={styles.name}>{firstName}</Text>

      <View style={[styles.rolePill, { backgroundColor: roleColorLight }]}>
        <View style={[styles.roleDot, { backgroundColor: roleColor }]} />
        <Text style={[styles.rolePillText, { color: roleColor }]}>{roleLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 20,
    paddingBottom: 24,
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
    marginBottom: 12,
  },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  roleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});
