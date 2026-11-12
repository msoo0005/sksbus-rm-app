import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../ctx";
import { useOpenProjectSelector } from "../hooks/useOpenProjectSelector";
import { useI18n } from "../i18n/i18n-ctx";
import { ALL_PROJECTS, useProject } from "../project-ctx";
import { getProjectLogo } from "../utils/projectLogos";

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
  /** FontAwesome5 icon on the role badge (see ROLE_ICONS in utils/roles). */
  roleIcon?: string;
  /** Off on the project selector, which IS the project chooser. */
  showProject?: boolean;
};

/**
 * Greeting, name and role badge on the left; the current project's logo as a
 * large tile on the right. Tapping the tile changes project. Every screen
 * below the gate is filtered by project, so the tile is not decoration — for
 * most roles it is the way back to the selector.
 */
export default function HomeHeader({
  roleLabel,
  roleColor,
  roleColorLight,
  roleIcon,
  showProject = true,
}: Props) {
  const { dbUser } = useSession();
  const { t } = useI18n();
  const firstName = getFirstName(dbUser?.user_name ?? "");

  return (
    <View style={styles.header}>
      <View style={styles.left}>
        <Text style={styles.greeting}>{t(getGreetingKey())},</Text>
        <Text style={styles.name} numberOfLines={1}>
          {firstName}
        </Text>

        <View
          style={[styles.rolePill, { backgroundColor: roleColorLight, borderColor: `${roleColor}33` }]}
        >
          {roleIcon ? (
            <View style={[styles.roleIcon, { backgroundColor: roleColor }]}>
              <FontAwesome5 name={roleIcon as any} size={13} color="#fff" />
            </View>
          ) : (
            <View style={[styles.roleDot, { backgroundColor: roleColor }]} />
          )}
          <Text style={[styles.rolePillText, { color: roleColor }]}>{roleLabel}</Text>
        </View>
      </View>

      {showProject && <ProjectTile />}
    </View>
  );
}

function ProjectTile() {
  const { t } = useI18n();
  const openSelector = useOpenProjectSelector();
  const { projectId, hasChosen } = useProject();
  if (!hasChosen) return null;

  const isAll = projectId === ALL_PROJECTS;
  const logo = isAll ? null : getProjectLogo(projectId);
  const name = isAll ? t("projectSelector.allProjectsTitle") : String(projectId ?? "");

  return (
    <Pressable
      onPress={openSelector}
      style={({ pressed }) => [styles.tileWrap, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={t("projectChip.switch")}
    >
      <View style={styles.tile}>
        {isAll ? (
          <FontAwesome5 name="globe" size={28} color="#4338CA" />
        ) : logo ? (
          <Image source={logo} style={styles.tileLogo} resizeMode="contain" />
        ) : (
          <Text style={styles.tileFallback}>{name.slice(0, 4).toUpperCase()}</Text>
        )}
      </View>
      <View style={styles.tileLabelRow}>
        <Text style={styles.tileLabel} numberOfLines={1}>
          {name}
        </Text>
        <FontAwesome5 name="chevron-down" size={10} color="#374151" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 20,
    paddingBottom: 24,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  left: { flex: 1, minWidth: 0 },
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
    gap: 9,
    paddingLeft: 6,
    paddingRight: 16,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  roleIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  roleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 6,
  },
  rolePillText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
  },

  tileWrap: { alignItems: "center", width: 92 },
  tile: {
    width: 84,
    height: 84,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  tileLogo: { width: "78%", height: "78%" },
  tileFallback: { fontSize: 16, fontWeight: "900", color: "#6B7280", letterSpacing: 0.5 },
  tileLabelRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  tileLabel: { fontSize: 13, fontWeight: "800", color: "#111827", maxWidth: 70 },
});
