import { FontAwesome5 } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TyreDetail } from "@/api/client";
import { api, intakeReadings } from "@/api/client";
import ThicknessInputRow, { parseThicknessCells } from "@/components/tyres/ThicknessInputRow";
import { useSession } from "@/ctx";
import { isRetreadEndOfLife, retreadLabel } from "@/components/RetreadCountSelector";
import RouteBadge from "@/components/RouteBadge";
import TyreTreadProfile from "@/components/TyreTreadProfile";
import TyreWearPill from "@/components/tyres/TyreWearPill";
import TyreStatusPill from "@/components/tyres/TyreStatusPill";
import TyrePositionMap from "@/components/tyres/TyrePositionMap";
import { useI18n } from "@/i18n/i18n-ctx";
import { formatDate, formatDateTime } from "@/utils/datetime";
import { detailLine, formatReading } from "@/utils/tyreFormat";
import { positionLabelFor } from "@/utils/tyrePositions";
import { formatBusLabel } from "@/utils/busLabel";

// A single tyre's life: where it is now, every bus it has been fitted to, and
// every inspection it has been through.
//
// Before this screen a serial number was a leaf — visible in four different
// lists and drillable from none of them. It reads the existing GET /tyres/{id},
// which has always returned mounting_history and inspection_history.


export default function TyreDetailScreen() {
  const { tyreId: tyreIdParam } = useLocalSearchParams<{ tyreId: string }>();
  const tyreId = Number(tyreIdParam);
  const router = useRouter();
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [tyre, setTyre] = useState<TyreDetail | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(tyreId)) return;
    try {
      setTyre(await api.getTyre(tyreId));
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [tyreId, t]);

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

  if (!tyre) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>{t("tyres.detail.notFound")}</Text>
      </View>
    );
  }

  const mounted = !!tyre.current_bus_id;

  // inspection_history comes back newest-first, so the first entry carrying
  // groove readings is this tyre's current condition. An inspection can exist
  // without readings (a sidewall-only check), hence the find rather than [0].
  const latest = tyre.inspection_history.find(
    (h) => !!h.tread_readings && h.tread_readings.trim() !== "",
  );
  const latestReadings = latest?.tread_readings
    ? latest.tread_readings.split(",").map((v) => Number(v.trim())).filter((n) => Number.isFinite(n))
    : [];

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* The serial, once loaded — the layout's static "Tyre Details" is only
          the fallback shown while the record is still arriving. */}
      <Stack.Screen options={{ title: tyre.tyre_serial_number }} />

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.serial}>{tyre.tyre_serial_number}</Text>
            <Text style={styles.meta}>
              {detailLine([
                [tyre.tyre_brand, tyre.tyre_model].filter(Boolean).join(" ") || null,
                t("tyres.detail.grooves", { count: tyre.tyre_tread_count || 4 }),
                t("tyres.detail.retreadTimes", {
                  count: retreadLabel(tyre.tyre_retread_count),
                }),
              ])}
            </Text>
            {isRetreadEndOfLife(tyre.tyre_retread_count) && (
              <Text style={styles.eolNote}>{t("tyres.detail.endOfLife")}</Text>
            )}
            {!!tyre.tyre_bought_date && (
              <Text style={styles.meta}>
                {t("tyres.detail.boughtOn", { date: formatDate(tyre.tyre_bought_date) })}
              </Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end", gap: 8 }}>
            <TyreStatusPill status={tyre.tyre_status} />
            {/* Where it is fitted. Renders nothing for a spare, which is on no
                wheel — the status pill above already says so. */}
            <TyrePositionMap tyre={tyre} />
          </View>
        </View>
      </View>

      <Text style={styles.sectionLabel}>{t("tyres.detail.treadAndWear")}</Text>
      <View style={styles.card}>
        {latestReadings.length === 0 ? (
          <Text style={styles.empty}>{t("tyres.detail.noReadings")}</Text>
        ) : (
          <>
            {/* The stored verdict is passed rather than re-derived — what was
                concluded at inspection time is what should be shown. */}
            <TyreTreadProfile
              readings={latestReadings}
              unevenWear={latest?.uneven_wear_type ?? null}
              axleSide={tyre.axle_side ?? null}
            />
            <Text style={styles.treadMeta}>
              {detailLine([
                latest?.inspection_datetime
                  ? t("tyres.detail.measuredOn", { date: formatDate(latest.inspection_datetime) })
                  : null,
                latest?.bus_id ?? null,
                latest?.min_tread_mm != null
                  ? t("tyres.detail.shallowestGroove", {
                      mm: formatReading(latest.min_tread_mm).replace("mm", ""),
                    })
                  : null,
                latest?.uneven_wear_type
                  ? latest.tread_spread_mm != null
                    ? t("tyres.detail.spreadOf", { mm: String(latest.tread_spread_mm) })
                    : null
                  : t("tyres.detail.evenWear"),
              ])}
            </Text>
          </>
        )}
        {/* Tyres are only inspected while on a bus; a spare's readings are
            taken when it is added to stock and again when it is fitted. */}
        {!mounted && <Text style={styles.spareNote}>{t("tyres.detail.inspectOnlyWhenFitted")}</Text>}
      </View>

      <IntakeCard tyre={tyre} onSaved={load} />

      <Text style={styles.sectionLabel}>{t("tyres.detail.fittedTo")}</Text>
      <View style={styles.card}>
        {mounted ? (
          /* Deliberately not a link. This card names the bus and the wheel; it
             does not navigate there. Tapping through used to land on the bus's
             replacement screen, whose own diagram led straight back to another
             tyre record — the one cycle in this section, and the reason it was
             impossible to tell how deep you were. Work on a bus starts from the
             bus list. */
          <View style={styles.fittedRow}>
            <View style={styles.busIcon}>
              <FontAwesome5 name="bus" size={14} color="#111827" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{formatBusLabel(tyre.current_bus_id, tyre.current_bus_ev_no)}</Text>
              <RouteBadge
                colour={tyre.current_bus_route_colour}
                number={tyre.current_bus_route_number}
                route={tyre.current_bus_route}
              />
              <Text style={styles.meta}>
                {detailLine([
                  positionLabelFor(tyre),
                  tyre.current_bus_model,
                  t("tyres.detail.fittedOn", { date: formatDate(tyre.mounted_at) }),
                ])}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.empty}>{t("tyres.detail.inStock")}</Text>
        )}
      </View>

      <Text style={styles.sectionLabel}>{t("tyres.detail.mountingHistory")}</Text>
      <View style={styles.card}>
        {tyre.mounting_history.length === 0 ? (
          <Text style={styles.empty}>{t("tyres.detail.noMountings")}</Text>
        ) : (
          tyre.mounting_history.map((m) => (
            <View key={m.tyre_mounting_id} style={styles.historyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{formatBusLabel(m.bus_id, m.bus_ev_no)}</Text>
                <Text style={styles.meta}>
                  {detailLine([
                    positionLabelFor(m),
                    t("tyres.detail.fittedOn", { date: formatDate(m.mounted_at) }),
                    m.unmounted_at
                      ? t("tyres.detail.removedOn", { date: formatDate(m.unmounted_at) })
                      : t("tyres.detail.stillFitted"),
                  ])}
                </Text>
                {!!m.unmount_reason && <Text style={styles.meta}>{m.unmount_reason}</Text>}
              </View>
            </View>
          ))
        )}
      </View>

      <Text style={styles.sectionLabel}>{t("tyres.detail.inspectionHistory")}</Text>
      <View style={styles.card}>
        {tyre.inspection_history.length === 0 ? (
          <Text style={styles.empty}>{t("tyres.detail.noInspections")}</Text>
        ) : (
          tyre.inspection_history.map((h) => {
            return (
              <Pressable
                key={h.tyre_inspection_id}
                style={styles.historyRow}
                onPress={() => router.push(`/inspection-record/${h.session_id}` as any)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{formatDateTime(h.inspection_datetime)}</Text>
                  <RouteBadge
                    colour={h.bus_route_colour}
                    number={h.bus_route_number}
                    route={h.bus_route}
                    variant="compact"
                  />
                  <Text style={styles.meta}>
                    {detailLine([
                      h.bus_id,
                      h.min_tread_mm != null
                        ? t("tyres.detail.minTread", { mm: formatReading(h.min_tread_mm).replace("mm", "") })
                        : null,
                      h.sidewall_condition
                        ? h.sidewall_condition === "ok"
                          ? "Sidewall OK"
                          : "Sidewall NC"
                        : null,
                    ])}
                  </Text>
                </View>
                <TyreWearPill
                  wear={h.uneven_wear_type ?? null}
                  spreadMm={h.tread_spread_mm ?? null}
                  size="sm"
                />
                <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

// The readings taken when the tyre was added to stock. Admins and R&M can
// correct a mistyped reading here.
function IntakeCard({ tyre, onSaved }: { tyre: TyreDetail; onSaved: () => Promise<void> | void }) {
  const { t } = useI18n();
  const { dbUser } = useSession() as any;
  const canEdit = ["admin", "rm_manager"].includes(String(dbUser?.user_role ?? ""));
  const readings = intakeReadings(tyre);
  const count = tyre.tyre_tread_count || 4;
  const [editing, setEditing] = useState(false);
  const [cells, setCells] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setCells(readings ? readings.map(String) : Array.from({ length: count }, () => ""));
    setEditing(true);
  };

  const save = async () => {
    const parsed = parseThicknessCells(cells);
    if (!parsed || parsed.length !== count) {
      Alert.alert(t("common.validation"), t("tyres.addTyre.thicknessRequired", { count }));
      return;
    }
    setSaving(true);
    try {
      await api.updateTyre(tyre.tyre_id, { intake_thickness: parsed });
      setEditing(false);
      await onSaved();
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <View style={styles.intakeHead}>
        <Text style={[styles.sectionLabel, { marginTop: 0, marginBottom: 0 }]}>{t("tyres.detail.intakeTitle")}</Text>
        {canEdit && !editing && (
          <Pressable onPress={startEdit} hitSlop={8}>
            <Text style={styles.intakeEdit}>{readings ? t("tyres.detail.intakeEdit") : t("tyres.detail.intakeAdd")}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.card}>
        {editing ? (
          <>
            <ThicknessInputRow values={cells} onChange={setCells} editable={!saving} showGrooveLabels />
            <View style={styles.intakeButtons}>
              <Pressable style={styles.intakeCancel} onPress={() => setEditing(false)} disabled={saving}>
                <Text style={styles.intakeCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable style={styles.intakeSave} onPress={save} disabled={saving}>
                <Text style={styles.intakeSaveText}>{saving ? t("common.saving") : t("common.save")}</Text>
              </Pressable>
            </View>
          </>
        ) : readings ? (
          <>
            <TyreTreadProfile readings={readings} showUnevenWear={false} />
            <Text style={styles.treadMeta}>
              {detailLine([
                readings.map((n) => `${n}`).join(" / ") + " mm",
                tyre.intake_measured_at
                  ? t("tyres.detail.measuredOn", { date: formatDate(tyre.intake_measured_at) })
                  : null,
              ])}
            </Text>
          </>
        ) : (
          <Text style={styles.empty}>{t("tyres.detail.intakeNone")}</Text>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  spareNote: { marginTop: 10, fontSize: 12, color: "#1D4ED8", backgroundColor: "#EFF6FF", padding: 8, borderRadius: 8 },
  intakeHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 8 },
  intakeEdit: { fontSize: 13, fontWeight: "700", color: "#2563EB" },
  intakeButtons: { flexDirection: "row", gap: 10, marginTop: 12 },
  intakeCancel: { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  intakeCancelText: { fontWeight: "700", color: "#111827" },
  intakeSave: { flex: 1, height: 42, borderRadius: 10, backgroundColor: "#111827", alignItems: "center", justifyContent: "center" },
  intakeSaveText: { fontWeight: "800", color: "#fff" },
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB" },

  hero: {
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
  },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  serial: { fontSize: 20, fontWeight: "800", color: "#111827" },
  meta: { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 4 },
  treadMeta: { marginTop: 10, fontSize: 11, fontWeight: "600", color: "#6B7280" },
  eolNote: { marginTop: 5, fontSize: 11, fontWeight: "800", color: "#DC2626" },

  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 0.6,
    marginTop: 24,
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
  },
  fittedRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  busIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  rowTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  empty: { textAlign: "center", paddingVertical: 20, color: "#9CA3AF", fontWeight: "600", fontSize: 12 },
});
