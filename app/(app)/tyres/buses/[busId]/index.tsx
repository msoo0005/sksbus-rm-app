import { FontAwesome5 } from "@expo/vector-icons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  LowTreadTyre,
  Tyre,
  TyreInspectionDetail,
  TyreInspectionSession,
  TyreSwapRecord,
} from "@/api/client";
import { api } from "@/api/client";
import BusIdentity from "@/components/BusIdentity";
import ImageViewerOverlay from "@/components/ImageViewerOverlay";
import { retreadSuffix } from "@/components/RetreadCountSelector";
import SegmentedTabs from "@/components/SegmentedTabs";
import ShowAllRow from "@/components/ShowAllRow";
import TyreReplacementModal from "@/components/TyreReplacementModal";
import TyreTreadProfile from "@/components/TyreTreadProfile";
import CollapsibleSection from "@/components/CollapsibleSection";
import BusTyreDiagramCard from "@/components/tyres/BusTyreDiagramCard";
import InspectionDueBadge, {
  inspectionDueState,
} from "@/components/tyres/InspectionDueBadge";
import { useBusDirectory } from "@/hooks/useBusDirectory";
import { formatDraftAge, peekDraft } from "@/hooks/useFormDraft";
import { usePreviewList } from "@/hooks/usePreviewList";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useI18n } from "@/i18n/i18n-ctx";
import { daysSince, formatDate, formatDateTime } from "@/utils/datetime";
import { detailLine } from "@/utils/tyreFormat";
import {
  ALL_POSITIONS,
  indexTyresByPosition,
  positionKey,
  positionLabelFor,
  type TyrePosition,
} from "@/utils/tyrePositions";

// Everything about one bus's tyres in one place: what is fitted, what the last
// inspection found, and both ways of acting on it — record an inspection, or
// swap a tyre out.
//
// This is the merge of what used to be two near-identical screens, one per
// task. Splitting them meant choosing "am I inspecting or replacing?" BEFORE
// choosing a bus, which is backwards — you walk up to a bus and then find out
// what it needs. It also meant the same bus appeared at two URLs, which is what
// let the navigation graph form a cycle.
//
// Capture still lives on its own /inspect route rather than as a mode here. The
// form's usePreventRemove guard fires whenever it is dirty, which as an in-place
// mode would trigger while someone is merely reading history. Keeping it
// separate also means submitting can router.back() to this screen, which
// refetches on focus — so the inspection you just filed appears at the top of
// the list you were looking at.

const PREVIEW_SESSIONS = 3;

type HistoryTab = "inspections" | "replacements";

export default function BusTyresScreen() {
  // `position` lets the tyre stock list deep-link straight to the wheel a tyre
  // is on, so tapping a fitted tyre lands with it already selected.
  const { busId: busIdParam, position } = useLocalSearchParams<{
    busId: string;
    position?: string;
  }>();
  const busId = String(busIdParam ?? "");
  const router = useRouter();
  const { t } = useI18n();
  const { byId } = useBusDirectory();
  const projectId = useProjectFilter();

  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState<Tyre[]>([]);
  const [sessions, setSessions] = useState<TyreInspectionSession[]>([]);
  const [latest, setLatest] = useState<TyreInspectionDetail | null>(null);
  const [swaps, setSwaps] = useState<TyreSwapRecord[]>([]);
  const [spares, setSpares] = useState<Tyre[]>([]);
  const [lowTread, setLowTread] = useState<LowTreadTyre[]>([]);
  const [intervalDays, setIntervalDays] = useState(30);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);

  const [selectedKey, setSelectedKey] = useState<string | null>(position ?? null);
  const [historyTab, setHistoryTab] = useState<HistoryTab>("inspections");

  const [replaceVisible, setReplaceVisible] = useState(false);
  const [replacePosition, setReplacePosition] = useState<TyrePosition | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const load = useCallback(async () => {
    if (!busId) return;
    try {
      const [tyreRows, sessionRows, settings, swapRows, spareRows, lowTreadRes] =
        await Promise.all([
          api.listBusTyres(busId).catch(() => []),
          api.listBusTyreInspections(busId).catch(() => []),
          api.getTyreSettings().catch(() => null),
          api.listBusTyreSwaps(busId).catch(() => []),
          api.listTyres({ unmounted: true }).catch(() => []),
          api.getLowTreadTyres(projectId).catch(() => null),
        ]);

      setMounted(Array.isArray(tyreRows) ? tyreRows : []);
      const list = Array.isArray(sessionRows) ? sessionRows : [];
      setSessions(list);
      setSwaps(Array.isArray(swapRows) ? swapRows : []);
      // 'retreading' tyres count as fittable stock: a tyre sent away for
      // retreading is expected to come back and go on a bus again.
      setSpares(
        Array.isArray(spareRows)
          ? spareRows.filter((x) => x.tyre_status === "spare" || x.tyre_status === "retreading")
          : [],
      );
      setLowTread(lowTreadRes?.low_tread_tyres ?? []);
      if (settings) setIntervalDays(settings.inspection_interval_days ?? 30);

      // The most recent session's readings power the per-wheel detail panel
      // below, so the diagram can answer "what did we find last time?".
      if (list.length) {
        const detail = await api
          .getTyreInspectionSession(list[0].tyre_inspection_session_id)
          .catch(() => null);
        setLatest(detail);
      } else {
        setLatest(null);
      }

      setDraftSavedAt(await peekDraft(`tyre-inspection:${busId}`));
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [busId, t, projectId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const bus = byId.get(busId);
  const tyreAtPosition = useMemo(() => indexTyresByPosition(mounted), [mounted]);
  const lowTreadIds = useMemo(() => new Set(lowTread.map((x) => x.tyre_id)), [lowTread]);

  const lastInspectedAt = sessions.length ? sessions[0].inspection_datetime : null;
  const due = inspectionDueState(daysSince(lastInspectedAt), intervalDays);
  const preview = usePreviewList(sessions, PREVIEW_SESSIONS);
  const hasTyres = mounted.length > 0;

  // "Since last tyre change" — the most recent mount across every current
  // position on this bus, shown as a progress bar toward the same interval
  // used for periodic inspections (APP_SETTING.tyre_inspection_interval_days).
  const lastChangeAt = useMemo(() => {
    const dates = mounted.map((x) => x.mounted_at).filter(Boolean) as string[];
    if (!dates.length) return null;
    return dates.reduce((newest, d) => (d > newest ? d : newest));
  }, [mounted]);
  const daysSinceChange = daysSince(lastChangeAt);

  // The one mounted tyre (if any) this bus's low-tread scan has flagged —
  // drives the single "UPDATE" call-to-action below the diagram.
  const flaggedTyre = useMemo(
    () => mounted.find((x) => lowTreadIds.has(x.tyre_id)) ?? null,
    [mounted, lowTreadIds],
  );
  const flaggedPosition = useMemo<TyrePosition | null>(() => {
    if (!flaggedTyre) return null;
    return (
      ALL_POSITIONS.find(
        (p) =>
          p.axle_number === flaggedTyre.axle_number &&
          p.axle_side === flaggedTyre.axle_side &&
          p.wheel_position === flaggedTyre.wheel_position,
      ) ?? null
    );
  }, [flaggedTyre]);

  // Resolved from ALL_POSITIONS rather than from what is fitted, so an EMPTY
  // wheel can be selected too — that is how "fit a tyre here" is reached.
  const selectedPosition = useMemo<TyrePosition | null>(
    () => ALL_POSITIONS.find((p) => positionKey(p) === selectedKey) ?? null,
    [selectedKey],
  );
  const selectedTyre = selectedPosition
    ? tyreAtPosition.get(positionKey(selectedPosition)) ?? null
    : null;

  // What the selected wheel measured at the last inspection. Null when that
  // tyre was not part of it — a tyre fitted since then has nothing to draw, and
  // drawing the wheel's PREVIOUS occupant there would be worse than drawing
  // nothing.
  const selectedReadings = useMemo(() => {
    if (!selectedTyre || !latest) return null;
    const entry = latest.tyres.find((x) => x.tyre_id === selectedTyre.tyre_id);
    if (!entry) return null;
    return {
      // Ordered numbers, not a joined string — the tread diagram draws these.
      treads: [...entry.treads]
        .sort((a, b) => a.tread_position - b.tread_position)
        .map((x) => Number(x.tread_thickness_mm)),
      sidewall: entry.sidewall_condition,
      sidewallNote: entry.sidewall_note ?? null,
      unevenWear: entry.uneven_wear_type ?? null,
      when: latest.inspection_datetime,
    };
  }, [selectedTyre, latest]);

  const swapPhotoUrls = useMemo(
    () =>
      swaps
        .filter((s) => s.install_photo_view_url)
        .map((s) => ({ url: s.install_photo_view_url as string })),
    [swaps],
  );

  const openSwapPhoto = (swap: TyreSwapRecord) => {
    if (!swap.install_photo_view_url) return;
    const idx = swapPhotoUrls.findIndex((u) => u.url === swap.install_photo_view_url);
    setViewerIndex(Math.max(0, idx));
    setViewerVisible(true);
  };

  const openReplace = (p: TyrePosition) => {
    setReplacePosition(p);
    setReplaceVisible(true);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* Name the screen after the bus. Every title in this app is a static
          string from the layout, so three levels in you saw "Bus Tyres" with
          nothing saying which bus — half of "I lose track of where I am". */}
      <Stack.Screen options={{ title: busId }} />

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <BusIdentity
              busId={busId}
              evNumber={bus?.bus_ev_no}
              routeNumber={bus?.bus_route_number}
              route={bus?.bus_route}
              routeColour={bus?.bus_route_colour}
            />
            <Text style={styles.meta}>{detailLine([bus?.bus_model, bus?.project_id])}</Text>
          </View>
          <InspectionDueBadge state={due} />
        </View>
        {/* Both ages on one line. The tyre-change age used to be a progress
            bar filling toward the INSPECTION interval and turning red at 100% —
            but there is no rule that a tyre must be changed every 30 days, so
            the bar invented a red state that meant nothing. A red state that
            means nothing is exactly why "what needs attention" was hard to
            read here. The fact is kept; the false threshold is not. */}
        <Text style={styles.meta}>
          {detailLine([
            sessions.length
              ? t("tyres.inspections.lastInspectedBy", {
                  when: formatDateTime(lastInspectedAt),
                  who: sessions[0].technician_name ?? "—",
                })
              : t("tyres.bus.noHistory"),
            sessions.length && sessions[0].odometer_reading != null
              ? t("tyres.bus.odometerKm", { km: sessions[0].odometer_reading.toLocaleString() })
              : null,
            daysSinceChange != null
              ? t("tyres.replacements.sinceChange", { days: daysSinceChange })
              : t("tyres.replacements.noChangeYet"),
          ])}
        </Text>
      </View>

      {/* The single most urgent control on the page, so it sits directly under
          the identity rather than below the diagram where it used to live —
          fifth in the stack and off the bottom of most phones. */}
      {flaggedTyre && flaggedPosition && (
        <Pressable style={styles.updateBtn} onPress={() => openReplace(flaggedPosition)}>
          <FontAwesome5 name="exclamation-triangle" size={13} color="#fff" />
          <Text style={styles.updateBtnText}>
            {t("tyres.replacements.needsChanging", { serial: flaggedTyre.tyre_serial_number })}
          </Text>
        </Pressable>
      )}

      {/* An inspection records a reading per fitted tyre, so a bus with nothing
          mounted has nothing to inspect. The capture form already refused to
          submit in that case, but only after the technician had walked to the
          bus and opened it — the refusal belongs here, on the way in. */}
      <Pressable
        style={[styles.cta, !!draftSavedAt && styles.ctaResume, !hasTyres && styles.ctaDisabled]}
        disabled={!hasTyres}
        onPress={() => router.push(`/tyres/buses/${busId}/inspect` as any)}
      >
        <FontAwesome5
          name={!hasTyres ? "ban" : draftSavedAt ? "history" : "clipboard-check"}
          size={14}
          color={!hasTyres ? "#9CA3AF" : draftSavedAt ? "#1E3A8A" : "#fff"}
        />
        <Text
          style={[
            styles.ctaText,
            !!draftSavedAt && styles.ctaTextResume,
            !hasTyres && styles.ctaTextDisabled,
          ]}
        >
          {!hasTyres
            ? t("tyres.bus.noTyresToInspect")
            : draftSavedAt
              ? t("tyres.bus.resumeInspection", { when: formatDraftAge(draftSavedAt) })
              : t("tyres.bus.startInspection")}
        </Text>
      </Pressable>
      {!hasTyres && <Text style={styles.ctaHint}>{t("tyres.bus.noTyresToInspectHint")}</Text>}

      <BusTyreDiagramCard
        label={t("tyres.bus.wheelLayout")}
        hint={t("tyres.bus.wheelHintCombined")}
        tyreAt={(p: TyrePosition) => tyreAtPosition.get(positionKey(p))}
        flaggedTyreIds={lowTreadIds}
        selectedKey={selectedKey}
        onSelect={(p) => setSelectedKey((k) => (k === positionKey(p) ? null : positionKey(p)))}
      />

      {!!selectedPosition && (
        <View
          style={[
            styles.detailCard,
            selectedTyre && lowTreadIds.has(selectedTyre.tyre_id) && styles.detailCardFlagged,
          ]}
        >
          <Text style={styles.detailKicker}>{t("tyres.replacements.selectedWheel")}</Text>
          <Text style={styles.detailPosition}>{selectedPosition.label.toUpperCase()}</Text>

          {selectedTyre ? (
            <>
              <Text style={styles.detailSerial}>{selectedTyre.tyre_serial_number}</Text>
              <Text style={styles.detailMeta}>
                {[selectedTyre.tyre_brand, selectedTyre.tyre_model].filter(Boolean).join(" ") ||
                  t("tyres.replacements.noModel")}
                {" · "}
                {t("tyres.detail.grooves", { count: selectedTyre.tyre_tread_count || 4 })}
                {selectedTyre.tyre_retread_count > 0
                  ? retreadSuffix(selectedTyre.tyre_retread_count)
                  : ""}
              </Text>
              <Text style={styles.detailMeta}>
                {t("tyres.detail.fittedOn", { date: formatDate(selectedTyre.mounted_at) })}
              </Text>

              {/* The tread as last measured, drawn rather than listed, so the
                  decision to swap is made against the shape of the wear and not
                  just the "below threshold" flag underneath. */}
              {selectedReadings ? (
                <>
                  <Text style={styles.detailReadingsLabel}>
                    {t("tyres.replacements.lastMeasured", {
                      when: formatDateTime(selectedReadings.when),
                    })}
                  </Text>
                  <TyreTreadProfile
                    readings={selectedReadings.treads}
                    unevenWear={selectedReadings.unevenWear}
                    axleSide={selectedPosition.axle_side ?? null}
                  />
                  {selectedReadings.sidewall === "not_ok" && (
                    <Text style={styles.sidewallNote}>
                      {t("tyres.inspectionForm.sidewallNc")}
                      {selectedReadings.sidewallNote ? ` — ${selectedReadings.sidewallNote}` : ""}
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.detailMeta}>{t("tyres.replacements.noReadingsYet")}</Text>
              )}

              {lowTreadIds.has(selectedTyre.tyre_id) && (
                <View style={styles.detailWarnRow}>
                  <FontAwesome5 name="exclamation-triangle" size={11} color="#B45309" />
                  <Text style={styles.detailWarnText}>
                    {t("tyres.replacements.belowThreshold")}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <Text style={styles.detailMeta}>{t("tyres.replacements.noTyreHere")}</Text>
          )}

          <Pressable style={styles.detailBtn} onPress={() => openReplace(selectedPosition)}>
            <FontAwesome5 name={selectedTyre ? "exchange-alt" : "plus"} size={12} color="#fff" />
            <Text style={styles.detailBtnText}>
              {selectedTyre ? t("tyres.replacements.replaceThis") : t("tyres.replacements.fitHere")}
            </Text>
          </Pressable>

          {!!selectedTyre && (
            <Pressable
              style={styles.linkBtn}
              onPress={() => router.push(`/tyres/tyre/${selectedTyre.tyre_id}` as any)}
            >
              <Text style={styles.linkText}>{t("tyres.bus.viewTyreHistory")} →</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Closed by default. Two histories, tabbed rather than stacked — they
          answer the same question ("what has been done to this bus?") and
          stacking them buried the second under whichever was longer. Collapsed
          they still declare how much there is, so nothing becomes invisible;
          they just stop pushing the diagram off the screen.

          The swap list is still fetched up front rather than on first open,
          because the closed header has to state its count. */}
      <CollapsibleSection
        label={t("tyres.bus.historyTitle")}
        meta={t("tyres.bus.historyCount", {
          inspections: sessions.length,
          swaps: swaps.length,
        })}
      >
      <SegmentedTabs<HistoryTab>
        value={historyTab}
        onChange={setHistoryTab}
        tabs={[
          {
            key: "inspections",
            label: t("tyres.bus.tabInspections"),
            icon: "clipboard-check",
          },
          {
            key: "replacements",
            label: t("tyres.bus.tabReplacements"),
            icon: "exchange-alt",
          },
        ]}
      />

      {historyTab === "inspections" ? (
        <View style={styles.card}>
          {sessions.length === 0 ? (
            <Text style={styles.empty}>{t("tyres.bus.noHistory")}</Text>
          ) : (
            <>
              {preview.visible.map((sess) => (
                <Pressable
                  key={sess.tyre_inspection_session_id}
                  style={styles.historyRow}
                  onPress={() =>
                    router.push(`/inspection-record/${sess.tyre_inspection_session_id}` as any)
                  }
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyDate}>
                      {formatDateTime(sess.inspection_datetime)}
                    </Text>
                    <Text style={styles.meta}>
                      {detailLine([
                        sess.technician_name,
                        sess.odometer_reading != null
                          ? t("tyres.bus.odometerKm", {
                              km: sess.odometer_reading.toLocaleString(),
                            })
                          : null,
                      ])}
                    </Text>
                  </View>
                  <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />
                </Pressable>
              ))}
              {preview.hasMore && (
                <ShowAllRow
                  label={t("tyres.bus.showAllInspections", { count: preview.total })}
                  onPress={preview.expand}
                />
              )}
            </>
          )}
        </View>
      ) : swaps.length === 0 ? (
        <Text style={styles.emptyText}>{t("tyres.replacements.noHistory")}</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {swaps.map((sw) => (
            <Pressable
              key={sw.tyre_swap_id}
              style={styles.swapCard}
              onPress={() => openSwapPhoto(sw)}
              disabled={!sw.install_photo_view_url}
            >
              <View style={styles.sessionHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.positionTyre}>{formatDateTime(sw.created_at)}</Text>
                  <Text style={styles.positionMeta}>
                    {positionLabelFor(sw, "short")}
                    {" · "}
                    {sw.outgoing_serial ? `${sw.outgoing_serial} → ` : "fitted "}
                    {sw.incoming_serial ?? "—"}
                  </Text>
                  <Text style={styles.positionMeta}>
                    {sw.performed_by_name ?? "Unknown"}
                    {sw.incoming_tyre_pressure != null ? ` · ${sw.incoming_tyre_pressure} PSI` : ""}
                    {sw.outgoing_sidewall_condition
                      ? ` · Sidewall ${sw.outgoing_sidewall_condition === "ok" ? "OK" : "NC"}`
                      : ""}
                  </Text>
                  {/* Readings are drawn, not listed, so a swap record reads the
                      same way as an inspection does. Compact, because two
                      tyres' worth sit in one history row. */}
                  {sw.incoming_thickness_1 != null && (
                    <View style={styles.swapReadings}>
                      {sw.outgoing_thickness_1 != null && (
                        <View style={{ flex: 1 }}>
                          <Text style={styles.swapReadingsLabel}>OLD</Text>
                          <TyreTreadProfile
                            compact
                            showUnevenWear={false}
                            readings={[
                              sw.outgoing_thickness_1,
                              sw.outgoing_thickness_2,
                              sw.outgoing_thickness_3,
                              sw.outgoing_thickness_4,
                            ]}
                          />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.swapReadingsLabel}>NEW</Text>
                        <TyreTreadProfile
                          compact
                          showUnevenWear={false}
                          readings={[
                            sw.incoming_thickness_1,
                            sw.incoming_thickness_2,
                            sw.incoming_thickness_3,
                            sw.incoming_thickness_4,
                          ]}
                        />
                      </View>
                    </View>
                  )}
                </View>
                {sw.install_photo_view_url ? (
                  <FontAwesome5 name="camera" size={14} color="#7C3AED" />
                ) : (
                  <FontAwesome5 name="chevron-right" size={12} color="#D1D5DB" />
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}

      </CollapsibleSection>

      <TyreReplacementModal
        visible={replaceVisible}
        busId={busId}
        position={replacePosition}
        outgoingTyre={
          replacePosition ? tyreAtPosition.get(positionKey(replacePosition)) ?? null : null
        }
        spares={spares}
        onClose={() => setReplaceVisible(false)}
        onDone={load}
      />

      <ImageViewerOverlay
        visible={viewerVisible}
        imageUrls={swapPhotoUrls}
        startIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  meta: { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 4 },


  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 15,
  },
  ctaResume: { backgroundColor: "#EFF6FF", borderWidth: 1.5, borderColor: "#BFDBFE" },
  ctaDisabled: { backgroundColor: "#F3F4F6", borderWidth: 1.5, borderColor: "#E5E7EB" },
  ctaTextDisabled: { color: "#9CA3AF" },
  ctaHint: { marginTop: 8, fontSize: 12, fontWeight: "600", color: "#6B7280", textAlign: "center" },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 14, letterSpacing: 0.3 },
  ctaTextResume: { color: "#1E3A8A" },

  detailCard: {
    marginTop: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    padding: 16,
  },
  detailCardFlagged: { borderColor: "#FBBF24", backgroundColor: "#FFFBEB" },
  detailKicker: {
    fontSize: 9,
    fontWeight: "800",
    color: "#C4C7CE",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  detailPosition: { fontSize: 10, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.6 },
  detailSerial: { fontSize: 17, fontWeight: "800", color: "#111827", marginTop: 4 },
  detailMeta: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 3 },
  detailReadingsLabel: {
    marginTop: 10,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: "#6B7280",
  },
  detailWarnRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  detailWarnText: { fontSize: 12, fontWeight: "700", color: "#B45309" },
  detailBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 12,
  },
  detailBtnText: { color: "#fff", fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
  sidewallNote: { marginTop: 8, fontSize: 12, fontWeight: "700", color: "#B45309" },
  linkBtn: { marginTop: 12, alignItems: "center" },
  linkText: { fontSize: 12, fontWeight: "800", color: "#4F46E5" },

  updateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    backgroundColor: "#DC2626",
    borderRadius: 14,
    paddingVertical: 14,
  },
  updateBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  historyDate: { fontSize: 14, fontWeight: "800", color: "#111827" },
  empty: {
    textAlign: "center",
    paddingVertical: 20,
    color: "#9CA3AF",
    fontWeight: "600",
    fontSize: 12,
  },
  emptyText: { color: "#9CA3AF", fontWeight: "600", fontSize: 13 },

  // Still in use: the inspection-history list inside the History disclosure.
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
  },
  positionTyre: { fontSize: 15, fontWeight: "700", color: "#111827" },
  positionMeta: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 2 },
  swapReadings: { flexDirection: "row", gap: 14, marginTop: 4 },
  swapReadingsLabel: { fontSize: 9, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.5 },
  sessionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  swapCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
  },
});
