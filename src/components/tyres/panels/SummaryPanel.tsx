import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { TyreSummary, TyreTreadBand, TyreTreadBandKey, TyreTreadStats } from "../../../api/client";
import { api } from "../../../api/client";
import { useI18n } from "../../../i18n/i18n-ctx";
import BusIdentity from "../../BusIdentity";
import { UNEVEN_WEAR_I18N_KEY } from "../../../utils/tyreWear";
import { positionLabelFor } from "../../../utils/tyrePositions";
import { useProjectFilter } from "../../../hooks/useProjectFilter";
import { formatBusLabel } from "../../../utils/busLabel";

// Fleet tread analysis: the distribution, the statistics behind it, and the
// buses that need attention first.
//
// Every figure comes from GET /tyres/summary rather than being derived here —
// no list endpoint carries tread data, so this could not be assembled in the
// app at all.
//
// Ranked BY BUS, not by tyre: a bus is what gets taken off the road, so "which
// bus is worst" is the question being asked.
//
// A PANEL, and the only one in the section that fetches. It is also the only
// request here a technician may never need, so it is gated on `active`: the
// call does not go out until someone opens the Summary tab, and it refreshes on
// re-activation rather than on screen focus. Focus is the wrong trigger for a
// panel — a hidden panel inside a focused screen is still focused, so a
// useFocusEffect here would refetch fleet analytics every time someone came
// back from a bus while sitting on the Buses tab.

const BAND_STYLE: Record<TyreTreadBandKey, { label: string; fg: string; bg: string; strong?: boolean }> = {
  past_limit: { label: "tyres.summary.bandPastLimit", fg: "#DC2626", bg: "#FEF2F2", strong: true },
  critical: { label: "tyres.summary.bandCritical", fg: "#EA580C", bg: "#FFF7ED", strong: true },
  watch: { label: "tyres.summary.bandWatch", fg: "#B45309", bg: "#FFFBEB" },
  mid_life: { label: "tyres.summary.bandMidLife", fg: "#374151", bg: "#F9FAFB" },
  good: { label: "tyres.summary.bandGood", fg: "#16A34A", bg: "#F0FDF4" },
  near_new: { label: "tyres.summary.bandNearNew", fg: "#0891B2", bg: "#ECFEFF" },
};

function mm(v: number | null | undefined, suffix = " mm") {
  return v == null ? "—" : `${v}${suffix}`;
}

export default function SummaryPanel({ active }: { active: boolean }) {
  const projectId = useProjectFilter();
  const router = useRouter();
  const { t } = useI18n();
  const [data, setData] = useState<TyreSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getTyreSummary(projectId));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!active) return;
    load();
  }, [active, load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>{t("tyres.summary.noData")}</Text>
      </View>
    );
  }

  const bandLabel = (b: TyreTreadBand) => {
    if (b.min_mm == null) return t("tyres.summary.bandLabelAtOrBelow", { max: String(b.max_mm) });
    if (b.max_mm == null) return t("tyres.summary.bandLabelOver", { min: String(b.min_mm) });
    return t("tyres.summary.bandLabelRange", { min: String(b.min_mm), max: String(b.max_mm) });
  };

  const statColumns: { key: string; label: string; stats: TyreTreadStats }[] = [
    { key: "front", label: t("tyres.summary.statFront", { count: data.stats.front.count }), stats: data.stats.front },
    { key: "rear", label: t("tyres.summary.statRear", { count: data.stats.rear.count }), stats: data.stats.rear },
    { key: "fleet", label: t("tyres.summary.statFleet", { count: data.stats.fleet.count }), stats: data.stats.fleet },
  ];

  const statRows: { label: string; pick: (s: TyreTreadStats) => number | null; alert?: boolean }[] = [
    { label: t("tyres.summary.rowShallowest"), pick: (s) => s.shallowest, alert: true },
    { label: t("tyres.summary.rowDeepest"), pick: (s) => s.deepest },
    { label: t("tyres.summary.rowMean"), pick: (s) => s.mean },
    { label: t("tyres.summary.rowMedian"), pick: (s) => s.median },
  ];

  const hasReadings = data.measured_count > 0;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      {!hasReadings ? (
        <View style={styles.card}>
          <Text style={styles.empty}>{t("tyres.summary.noData")}</Text>
        </View>
      ) : (
        <>
          {/* ---- Band distribution ---- */}
          <Text style={styles.sectionLabel}>{t("tyres.summary.bandsTitle")}</Text>
          <Text style={styles.sectionHint}>{t("tyres.summary.bandsHint")}</Text>
          <View style={styles.card}>
            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.cell, styles.cellBand, styles.headText]}>
                {t("tyres.summary.colBand")}
              </Text>
              <Text style={[styles.cell, styles.cellNum, styles.headText]}>
                {t("tyres.summary.colFront")}
              </Text>
              <Text style={[styles.cell, styles.cellNum, styles.headText]}>
                {t("tyres.summary.colRear")}
              </Text>
              <Text style={[styles.cell, styles.cellNum, styles.headText]}>
                {t("tyres.summary.colTotal")}
              </Text>
              <Text style={[styles.cell, styles.cellPct, styles.headText]}>
                {t("tyres.summary.colPct")}
              </Text>
            </View>

            {data.bands.map((b) => {
              const style = BAND_STYLE[b.key];
              return (
                <View key={b.key} style={styles.row}>
                  <View style={styles.cellBand}>
                    <Text style={styles.bandName}>{bandLabel(b)}</Text>
                    <View style={[styles.bandPill, { backgroundColor: style.bg }]}>
                      <Text style={[styles.bandPillText, { color: style.fg }]}>
                        {t(style.label)}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.cell, styles.cellNum, styles.num]}>{b.front}</Text>
                  <Text style={[styles.cell, styles.cellNum, styles.num]}>{b.rear}</Text>
                  <Text
                    style={[
                      styles.cell,
                      styles.cellNum,
                      styles.num,
                      style.strong && b.total > 0 && { color: style.fg, fontWeight: "800" },
                    ]}
                  >
                    {b.total}
                  </Text>
                  <Text style={[styles.cell, styles.cellPct, styles.num]}>
                    {b.pct_of_fleet.toFixed(1)} %
                  </Text>
                </View>
              );
            })}

            {/* Totals, so the table reconciles against the denominator. */}
            <View style={[styles.row, styles.totalRow]}>
              <Text style={[styles.cell, styles.cellBand, styles.totalText]}>
                {t("tyres.summary.colTotal").toUpperCase()}
              </Text>
              <Text style={[styles.cell, styles.cellNum, styles.totalText]}>
                {data.stats.front.count}
              </Text>
              <Text style={[styles.cell, styles.cellNum, styles.totalText]}>
                {data.stats.rear.count}
              </Text>
              <Text style={[styles.cell, styles.cellNum, styles.totalText]}>
                {data.measured_count}
              </Text>
              <Text style={[styles.cell, styles.cellPct, styles.totalText]}>100.0 %</Text>
            </View>
          </View>

          {data.unmeasured_count > 0 && (
            <Text style={styles.caveat}>
              {t("tyres.summary.unmeasuredNote", { count: data.unmeasured_count })}
            </Text>
          )}

          {/* ---- Statistics ---- */}
          <Text style={styles.sectionLabel}>{t("tyres.summary.statsTitle")}</Text>
          <View style={styles.card}>
            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.cell, styles.cellStatLabel, styles.headText]} />
              {statColumns.map((c) => (
                <Text key={c.key} style={[styles.cell, styles.cellNum, styles.headText]}>
                  {c.label}
                </Text>
              ))}
            </View>
            {statRows.map((r) => (
              <View key={r.label} style={styles.row}>
                <Text style={[styles.cell, styles.cellStatLabel, styles.statLabel]}>{r.label}</Text>
                {statColumns.map((c) => {
                  const v = r.pick(c.stats);
                  const danger = r.alert && v != null && v < data.threshold_mm;
                  return (
                    <Text
                      key={c.key}
                      style={[
                        styles.cell,
                        styles.cellNum,
                        styles.num,
                        danger && { color: "#DC2626", fontWeight: "800" },
                      ]}
                    >
                      {mm(v)}
                    </Text>
                  );
                })}
              </View>
            ))}
          </View>

          {/* ---- Worst buses ---- */}
          <Text style={styles.sectionLabel}>{t("tyres.summary.busesTitle")}</Text>
          <Text style={styles.sectionHint}>{t("tyres.summary.busesHint")}</Text>
          <View style={styles.card}>
            {data.buses.map((bus, i) => {
              const danger = bus.shallowest_mm != null && bus.shallowest_mm < data.threshold_mm;
              // positionLabelFor already degrades gracefully on a partial
              // position, so no cast and no pre-check beyond "is it measured".
              const position =
                bus.shallowest_mm == null
                  ? "—"
                  : positionLabelFor(
                      {
                        axle_number: bus.shallowest_axle_number,
                        axle_side: bus.shallowest_axle_side,
                        wheel_position: bus.shallowest_wheel_position ?? "single",
                      },
                      "short",
                    );

              return (
                <Pressable
                  key={bus.bus_id}
                  style={styles.busRow}
                  onPress={() => router.push(`/tyres/buses/${bus.bus_id}` as any)}
                >
                  <Text style={styles.busIndex}>{i + 1}</Text>

                  <View style={{ flex: 1 }}>
                    <BusIdentity
                      busId={bus.bus_id}
                      evNumber={bus.bus_ev_no}
                      routeNumber={bus.bus_route_number}
                      route={bus.bus_route}
                      routeColour={bus.bus_route_colour}
                      size="sm"
                    />
                  </View>

                  <View style={styles.busFigures}>
                    <Text style={[styles.busShallowest, danger && { color: "#DC2626" }]}>
                      {mm(bus.shallowest_mm)}
                    </Text>
                    <Text style={styles.busMeta}>
                      {position} ·{" "}
                      {t("tyres.summary.pastLimitOf", {
                        count: bus.past_limit_count,
                        total: bus.fitted_count,
                      })}
                    </Text>
                  </View>

                  <FontAwesome5 name="chevron-right" size={12} color="#D1D5DB" />
                </Pressable>
              );
            })}
          </View>

          {/* ---- Uneven wear ---- */}
          <Text style={styles.sectionLabel}>{t("tyres.summary.unevenTitle")}</Text>
          <View style={styles.card}>
            {data.uneven_wear.length === 0 ? (
              <Text style={styles.empty}>{t("tyres.summary.noUneven")}</Text>
            ) : (
              data.uneven_wear.map((w) => (
                <Pressable
                  key={w.tyre_id}
                  style={styles.wearRow}
                  onPress={() => router.push(`/tyres/tyre/${w.tyre_id}` as any)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wearType}>{t(UNEVEN_WEAR_I18N_KEY[w.uneven_wear_type])}</Text>
                    <Text style={styles.wearMeta}>
                      {formatBusLabel(w.bus_id, w.bus_ev_no)} · {w.tyre_serial_number}
                    </Text>
                  </View>
                  <Text style={styles.wearSpread}>{mm(w.tread_spread_mm)}</Text>
                  <FontAwesome5 name="chevron-right" size={12} color="#D1D5DB" />
                </Pressable>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB" },
  empty: { color: "#9CA3AF", fontWeight: "600", fontSize: 13, padding: 4 },

  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 0.7,
    marginTop: 22,
    marginBottom: 4,
  },
  sectionHint: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", marginBottom: 8 },
  caveat: { marginTop: 8, fontSize: 11, fontWeight: "600", color: "#B45309" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    gap: 6,
  },
  headRow: { borderBottomColor: "#E5E7EB" },
  totalRow: { borderBottomWidth: 0 },

  cell: { fontSize: 12 },
  cellBand: { flex: 1, minWidth: 0 },
  cellStatLabel: { flex: 1, minWidth: 0 },
  cellNum: { width: 52, textAlign: "right" },
  cellPct: { width: 62, textAlign: "right" },

  headText: { fontSize: 10, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.3 },
  num: { fontWeight: "700", color: "#374151", textAlign: "right" },
  statLabel: { fontSize: 12, fontWeight: "700", color: "#374151" },

  bandName: { fontSize: 12, fontWeight: "700", color: "#111827" },
  bandPill: {
    alignSelf: "flex-start",
    marginTop: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  bandPillText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },

  totalText: { fontSize: 12, fontWeight: "800", color: "#111827", textAlign: "right" },

  busRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  busIndex: { width: 20, fontSize: 11, fontWeight: "700", color: "#9CA3AF" },
  busFigures: { alignItems: "flex-end" },
  busShallowest: { fontSize: 14, fontWeight: "800", color: "#111827" },
  busMeta: { fontSize: 10, fontWeight: "600", color: "#9CA3AF", marginTop: 2 },

  wearRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  wearType: { fontSize: 12, fontWeight: "800", color: "#B45309" },
  wearMeta: { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 2 },
  wearSpread: { fontSize: 13, fontWeight: "800", color: "#374151" },
});
