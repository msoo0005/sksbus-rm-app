import { FontAwesome5 } from "@expo/vector-icons";
import { usePreventRemove } from "@react-navigation/native";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import type { Tyre, TyreInspectionSession } from "@/api/client";
import { api } from "@/api/client";
import BusTyreDiagramCard from "@/components/tyres/BusTyreDiagramCard";
import DraftRestoreBar from "@/components/DraftRestoreBar";
import TyreInspectionModal, {
  emptyInspection,
  isInspectionComplete,
  type TyreInspectionState,
} from "@/components/TyreInspectionModal";
import InspectionDueBadge, {
  inspectionDueState,
} from "@/components/tyres/InspectionDueBadge";
import BusIdentity from "@/components/BusIdentity";
import { useBusDirectory } from "@/hooks/useBusDirectory";
import { useI18n } from "@/i18n/i18n-ctx";
import { formatDateTime, daysSince } from "@/utils/datetime";
import { detailLine } from "@/utils/tyreFormat";
import {
  indexTyresByPosition,
  positionKey,
  type TyrePosition,
} from "@/utils/tyrePositions";
import { useFormDraft } from "@/hooks/useFormDraft";
import { uploadTyrePhoto } from "@/utils/tyrePhotoUpload";

// Matches the odometer validation on the technician job page — an
// unrealistic reading (letters, decimals, commas, or an absurd value) is
// rejected before it can ever reach the confirmation dialog.
const MAX_ODOMETER = 9_999_999;

type TyreFormState = TyreInspectionState;


const defaultFormFor = emptyInspection;

export default function TyreInspectionFormScreen() {
  const { busId: busIdParam } = useLocalSearchParams<{ busId: string }>();
  const busId = String(busIdParam ?? "");
  const router = useRouter();
  const { t } = useI18n();
  const { byId } = useBusDirectory();
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [tyres, setTyres] = useState<Tyre[]>([]);
  // Past inspections for this bus live on the same screen as the new one, so
  // "record an inspection" and "see what was found last time" aren't in two
  // different corners of the app.
  const [sessions, setSessions] = useState<TyreInspectionSession[]>([]);
  const [intervalDays, setIntervalDays] = useState(30);
  const [odometer, setOdometer] = useState("");
  const [odometerLocked, setOdometerLocked] = useState(false);
  const [forms, setForms] = useState<Record<number, TyreFormState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [activePosition, setActivePosition] = useState<TyrePosition | null>(null);


  // One draft per bus: reopening a different bus must never surface another
  // bus's half-finished readings.
  const draftValue = useMemo(
    () => ({ odometer, odometerLocked, forms }),
    [odometer, odometerLocked, forms],
  );
  const isDirty = useMemo(
    () =>
      odometer.trim() !== "" ||
      Object.values(forms).some(
        (f) =>
          f.pressure.trim() !== "" ||
          f.sidewall != null ||
          f.sidewallNote.trim() !== "" ||
          f.sidewallPhoto.length > 0 ||
          f.treads.some((v) => v.trim() !== ""),
      ),
    [odometer, forms],
  );
  const draft = useFormDraft(busId ? `tyre-inspection:${busId}` : null, draftValue, isDirty);

  // Latched on a successful submit and never cleared: the screen is on its way
  // out at that point, and a re-render must not re-arm the guard.
  const submitted = useRef(false);

  usePreventRemove(isDirty && !submitting && !submitted.current, ({ data }) => {
    Alert.alert(
      t("tyres.inspectionForm.leaveTitle"),
      t("tyres.inspectionForm.leaveBody"),
      [
        { text: t("tyres.inspectionForm.leaveStay"), style: "cancel" },
        {
          text: t("tyres.inspectionForm.leaveDiscard"),
          style: "destructive",
          onPress: () => {
            draft.clear();
            navigation.dispatch(data.action);
          },
        },
        { text: t("tyres.inspectionForm.leaveKeep"), onPress: () => navigation.dispatch(data.action) },
      ],
    );
  });

  const restoreDraft = () => {
    const v = draft.restore();
    if (!v) return;
    setOdometer(v.odometer ?? "");
    setOdometerLocked(!!v.odometerLocked);
    // Merge rather than replace: a tyre swapped since the draft was written
    // keeps its freshly-defaulted form instead of vanishing from the list.
    setForms((current) => {
      const next = { ...current };
      for (const [id, saved] of Object.entries(v.forms ?? {})) {
        if (next[Number(id)]) next[Number(id)] = { ...next[Number(id)], ...saved };
      }
      return next;
    });
  };

  useEffect(() => {
    (async () => {
      if (!busId) return;
      try {
        setLoading(true);
        const [rows, sessionRows, settings] = await Promise.all([
          api.listBusTyres(busId),
          api.listBusTyreInspections(busId).catch(() => []),
          api.getTyreSettings().catch(() => null),
        ]);
        const list = Array.isArray(rows) ? rows : [];
        setTyres(list);
        setSessions(Array.isArray(sessionRows) ? sessionRows : []);
        if (settings) setIntervalDays(settings.inspection_interval_days ?? 30);
        const next: Record<number, TyreFormState> = {};
        for (const tyre of list) next[tyre.tyre_id] = defaultFormFor(tyre);
        setForms(next);
      } catch (e: any) {
        Alert.alert(t("tyres.inspectionForm.loadFailedTitle"), e?.message ?? t("common.unknownError"));
      } finally {
        setLoading(false);
      }
    })();
    // `t` is intentionally not a dependency. It is useCallback([language]), so
    // listing it would re-run this loader whenever the language is switched —
    // and this effect calls setForms(), which would wipe a technician's
    // in-progress readings mid-inspection. It is only read inside the catch,
    // where a one-render-stale translation is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busId]);

  const bus = byId.get(busId);
  const tyreAtPosition = useMemo(() => indexTyresByPosition(tyres), [tyres]);

  const doneTyreIds = useMemo(
    () => new Set(tyres.filter((t) => isInspectionComplete(forms[t.tyre_id])).map((t) => t.tyre_id)),
    [tyres, forms],
  );
  const doneCount = doneTyreIds.size;
  const activeTyre = activePosition ? tyreAtPosition.get(positionKey(activePosition)) ?? null : null;

  // An NC sidewall has to say what is wrong with it. This replaced the old
  // reject-reason gate, which had no counterpart once the verdict stopped being
  // something the technician chose.
  const hasUndescribedSidewall = useMemo(
    () =>
      tyres.some(
        (t) => forms[t.tyre_id]?.sidewall === "not_ok" && !forms[t.tyre_id]?.sidewallNote.trim(),
      ),
    [tyres, forms],
  );

  const hasInvalidRetreadCount = useMemo(
    () =>
      tyres.some((t) => {
        const n = Number(forms[t.tyre_id]?.retreadCount);
        const previous = t.tyre_retread_count ?? 0;
        return !Number.isFinite(n) || !Number.isInteger(n) || n < previous;
      }),
    [tyres, forms],
  );

  const saveOdometer = () => {
    const raw = odometer.trim();
    if (!raw) {
      Alert.alert(t("tyres.inspectionForm.odometerRequiredTitle"), t("tyres.inspectionForm.odometerEnterBody"));
      return;
    }
    // Digits only — rejects things like "1e5", "0x10", "12,345", decimals,
    // and negative signs that `Number()` would otherwise happily parse.
    if (!/^\d+$/.test(raw)) {
      Alert.alert(t("tyres.inspectionForm.odometerInvalidTitle"), t("tyres.inspectionForm.odometerInvalidBody"));
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n > MAX_ODOMETER) {
      Alert.alert(
        t("tyres.inspectionForm.odometerInvalidTitle"),
        t("tyres.inspectionForm.odometerTooLargeBody", { max: MAX_ODOMETER.toLocaleString() }),
      );
      return;
    }
    Alert.alert(
      t("tyres.inspectionForm.odometerConfirmTitle"),
      t("tyres.inspectionForm.odometerConfirmBody", { km: n.toLocaleString() }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.save"),
          style: "default",
          onPress: () => {
            setOdometer(String(n));
            setOdometerLocked(true);
          },
        },
      ],
    );
  };

  const submit = () => {
    if (!odometerLocked) {
      Alert.alert(t("tyres.inspectionForm.odometerRequiredTitle"), t("tyres.inspectionForm.odometerSaveFirstBody"));
      return;
    }
    if (!tyres.length) {
      Alert.alert(t("tyres.inspectionForm.noTyresTitle"), t("tyres.inspectionForm.noTyresBody"));
      return;
    }
    if (doneCount < tyres.length) {
      Alert.alert(
        t("tyres.inspectionForm.incompleteTitle"),
        t("tyres.inspectionForm.incompleteBody", { count: tyres.length - doneCount }),
      );
      return;
    }
    if (hasUndescribedSidewall) {
      Alert.alert(t("tyres.inspectionForm.sidewallRequiredTitle"), t("tyres.inspectionForm.sidewallRequiredBody"));
      return;
    }
    if (hasInvalidRetreadCount) {
      Alert.alert(t("tyres.inspectionForm.retreadInvalidTitle"), t("tyres.inspectionForm.retreadInvalidBody"));
      return;
    }

    Alert.alert(
      t("tyres.inspectionForm.submitTitle"),
      t("tyres.inspectionForm.submitBody", { bus: busId, count: tyres.length }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.submit"), style: "default", onPress: doSubmit },
      ],
    );
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      // Sidewall photos upload first: the session is created in a single
      // transactional call that takes every tyre at once, so the keys have to
      // exist before it is made.
      //
      // A failure here aborts the submit, and says which tyre. This used to be
      // best-effort, which was right while the photo was optional; now that the
      // server requires one for every NC sidewall, dropping a key silently would
      // just move the failure to the server and report it as a rejected session
      // with no indication of which of six tyres was missing its photo.
      // `tyre`, not `t` — the translator is bound to `t` in this scope and the
      // error message below needs it.
      const sidewallKeys = new Map<number, string>();
      const stickerKeys = new Map<number, string>();
      for (const tyre of tyres) {
        const f = forms[tyre.tyre_id];
        if (!f) continue;
        if (f.sidewall === "not_ok") {
          try {
            sidewallKeys.set(tyre.tyre_id, await uploadTyrePhoto(f.sidewallPhoto[0], "sidewall"));
          } catch {
            throw new Error(
              t("tyres.inspectionForm.sidewallPhotoUploadFailed", { serial: tyre.tyre_serial_number }),
            );
          }
        }
        if (f.retreadSticker?.length) {
          try {
            stickerKeys.set(
              tyre.tyre_id,
              await uploadTyrePhoto(f.retreadSticker[0], "retread_sticker"),
            );
          } catch {
            throw new Error(
              t("tyres.inspectionForm.retreadStickerUploadFailed", {
                serial: tyre.tyre_serial_number,
              }),
            );
          }
        }
      }

      const payload = {
        odometer_reading: Number(odometer),
        tyres: tyres.map((t) => {
          const f = forms[t.tyre_id];
          const treads = f.treads
            .map((v, i) => ({ tread_position: i + 1, tread_thickness_mm: Number(v) }))
            .filter((tr) => Number.isFinite(tr.tread_thickness_mm) && tr.tread_thickness_mm >= 0 && String(tr.tread_thickness_mm).length && f.treads[tr.tread_position - 1].trim() !== "");
          return {
            tyre_id: t.tyre_id,
            tyre_pressure: f.pressure.trim() ? Number(f.pressure.trim()) : undefined,
            sidewall_condition: f.sidewall ?? undefined,
            sidewall_note: f.sidewall === "not_ok" ? f.sidewallNote.trim() : undefined,
            sidewall_photo_s3_key: sidewallKeys.get(t.tyre_id),
            retread_count_observed: f.retreadCount.trim() ? Number(f.retreadCount.trim()) : undefined,
            retread_sticker_s3_key: stickerKeys.get(t.tyre_id),
            // No inspection_result: the server derives the verdict from these
            // readings, the sidewall and the wear pattern.
            treads,
          };
        }),
      };

      await api.createTyreInspectionSession(busId, payload);

      // Disarm the leave-guard BEFORE the success alert. Without this the
      // `finally` below re-armed it while the alert was still on screen, and
      // tapping OK fired router.back() straight into "Leave inspection? /
      // Discard draft" — a draft prompt after a successful submit.
      submitted.current = true;
      draft.clear();

      // Also clear the form, so nothing is left dirty behind the alert.
      setForms({});
      setOdometer("");
      setOdometerLocked(false);

      Alert.alert(t("tyres.inspectionForm.submittedTitle"), t("tyres.inspectionForm.submittedBody"), [
        { text: t("common.ok"), onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert(t("tyres.inspectionForm.submitFailedTitle"), e?.message ?? t("common.unknownError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: "#F9FAFB" }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      bottomOffset={24}
    >
      <Stack.Screen options={{ title: t("tyres.nav.inspectFor", { bus: busId }) }} />

      <Text style={styles.title}>{t("tyres.inspectionForm.screenTitle")}</Text>

      {draft.pending && (
        <DraftRestoreBar
          savedAt={draft.savedAt}
          onRestore={restoreDraft}
          onDiscard={draft.discard}
        />
      )}
      <View style={styles.statusCard}>
        <View style={{ flex: 1 }}>
          <BusIdentity
            busId={busId}
            evNumber={bus?.bus_ev_no}
            routeNumber={bus?.bus_route_number}
            route={bus?.bus_route}
            routeColour={bus?.bus_route_colour}
          />
          <Text style={styles.statusMeta}>{detailLine([bus?.bus_model, bus?.project_id])}</Text>
          <Text style={styles.statusMeta}>
            {sessions.length
              ? t("tyres.inspections.lastInspectedBy", {
                  when: formatDateTime(sessions[0].inspection_datetime),
                  who: sessions[0].technician_name ?? "—",
                })
              : t("tyres.bus.noHistory")}
          </Text>
        </View>
        <InspectionDueBadge
          state={inspectionDueState(
            sessions.length ? daysSince(sessions[0].inspection_datetime) : null,
            intervalDays,
          )}
        />
      </View>

      <View style={[styles.odometerCard, odometerLocked ? styles.odometerCardLocked : styles.odometerCardWarn]}>
        <View style={styles.odometerHeaderRow}>
          <View
            style={[
              styles.odometerIconBox,
              { backgroundColor: odometerLocked ? "#F0FDF4" : "#FEF2F2" },
            ]}
          >
            <FontAwesome5
              name="tachometer-alt"
              size={13}
              color={odometerLocked ? "#16A34A" : "#DC2626"}
            />
          </View>
          <Text style={[styles.odometerTitle, { color: odometerLocked ? "#111827" : "#DC2626" }]}>
            {t("tyres.inspectionForm.odometerCardTitle")}
          </Text>
        </View>

        {odometerLocked ? (
          <>
            <Text style={styles.fieldLabel}>{t("tyres.inspectionForm.odometerRecorded")}</Text>
            <Text style={styles.odometerValue}>{Number(odometer).toLocaleString()} km</Text>
          </>
        ) : (
          <>
            <Text style={styles.helperText}>{t("tyres.inspectionForm.odometerHelper")}</Text>
            <TextInput
              style={[styles.input, { marginTop: 10 }]}
              value={odometer}
              onChangeText={setOdometer}
              placeholder={t("tyres.inspectionForm.odometerPlaceholder")}
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={saveOdometer}
              editable={!submitting}
            />
            <Pressable
              style={[styles.submitButton, { marginTop: 10 }]}
              onPress={saveOdometer}
              disabled={submitting}
            >
              <Text style={styles.submitButtonText}>{t("tyres.inspectionForm.odometerSaveButton")}</Text>
            </Pressable>
          </>
        )}
      </View>

      {tyres.length === 0 ? (
        <Text style={styles.emptyText}>{t("tyres.inspectionForm.noTyresMounted")}</Text>
      ) : (
        <>
          <Text style={styles.sectionLabel}>
            {t("tyres.inspectionForm.tyresInspected", { done: doneCount, total: tyres.length })}
          </Text>
          <Text style={styles.helperText}>{t("tyres.inspectionForm.tapEachWheel")}</Text>

          <BusTyreDiagramCard
            showTread={false}
            label=""
            tyreAt={(pos: TyrePosition) => tyreAtPosition.get(positionKey(pos))}
            doneTyreIds={doneTyreIds}
            selectedKey={null}
            onSelect={(pos) => {
              if (!odometerLocked) {
                Alert.alert(
                  t("tyres.inspectionForm.odometerRequiredTitle"),
                  t("tyres.inspectionForm.odometerBeforeReadingsBody"),
                );
                return;
              }
              if (!tyreAtPosition.get(positionKey(pos))) {
                Alert.alert(t("tyres.inspectionForm.noTyreHereTitle"), t("tyres.inspectionForm.noTyreHereBody"));
                return;
              }
              setActivePosition(pos);
            }}
          />
        </>
      )}
      <Pressable
        style={[
          styles.submitButton,
          (submitting || tyres.length === 0 || !odometerLocked || doneCount < tyres.length) && {
            opacity: 0.6,
          },
        ]}
        onPress={submit}
        disabled={submitting || tyres.length === 0 || !odometerLocked || doneCount < tyres.length}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <FontAwesome5 name="check" size={14} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.submitButtonText}>{t("tyres.inspectionForm.submitButton")}</Text>
          </>
        )}
      </Pressable>


      <TyreInspectionModal
        visible={!!activePosition && !!activeTyre}
        position={activePosition}
        tyre={activeTyre}
        value={activeTyre ? forms[activeTyre.tyre_id] ?? null : null}
        onSave={(next) => {
          if (activeTyre) setForms((f) => ({ ...f, [activeTyre.tyre_id]: next }));
        }}
        onClose={() => setActivePosition(null)}
      />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB" },

  title: { fontSize: 20, fontWeight: "800", color: "#111827" },

  odometerCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    backgroundColor: "#fff",
  },
  odometerCardWarn: { borderColor: "#FECACA", backgroundColor: "#FEF2F2" },
  odometerCardLocked: { borderColor: "#E5E7EB" },
  odometerHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  odometerIconBox: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  odometerTitle: { fontSize: 14, fontWeight: "800" },
  odometerValue: { fontSize: 18, fontWeight: "800", color: "#111827" },

  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginTop: 12, marginBottom: 6 },
  helperText: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", marginTop: -4, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },

  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
    marginBottom: 4,
  },
  statusBus: { fontSize: 18, fontWeight: "800", color: "#111827" },
  statusMeta: { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 2 },


  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 0.6,
    marginTop: 22,
    marginBottom: 6,
  },
  emptyText: { color: "#9CA3AF", fontWeight: "600", marginTop: 24, textAlign: "center" },





  submitButton: {
    flexDirection: "row",
    marginTop: 24,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
