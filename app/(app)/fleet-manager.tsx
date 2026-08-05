import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useI18n } from "../i18n/i18n-ctx";

type ReportType = "problem" | "repair" | "accident";

function buildActions(t: (key: string) => string) {
  return [
    {
      id: "report-problem",
      title: t("fleetManagerActions.reportProblemTitle"),
      description: t("fleetManagerActions.reportProblemDesc"),
      icon: "exclamation-triangle",
      accent: "#DC2626",
      accentLight: "#FEF2F2",
      formType: "problem" as ReportType,
    },
    {
      id: "request-repair",
      title: t("fleetManagerActions.requestRepairTitle"),
      description: t("fleetManagerActions.requestRepairDesc"),
      icon: "wrench",
      accent: "#2563EB",
      accentLight: "#EFF6FF",
      formType: "repair" as ReportType,
    },
    {
      id: "report-accident",
      title: t("fleetManagerActions.reportAccidentTitle"),
      description: t("fleetManagerActions.reportAccidentDesc"),
      icon: "car-crash",
      accent: "#EA580C",
      accentLight: "#FFF7ED",
      formType: "accident" as ReportType,
    },
    {
      id: "my-report-history",
      title: t("fleetManagerActions.myReportHistoryTitle"),
      description: t("fleetManagerActions.myReportHistoryDesc"),
      icon: "history",
      accent: "#374151",
      accentLight: "#F3F4F6",
      formType: "problem" as ReportType,
    },
  ];
}

export default function FleetManagerScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const ACTIONS = useMemo(() => buildActions(t), [t]);

  const handlePress = (action: (typeof ACTIONS)[0]) => {
    if (action.id === "my-report-history") {
      router.push("./fleet-manager-history");
      return;
    }
    router.push({ pathname: "./form", params: { type: action.formType } });
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.sectionLabel}>{t("fleetManagerActions.selectAnAction")}</Text>

      {ACTIONS.map((action) => (
        <Pressable
          key={action.id}
          onPress={() => handlePress(action)}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
          {() => (
            <>
              <View
                style={[
                  styles.iconBox,
                  { backgroundColor: action.accentLight },
                ]}
              >
                <FontAwesome5
                  name={action.icon as any}
                  size={22}
                  color={action.accent}
                />
              </View>

              <View style={styles.textBlock}>
                <Text style={styles.cardTitle}>{action.title}</Text>
                <Text style={styles.cardDesc}>{action.description}</Text>
              </View>

              <View
                style={[
                  styles.chevronBox,
                  { backgroundColor: action.accentLight },
                ]}
              >
                <FontAwesome5
                  name="chevron-right"
                  size={12}
                  color={action.accent}
                />
              </View>

              {/* Accent bar */}
              <View
                style={[styles.accentBar, { backgroundColor: action.accent }]}
              />
            </>
          )}
        </Pressable>
      ))}
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
    paddingTop: 20,
    paddingBottom: 32,
    gap: 14,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    marginBottom: 4,
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
