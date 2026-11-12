import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AlertBubble from "./AlertBubble";
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
  // Drawn instead of the FontAwesome icon when given (e.g. TyreIcon).
  iconElement?: React.ReactNode;
  accent: string;
  accentLight: string;
  onPress: () => void;
  /**
   * A live count of what is waiting behind this card, e.g. "3 overdue".
   * Shown as a pill on the right. Omit or pass null when there is nothing
   * outstanding — an explicit "0" is noise, not reassurance.
   */
  badge?: string | null;
  /**
   * Give the card the accent tint and weight of the hero above it.
   *
   * For a module that is a main job rather than a side trip. Tyre management
   * was a quiet white row at the bottom of the screen, which is where it looked
   * like it belonged — but recording inspections is one of the things these
   * roles are actually here to do, and burying the only way in added a scroll
   * to the start of every one of them.
   */
  prominent?: boolean;
};

type Props = {
  roleLabel: string;
  roleIcon?: string;
  actionTitle: string;
  actionDescription: string;
  actionIcon: string;
  accent: string;
  accentLight: string;
  onPress: () => void;
  highlights?: Highlight[];
  secondaryAction?: SecondaryAction;
  // Further module cards below the secondary one (e.g. Parts Admin).
  extraActions?: SecondaryAction[];
  /**
   * Outstanding work behind the main card (pending/open reports or jobs).
   * Drawn as a red bubble on the card that stays for as long as it's > 0.
   */
  alertCount?: number;
  // Defaults to actionTitle when omitted — set this when the CTA button
  // should read differently from the card heading above it.
  ctaLabel?: string;
};

export default function RoleHomeScreen({
  roleLabel,
  roleIcon,
  actionTitle,
  actionDescription,
  actionIcon,
  accent,
  accentLight,
  onPress,
  highlights = [],
  secondaryAction,
  extraActions = [],
  alertCount = 0,
  ctaLabel,
}: Props) {
  const { t } = useI18n();

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <HomeHeader roleLabel={roleLabel} roleIcon={roleIcon} roleColor={accent} roleColorLight={accentLight} />

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
        <AlertBubble count={alertCount} size={30} style={styles.heroBubble} />

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
          <Text style={styles.ctaText}>{ctaLabel ?? actionTitle}</Text>
          <AlertBubble count={alertCount} size={22} />
          <FontAwesome5 name="arrow-right" size={13} color="#fff" />
        </Pressable>
      </View>

      {[secondaryAction, ...extraActions].map(
        (action) => action && <SecondaryCard key={action.title} action={action} />,
      )}
    </ScrollView>
  );
}

function SecondaryCard({ action }: { action: SecondaryAction }) {
  return (
    <Pressable
      onPress={action.onPress}
      style={({ pressed }) => [
        styles.secondaryCard,
        action.prominent
          ? {
              backgroundColor: action.accentLight,
              borderColor: `${action.accent}33`,
            }
          : { borderColor: "#E5E7EB" },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={[
          styles.secondaryIconBox,
          { backgroundColor: action.prominent ? "#FFFFFF" : action.accentLight },
        ]}
      >
        {action.iconElement ?? <FontAwesome5 name={action.icon as any} size={18} color={action.accent} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.secondaryTitle}>{action.title}</Text>
        <Text style={styles.secondaryDesc}>{action.description}</Text>
      </View>
      {!!action.badge && (
        <View style={[styles.secondaryBadge, { backgroundColor: action.accent }]}>
          <Text style={styles.secondaryBadgeText}>{action.badge}</Text>
        </View>
      )}
      <FontAwesome5 name="chevron-right" size={13} color="#9CA3AF" />
    </Pressable>
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

  heroBubble: { position: "absolute", top: 16, right: 16 },

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
  secondaryBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  secondaryBadgeText: { fontSize: 11, fontWeight: "800", color: "#FFFFFF" },
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
