import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TyreInspectionDetail } from "../../../../api/client";
import { api } from "../../../../api/client";

const LOW_TREAD_THRESHOLD_MM = 5;

const RESULT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pass: { bg: "#F0FDF4", text: "#15803D", label: "Pass" },
  monitor: { bg: "#FFFBEB", text: "#B45309", label: "Monitor" },
  reject: { bg: "#FEF2F2", text: "#DC2626", label: "Reject" },
};

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function TyreInspectionDetailScreen() {
  const { sessionId: sessionIdParam } = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = Number(sessionIdParam);

  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<TyreInspectionDetail | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(sessionId)) return;
    try {
      setLoading(true);
      const res = await api.getTyreInspectionSession(sessionId);
      setDetail(res);
    } catch (e: any) {
      Alert.alert("Failed to load", e?.message ?? "Unknown error");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Inspection not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={styles.headerCard}>
        <Text style={styles.busTitle}>Bus {detail.bus_id}</Text>
        {(detail.bus_route || detail.bus_model) && (
          <Text style={styles.headerMeta}>
            {[detail.bus_route, detail.bus_model].filter(Boolean).join(" · ")}
          </Text>
        )}
        <View style={styles.headerRow}>
          <FontAwesome5 name="calendar-alt" size={12} color="#6B7280" />
          <Text style={styles.headerRowText}>{formatDateTime(detail.inspection_datetime)}</Text>
        </View>
        <View style={styles.headerRow}>
          <FontAwesome5 name="user" size={12} color="#6B7280" />
          <Text style={styles.headerRowText}>{detail.technician_name ?? "Unknown technician"}</Text>
        </View>
        {detail.odometer_reading != null && (
          <View style={styles.headerRow}>
            <FontAwesome5 name="tachometer-alt" size={12} color="#6B7280" />
            <Text style={styles.headerRowText}>{detail.odometer_reading.toLocaleString()} km</Text>
          </View>
        )}
      </View>

      <Text style={styles.sectionLabel}>TYRES INSPECTED ({detail.tyres.length})</Text>

      {detail.tyres.length === 0 ? (
        <Text style={styles.emptyText}>No tyre readings recorded for this session.</Text>
      ) : (
        <View style={{ gap: 12 }}>
          {detail.tyres.map((t) => {
            const resultStyle = RESULT_STYLES[t.inspection_result] ?? RESULT_STYLES.pass;
            return (
              <View key={t.tyre_inspection_id} style={styles.tyreCard}>
                <View style={styles.tyreCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tyreSerial}>{t.tyre_serial_number}</Text>
                    <Text style={styles.headerMeta}>
                      {[t.tyre_brand, t.tyre_model].filter(Boolean).join(" · ") || "No details"}
                    </Text>
                  </View>
                  <View style={[styles.resultBadge, { backgroundColor: resultStyle.bg }]}>
                    <Text style={[styles.resultBadgeText, { color: resultStyle.text }]}>
                      {resultStyle.label}
                    </Text>
                  </View>
                </View>

                <View style={styles.statRow}>
                  {t.tyre_pressure != null && (
                    <View style={styles.statChip}>
                      <Text style={styles.statChipLabel}>Pressure</Text>
                      <Text style={styles.statChipValue}>{t.tyre_pressure} psi</Text>
                    </View>
                  )}
                  {t.retread_count_observed != null && (
                    <View style={styles.statChip}>
                      <Text style={styles.statChipLabel}>Retread</Text>
                      <Text style={styles.statChipValue}>×{t.retread_count_observed}</Text>
                    </View>
                  )}
                </View>

                {t.treads.length > 0 && (
                  <>
                    <Text style={styles.treadLabel}>TREAD DEPTH</Text>
                    <View style={styles.treadRow}>
                      {t.treads.map((tr) => {
                        const low = Number(tr.tread_thickness_mm) < LOW_TREAD_THRESHOLD_MM;
                        return (
                          <View
                            key={tr.tyre_tread_id}
                            style={[styles.treadChip, low && styles.treadChipLow]}
                          >
                            <Text style={styles.treadChipPos}>Groove {tr.tread_position}</Text>
                            <Text style={[styles.treadChipValue, low && { color: "#B45309" }]}>
                              {tr.tread_thickness_mm}mm
                            </Text>
                            {low && (
                              <FontAwesome5 name="exclamation-triangle" size={9} color="#B45309" />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </>
                )}

                {t.reject_reason && (
                  <View style={styles.rejectBox}>
                    <Text style={styles.rejectLabel}>Reject reason</Text>
                    <Text style={styles.rejectText}>{t.reject_reason}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB" },
  emptyText: { color: "#9CA3AF", fontWeight: "600", fontSize: 13 },

  // Shared "detail page hero" card standard — matches JobDetailsView / the
  // technician job page / the bus tyres detail page.
  headerCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 20,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  busTitle: { fontSize: 32, fontWeight: "800", color: "#111827", letterSpacing: -0.5 },
  headerMeta: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  headerRowText: { fontSize: 13, fontWeight: "600", color: "#374151" },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.8,
    marginTop: 22,
    marginBottom: 10,
  },

  tyreCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
    gap: 10,
  },
  tyreCardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  tyreSerial: { fontSize: 15, fontWeight: "800", color: "#111827" },

  resultBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  resultBadgeText: { fontSize: 11, fontWeight: "800" },

  statRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statChip: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statChipLabel: { fontSize: 9, fontWeight: "700", color: "#9CA3AF", letterSpacing: 0.3 },
  statChipValue: { fontSize: 13, fontWeight: "800", color: "#111827", marginTop: 1 },

  treadLabel: { fontSize: 10, fontWeight: "700", color: "#9CA3AF", letterSpacing: 0.5, marginTop: 2 },
  treadRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  treadChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#86EFAC",
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  treadChipLow: { backgroundColor: "#FFFBEB", borderColor: "#FBBF24" },
  treadChipPos: { fontSize: 10, fontWeight: "700", color: "#6B7280" },
  treadChipValue: { fontSize: 12, fontWeight: "800", color: "#111827" },

  rejectBox: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 10,
    padding: 10,
  },
  rejectLabel: { fontSize: 10, fontWeight: "700", color: "#991B1B", letterSpacing: 0.3 },
  rejectText: { fontSize: 13, fontWeight: "600", color: "#7F1D1D", marginTop: 2 },
});
