import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n/i18n-ctx";
import { ALL_PROJECTS, useProject } from "../project-ctx";
import { getProjectLogo } from "../utils/projectLogos";
import { useOpenProjectSelector } from "../hooks/useOpenProjectSelector";

/**
 * Which project you are looking at, and the way to change it.
 *
 * Both halves matter now that the selector is a one-time gate rather than a
 * screen people pass through: without this there is nothing on any screen saying
 * which project's data is on display, and — for four of the six roles — no way
 * back to the selector at all, since only the rm-manager and admin homes ever
 * linked to it.
 *
 * Returns to wherever it was tapped from, so switching project re-renders the
 * screen you were on instead of dumping you at a role home.
 */
export default function ProjectChip() {
  const { t } = useI18n();
  const openSelector = useOpenProjectSelector();
  const { projectId, hasChosen } = useProject();

  // Nothing to show before a choice exists — and in that state the gate is
  // already sending the user to the selector anyway.
  if (!hasChosen) return null;

  const isAll = projectId === ALL_PROJECTS;
  const logo = isAll ? null : getProjectLogo(projectId);

  return (
    <Pressable
      onPress={openSelector}
      style={({ pressed }) => [s.chip, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={t("projectChip.switch")}
    >
      {isAll ? (
        <FontAwesome5 name="globe" size={11} color="#4338CA" />
      ) : logo ? (
        <Image source={logo} style={s.logo} resizeMode="contain" />
      ) : (
        <FontAwesome5 name="folder" size={11} color="#6B7280" />
      )}

      <Text style={s.label} numberOfLines={1}>
        {isAll ? t("projectSelector.allProjectsTitle") : projectId}
      </Text>

      <View style={s.divider} />
      <Text style={s.action}>{t("projectChip.change")}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 7,
  },
  pressed: { opacity: 0.8 },
  logo: { width: 16, height: 16, borderRadius: 4 },
  label: { maxWidth: 160, fontSize: 12, fontWeight: "800", color: "#111827" },
  divider: { width: 1, height: 12, backgroundColor: "#E5E7EB" },
  action: { fontSize: 11, fontWeight: "700", color: "#6B7280" },
});
