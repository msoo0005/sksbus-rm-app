import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import HomeHeader from "./HomeHeader";
import { useI18n } from "../i18n/i18n-ctx";

type Highlight = {
  icon: string;
  label: string;
};

type SecondaryAction = {
  title: string;
  description: string;
  icon: string;
  accent: string;
  accentLight: string;
  onPress: () => void;
};

type Props = {
  roleLabel: string;
  actionTitle: string;
  actionDescription: string;
  actionIcon: string;
  accent: string;
  accentLight: string;
  onPress: () => void;
  highlights?: Highlight[];
  secondaryAction?: SecondaryAction;
};

export default function RoleHomeScreen({
  roleLabel,
  actionTitle,
  actionDescription,
  actionIcon,
  accent,
  accentLight,
  onPress,
  highlights = [],
  secondaryAction,
}: Props) {
  const { t } = useI18n();

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <HomeHeader roleLabel={roleLabel} roleColor={accent} roleColorLight={accentLight} />

      <Text style={styles.sectionLabel}>{t("roleHome.getStarted")}</Text>

      <View
        style={[
          styles.heroCard,
          { backgroundColor: accentLight, borderColor: `${accent}33` },
        ]}
      >
        <View style={styles.iconBox}>
          <FontAwesome5 name={actionIcon as any} size={24} color={accent} />
        </View>

        <Text style={styles.heroTitle}>{actionTitle}</Text>
        <Text style={styles.heroDesc}>{actionDescription}</Text>

        {highlights.length > 0 && (
          <View style={styles.highlights}>
            {highlights.map((h) => (
              <View key={h.label} style={styles.highlightRow}>
                <View style={styles.highlightIcon}>
                  <FontAwesome5 name={h.icon as any} size={11} color={accent} />
                </View>
                <Text style={styles.highlightText}>{h.label}</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable
          onPress={onPress}
          style={({ pressed }) => [
            styles.ctaButton,
            { backgroundColor: accent },
            pressed && styles.ctaPressed,
          ]}
        >
          <Text style={styles.ctaText}>{actionTitle}</Text>
          <FontAwesome5 name="arrow-right" size={13} color="#fff" />
        </Pressable>
      </View>

      {secondaryAction && (
        <Pressable
          onPress={secondaryAction.onPress}
          style={({ pressed }) => [
            styles.secondaryCard,
            { borderColor: "#E5E7EB" },
            pressed && { opacity: 0.85 },
          ]}
        >
          <View
            style={[
              styles.secondaryIconBox,
              { backgroundColor: secondaryAction.accentLight },
            ]}
          >
            <FontAwesome5
              name={secondaryAction.icon as any}
              size={18}
              color={secondaryAction.accent}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.secondaryTitle}>{secondaryAction.title}</Text>
            <Text style={styles.secondaryDesc}>{secondaryAction.description}</Text>
          </View>
          <FontAwesome5 name="chevron-right" size={13} color="#9CA3AF" />
        </Pressable>
      )}
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
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 20,
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

  heroCard: {
    borderRadius: 26,
    borderWidth: 1.5,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },

  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    backgroundColor: "#FFFFFF",
  },

  heroTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  heroDesc: {
    fontSize: 14,
    fontWeight: "500",
    color: "#4B5563",
    lineHeight: 20,
  },

  highlights: {
    marginTop: 20,
  },
  highlightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: "rgba(17, 24, 39, 0.08)",
  },
  highlightIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  highlightText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },

  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    borderRadius: 16,
    marginTop: 22,
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },

  secondaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  secondaryIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  secondaryDesc: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6B7280",
    marginTop: 2,
  },
});
