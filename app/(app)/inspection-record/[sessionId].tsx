import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TyreInspectionDetail } from "@/api/client";
import { api } from "@/api/client";
import { formatDateTime } from "@/utils/datetime";
import { useI18n } from "@/i18n/i18n-ctx";
import BusIdentity from "@/components/BusIdentity";
import TyreTreadProfile from "@/components/TyreTreadProfile";
import TyreWearPill from "@/components/tyres/TyreWearPill";
import TyrePositionMap from "@/components/tyres/TyrePositionMap";


export default function TyreInspectionDetailScreen() {
  // Aliased to `tr`: the per-tyre map below already binds `t` to a tyre row, and
  // shadowing the translator inside it would be a trap waiting to be sprung.
  const { t: tr } = useI18n();
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
      Alert.alert(tr("common.failedToLoad"), e?.message ?? tr("common.unknownError"));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId, tr]);

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
        <Text style={styles.emptyText}>{tr("inspectionRecord.notFound")}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={styles.headerCard}>
        <BusIdentity
          busId={detail.bus_id}
          evNumber={detail.bus_ev_no}
          routeNumber={detail.bus_route_number}
          route={detail.bus_route}
          routeColour={detail.bus_route_colour}
          size="lg"
        />
        {!!detail.bus_model && <Text style={styles.headerMeta}>{detail.bus_model}</Text>}
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
        <Text style={styles.emptyText}>{tr("inspectionRecord.noReadings")}</Text>
      ) : (
        <View style={{ gap: 12 }}>
          {detail.tyres.map((t) => {

            return (
              <View key={t.tyre_inspection_id} style={styles.tyreCard}>
                <View style={styles.tyreCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tyreSerial}>{t.tyre_serial_number}</Text>
                    <Text style={styles.headerMeta}>
                      {[t.tyre_brand, t.tyre_model].filter(Boolean).join(" · ") || "No details"}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 8 }}>
                    {/* The wear classification, not the stored pass/monitor/
                        reject — the verdict is still derived server-side, it is
                        just not what these screens report any more. */}
                    <TyreWearPill
                      wear={t.uneven_wear_type ?? null}
                      spreadMm={t.tread_spread_mm ?? null}
                    />
                    {/* Which wheel this was. The session lists six near-identical
                        cards and the serial suffix is the only other clue. */}
                    <TyrePositionMap tyre={t} />
                  </View>
                </View>

                <View style={styles.statRow}>
                  {t.tyre_pressure != null && (
                    <View style={styles.statChip}>
                      <Text style={styles.statChipLabel}>{tr("inspectionRecord.pressure")}</Text>
                      <Text style={styles.statChipValue}>{t.tyre_pressure} psi</Text>
                    </View>
                  )}
                  {t.retread_count_observed != null && (
                    <View style={styles.statChip}>
                      <Text style={styles.statChipLabel}>{tr("inspectionRecord.retread")}</Text>
                      <Text style={styles.statChipValue}>×{t.retread_count_observed}</Text>
                    </View>
                  )}
                </View>

                {t.treads.length > 0 && (
                  <>
                    <Text style={styles.treadLabel}>{tr("inspectionRecord.treadDepth")}</Text>
                    {/* The same drawing as the capture form, so a reviewer sees
                        what the technician saw. The stored uneven_wear_type is
                        passed rather than re-derived — the verdict on file is
                        authoritative. */}
                    <TyreTreadProfile
                      readings={[...t.treads]
                        .sort((a, b) => a.tread_position - b.tread_position)
                        .map((tr) => Number(tr.tread_thickness_mm))}
                      unevenWear={t.uneven_wear_type ?? null}
                      axleSide={t.axle_side ?? null}
                    />
                  </>
                )}

                {t.sidewall_condition === "not_ok" && (
                  <View style={styles.rejectBox}>
                    <Text style={styles.rejectLabel}>{tr("inspectionRecord.sidewallNotOk")}</Text>
                    <Text style={styles.rejectText}>
                      {t.sidewall_note || tr("inspectionRecord.noDescription")}
                    </Text>
                  </View>
                )}

                {/* Since migration 014 this is written by the server to explain
                    a DERIVED verdict, not typed by the technician. */}
                {!!t.reject_reason && (
                  <View style={styles.rejectBox}>
                    <Text style={styles.rejectLabel}>
                      {t.result_source === "derived" ? tr("inspectionRecord.why") : tr("inspectionRecord.rejectReason")}
                    </Text>
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
