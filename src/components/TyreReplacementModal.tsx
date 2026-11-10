import { FontAwesome5 } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DropDownPicker from "react-native-dropdown-picker";
import type { Tyre, TyreSidewallCondition } from "../api/client";
import { api } from "../api/client";
import DraftRestoreBar from "./DraftRestoreBar";
import { useFormDraft } from "../hooks/useFormDraft";
import ImagePickerField, { LocalMedia } from "./ImagePicker";
import RetreadCountSelector, {
  retreadLabel,
  retreadSuffix,
  toRetreadBucket,
} from "./RetreadCountSelector";
import TyreTreadProfile from "./TyreTreadProfile";
import TreadOrderCaptions from "./tyres/TreadOrderCaptions";
import { classifyUnevenWear } from "../utils/tyreWear";
// The wheel-position model now lives in utils/tyrePositions.ts so the
// inspection and replacement flows share one definition. Re-exported here so
// existing importers keep working.
import type { TyrePosition } from "../utils/tyrePositions";
import { uploadTyrePhoto } from "../utils/tyrePhotoUpload";
import { useI18n } from "../i18n/i18n-ctx";

export type { TyrePosition };

type Props = {
  visible: boolean;
  busId: string;
  position: TyrePosition | null;
  // The tyre currently mounted at `position`, if any — null/undefined means
  // this is a first-time fit into an empty position, so the "Old Tyre Out"
  // section is skipped entirely.
  outgoingTyre?: Tyre | null;
  spares: Tyre[];
  onClose: () => void;
  // Called after a successful swap so the parent can reload its data —
  // the modal closes itself once this resolves.
  onDone: () => Promise<void> | void;
};

// A tyre has one thickness reading per circumferential groove, and the fleet
// runs both 4-groove (LM 666, GT 867) and 3-groove (LM 668) tyres — so the
// number of cells comes from the tyre itself, never a fixed 4.
const DEFAULT_TREAD_COUNT = 4;
const emptyReadings = (count: number) => Array.from({ length: count }, () => "");
const treadCountOf = (t?: Tyre | null) => t?.tyre_tread_count || DEFAULT_TREAD_COUNT;

function parseReadings(values: string[]): number[] | null {
  const nums = values.map((v) => Number(v.trim()));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return nums;
}

export default function TyreReplacementModal({
  visible,
  busId,
  position,
  outgoingTyre,
  spares,
  onClose,
  onDone,
}: Props) {
  const { t } = useI18n();
  const outgoingTreadCount = treadCountOf(outgoingTyre);

  const [outgoingThickness, setOutgoingThickness] = useState<string[]>(() =>
    emptyReadings(outgoingTreadCount),
  );
  const [outgoingCondition, setOutgoingCondition] = useState<TyreSidewallCondition | null>(null);
  const [outgoingSidewallPhoto, setOutgoingSidewallPhoto] = useState<LocalMedia[]>([]);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTyreId, setAssignTyreId] = useState<number | null>(null);
  const [assignItems, setAssignItems] = useState<{ label: string; value: number }[]>([]);

  const [incomingThickness, setIncomingThickness] = useState<string[]>(() =>
    emptyReadings(DEFAULT_TREAD_COUNT),
  );
  const [incomingPressure, setIncomingPressure] = useState("");
  const [incomingCondition, setIncomingCondition] = useState<TyreSidewallCondition | null>(null);
  const [incomingSidewallPhoto, setIncomingSidewallPhoto] = useState<LocalMedia[]>([]);
  const [incomingRetread, setIncomingRetread] = useState("0");
  const [retreadSticker, setRetreadSticker] = useState<LocalMedia[]>([]);
  const [photo, setPhoto] = useState<LocalMedia[]>([]);

  const [submitting, setSubmitting] = useState(false);

  // Keyed by wheel position, so a draft for the front-left never resurfaces on
  // the rear-right. The install photo is a local file URI that may not survive
  // the app being killed, so it is deliberately left out of the draft.
  const draftKey =
    visible && position
      ? `tyre-swap:${busId}:${position.axle_number}-${position.axle_side}-${position.wheel_position}`
      : null;
  const draftValue = useMemo(
    () => ({
      outgoingThickness,
      outgoingCondition,
      assignTyreId,
      incomingThickness,
      incomingPressure,
      incomingCondition,
      incomingRetread,
    }),
    [
      outgoingThickness,
      outgoingCondition,
      assignTyreId,
      incomingThickness,
      incomingPressure,
      incomingCondition,
      incomingRetread,
    ],
  );
  const isDirty = useMemo(
    () =>
      outgoingThickness.some((v) => v.trim() !== "") ||
      outgoingCondition != null ||
      assignTyreId != null ||
      incomingThickness.some((v) => v.trim() !== "") ||
      incomingPressure.trim() !== "" ||
      incomingCondition != null,
    [
      outgoingThickness,
      outgoingCondition,
      assignTyreId,
      incomingThickness,
      incomingPressure,
      incomingCondition,
    ],
  );
  const draft = useFormDraft(draftKey, draftValue, isDirty);

  const restoreDraft = () => {
    const v = draft.restore();
    if (!v) return;
    setOutgoingThickness(v.outgoingThickness ?? emptyReadings(outgoingTreadCount));
    setOutgoingCondition(v.outgoingCondition ?? null);
    setAssignTyreId(v.assignTyreId ?? null);
    setIncomingThickness(v.incomingThickness ?? emptyReadings(DEFAULT_TREAD_COUNT));
    setIncomingPressure(v.incomingPressure ?? "");
    setIncomingCondition(v.incomingCondition ?? null);
    setIncomingRetread(v.incomingRetread ?? "0");
  };

  useEffect(() => {
    if (!visible) return;
    setOutgoingSidewallPhoto([]);
    setIncomingSidewallPhoto([]);
    setOutgoingThickness(emptyReadings(outgoingTreadCount));
    setOutgoingCondition(null);
    setAssignOpen(false);
    setAssignTyreId(null);
    setIncomingThickness(emptyReadings(DEFAULT_TREAD_COUNT));
    setIncomingPressure("");
    setIncomingCondition(null);
    setIncomingRetread("0");
    setRetreadSticker([]);
    setPhoto([]);
  }, [visible, position, outgoingTreadCount]);

  useEffect(() => {
    // The tyre currently on this wheel is offered as a choice too: it can come
    // off, go away for retreading, and go back on in the same position. The
    // swap is still recorded as a swap, so its time off the bus and its
    // before/after readings are both preserved.
    const options = outgoingTyre ? [outgoingTyre, ...spares.filter((t) => t.tyre_id !== outgoingTyre.tyre_id)] : spares;
    setAssignItems(
      options.map((t) => ({
        // Groove count is called out only when it isn't the usual 4, the same
        // way retreads are only mentioned once there's been one.
        label: `${t.tyre_serial_number} — ${[t.tyre_brand, t.tyre_model].filter(Boolean).join(" ") || "No details"}${retreadSuffix(t.tyre_retread_count)}${treadCountOf(t) !== DEFAULT_TREAD_COUNT ? ` · ${treadCountOf(t)} grooves` : ""}${
          outgoingTyre && t.tyre_id === outgoingTyre.tyre_id ? " · REFIT THIS TYRE" : ""
        }${t.tyre_status === "retreading" ? " · back from retread" : ""}`,
        value: t.tyre_id,
      })),
    );
  }, [spares, outgoingTyre]);

  const selectedSpare = useMemo(
    () =>
      (outgoingTyre?.tyre_id === assignTyreId ? outgoingTyre : null) ??
      spares.find((t) => t.tyre_id === assignTyreId) ??
      null,
    [spares, assignTyreId, outgoingTyre],
  );
  const isSelfRefit = !!outgoingTyre && outgoingTyre.tyre_id === assignTyreId;

  const incomingTreadCount = treadCountOf(selectedSpare);

  useEffect(() => {
    if (selectedSpare) setIncomingRetread(String(toRetreadBucket(selectedSpare.tyre_retread_count)));
  }, [selectedSpare]);

  // Picking a spare with a different groove count re-shapes the cell row, so
  // any readings already typed against the old shape are dropped rather than
  // silently re-used against the wrong grooves.
  useEffect(() => {
    setIncomingThickness((prev) =>
      prev.length === incomingTreadCount ? prev : emptyReadings(incomingTreadCount),
    );
  }, [incomingTreadCount]);

  const outgoingReadingsValid = useMemo(() => !!parseReadings(outgoingThickness), [outgoingThickness]);
  const incomingReadingsValid = useMemo(() => !!parseReadings(incomingThickness), [incomingThickness]);
  const pressureValid = useMemo(() => {
    const n = Number(incomingPressure.trim());
    return Number.isFinite(n) && n > 0;
  }, [incomingPressure]);

  // A tyre cannot un-retread, so the figure read off the sticker can only be
  // at or above what the system already has for this tyre.
  const retreadValid = useMemo(
    () => toRetreadBucket(Number(incomingRetread)) >= toRetreadBucket(selectedSpare?.tyre_retread_count),
    [incomingRetread, selectedSpare],
  );

  // A never-retreaded casing has no sticker to photograph, so neither the field
  // nor its requirement applies below 1.
  const needsRetreadSticker = toRetreadBucket(Number(incomingRetread)) > 0;

  // An NC sidewall has to be photographed before the swap can be confirmed —
  // the casing is often scrapped straight afterwards, so this is the last moment
  // the evidence exists. Applies independently to each tyre.
  const sidewallEvidenceOk = (
    condition: TyreSidewallCondition | null,
    photos: LocalMedia[],
  ) => condition !== "not_ok" || photos.length > 0;

  const canConfirm =
    !!selectedSpare &&
    incomingReadingsValid &&
    pressureValid &&
    !!incomingCondition &&
    sidewallEvidenceOk(incomingCondition, incomingSidewallPhoto) &&
    retreadValid &&
    (!needsRetreadSticker || retreadSticker.length > 0) &&
    photo.length > 0 &&
    (!outgoingTyre ||
      (outgoingReadingsValid &&
        !!outgoingCondition &&
        sidewallEvidenceOk(outgoingCondition, outgoingSidewallPhoto))) &&
    !submitting;

  const setReading = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
    value: string,
  ) => {
    setter((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!position || !selectedSpare) return;
    const incoming = parseReadings(incomingThickness);
    if (!incoming) return;
    const outgoing = outgoingTyre ? parseReadings(outgoingThickness) : null;

    setSubmitting(true);
    try {
      // These two are required evidence, so a failed upload must fail the swap
      // rather than silently dropping the photo — hence uploadTyrePhoto, not the
      // best-effort variant the inspection form uses for sidewall damage.
      const install_photo_s3_key = photo.length
        ? await uploadTyrePhoto(photo[0], "install")
        : undefined;
      const retread_sticker_s3_key =
        needsRetreadSticker && retreadSticker.length
          ? await uploadTyrePhoto(retreadSticker[0], "retread_sticker")
          : undefined;

      // Same treatment: required evidence, so a failed upload fails the swap
      // rather than reaching a server that will reject it anyway.
      const outgoing_sidewall_photo_s3_key =
        outgoingTyre && outgoingCondition === "not_ok" && outgoingSidewallPhoto.length
          ? await uploadTyrePhoto(outgoingSidewallPhoto[0], "sidewall")
          : undefined;
      const incoming_sidewall_photo_s3_key =
        incomingCondition === "not_ok" && incomingSidewallPhoto.length
          ? await uploadTyrePhoto(incomingSidewallPhoto[0], "sidewall")
          : undefined;

      await api.swapTyre({
        bus_id: busId,
        axle_number: position.axle_number,
        axle_side: position.axle_side,
        wheel_position: position.wheel_position,
        incoming_tyre_id: selectedSpare.tyre_id,
        outgoing_thickness: outgoing ?? undefined,
        outgoing_sidewall_condition: outgoingTyre ? outgoingCondition ?? undefined : undefined,
        outgoing_sidewall_photo_s3_key,
        incoming_thickness: incoming,
        incoming_tyre_pressure: Number(incomingPressure.trim()),
        incoming_sidewall_condition: incomingCondition ?? undefined,
        incoming_sidewall_photo_s3_key,
        incoming_retread_count: Number(incomingRetread.trim()),
        retread_sticker_s3_key,
        install_photo_s3_key,
      });

      draft.clear();
      await onDone();
      onClose();
    } catch (e: any) {
      Alert.alert(t("tyres.replacementForm.replacementFailed"), e?.message ?? t("common.unknownError"));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * OK / NC, plus the damage photo that an NC answer requires.
   *
   * The photo field lives inside this renderer rather than beside its two call
   * sites so that the rule cannot be applied to one sidewall and forgotten on
   * the other — this form judges two casings, the one coming off and the one
   * going on, and either can be NC independently.
   *
   * Switching back to OK clears the photo, so an answer changed after the fact
   * cannot leave an orphaned image attached to a tyre judged sound.
   */
  const renderConditionRow = (
    value: TyreSidewallCondition | null,
    setter: (v: TyreSidewallCondition) => void,
    photoValue: LocalMedia[],
    setPhoto: (m: LocalMedia[]) => void,
  ) => (
    <>
      <View style={s.conditionRow}>
        <Pressable
          style={[s.conditionBtn, value === "ok" && s.conditionBtnOk]}
          onPress={() => {
            if (submitting) return;
            setter("ok");
            setPhoto([]);
          }}
        >
          <Text style={[s.conditionBtnText, value === "ok" && s.conditionBtnTextActive]}>OK</Text>
        </Pressable>
        <Pressable
          style={[s.conditionBtn, value === "not_ok" && s.conditionBtnNc]}
          onPress={() => !submitting && setter("not_ok")}
        >
          <Text style={[s.conditionBtnText, value === "not_ok" && s.conditionBtnTextActive]}>NC</Text>
        </Pressable>
      </View>

      {value === "not_ok" && (
        <View style={{ marginTop: 12 }}>
          <ImagePickerField
            title={t("tyres.replacementForm.sidewallPhoto")}
            required
            icon={<FontAwesome5 name="camera" size={16} color="#DC2626" />}
            iconAccentLight="#FEF2F2"
            maxItems={1}
            value={photoValue}
            onChange={setPhoto}
            disabled={submitting}
          />
        </View>
      )}
    </>
  );

  const renderThicknessRow = (
    values: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => (
    <>
      <View style={s.thicknessRow}>
        {values.map((v, i) => (
          <TextInput
            key={i}
            value={v}
            onChangeText={(t) => setReading(setter, i, t)}
            placeholder={t("tyres.replacementForm.thicknessPlaceholder")}
            placeholderTextColor="#9CA3AF"
            keyboardType="decimal-pad"
            style={s.thicknessInput}
            editable={!submitting}
          />
        ))}
      </View>
      <TreadOrderCaptions count={values.length} axleSide={position?.axle_side ?? null} />
      {/* Derived at the call site, not inside the profile: these are readings
          being typed right now, under the OUTER/INNER captions directly above,
          so the outer-to-inner precondition genuinely holds. The profile itself
          only ever renders a finding it is handed — it must not re-derive one
          from stored readings whose groove order predates that convention. */}
      <TyreTreadProfile
        readings={values}
        unevenWear={classifyUnevenWear(values, position?.axle_side ?? null).type}
      />
    </>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={submitting ? undefined : onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.headerTitle} numberOfLines={1}>
              {position?.label ?? "Tyre"}
            </Text>
            <Pressable
              onPress={submitting ? undefined : onClose}
              hitSlop={10}
              style={s.closeBtn}
              disabled={submitting}
            >
              <FontAwesome5 name="times" size={14} color="#374151" />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {draft.pending && (
              <DraftRestoreBar
                savedAt={draft.savedAt}
                onRestore={restoreDraft}
                onDiscard={draft.discard}
              />
            )}

            {outgoingTyre ? (
              <View style={s.section}>
                <Text style={s.sectionTitle}>{t("tyres.replacementForm.oldTyreOut")}</Text>
                <Text style={s.serialText}>{outgoingTyre.tyre_serial_number}</Text>
                {!!(outgoingTyre.tyre_brand || outgoingTyre.tyre_model) && (
                  <Text style={s.metaText}>
                    {[outgoingTyre.tyre_brand, outgoingTyre.tyre_model].filter(Boolean).join(" ")}
                  </Text>
                )}

                <Text style={s.fieldLabel}>{t("tyres.replacementForm.thickness", { count: outgoingTreadCount })}</Text>
                {renderThicknessRow(outgoingThickness, setOutgoingThickness)}

                <Text style={s.fieldLabel}>{t("tyres.replacementForm.sidewallCondition")}</Text>
                {renderConditionRow(
                  outgoingCondition,
                  setOutgoingCondition,
                  outgoingSidewallPhoto,
                  setOutgoingSidewallPhoto,
                )}

                <Pressable
                  style={s.unmountOnlyBtn}
                  disabled={submitting}
                  onPress={() => {
                    Alert.alert(
                      t("tyres.replacementForm.unmountTitle"),
                      t("tyres.replacementForm.unmountBody", { serial: outgoingTyre.tyre_serial_number }),
                      [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                          text: t("tyres.replacementForm.unmountAction"),
                          style: "destructive",
                          onPress: async () => {
                            setSubmitting(true);
                            try {
                              await api.unmountTyre(outgoingTyre.tyre_id, {});
                              await onDone();
                              onClose();
                            } catch (e: any) {
                              Alert.alert(t("tyres.replacementForm.unmountFailed"), e?.message ?? t("common.unknownError"));
                            } finally {
                              setSubmitting(false);
                            }
                          },
                        },
                      ],
                    );
                  }}
                >
                  <FontAwesome5 name="times-circle" size={12} color="#DC2626" />
                  <Text style={s.unmountOnlyText}>{t("tyres.replacementForm.unmountOnly")}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={s.section}>
                <Text style={s.sectionTitle}>{t("tyres.replacementForm.oldTyreOut")}</Text>
                <Text style={s.metaText}>{t("tyres.replacementForm.noTyreHere")}</Text>
              </View>
            )}

            <View style={[s.section, { zIndex: 3000 }]}>
              <Text style={s.sectionTitle}>{t("tyres.replacementForm.newTyreIn")}</Text>

              <Text style={s.fieldLabel}>{t("tyres.replacementForm.selectTyre")}</Text>
              <DropDownPicker
                listMode="SCROLLVIEW"
                open={assignOpen}
                value={assignTyreId}
                items={assignItems}
                setOpen={setAssignOpen}
                setValue={setAssignTyreId}
                setItems={setAssignItems}
                searchable
                searchPlaceholder="Search spare tyres…"
                placeholder={assignItems.length ? "Select a tyre to fit" : "No tyres available to fit"}
                disabled={!assignItems.length || submitting}
                style={s.dropdown}
                dropDownContainerStyle={s.dropdownContainer}
                zIndex={3000}
              />

              {isSelfRefit && (
                <Text style={s.refitNote}>
                  {t("tyres.replacementForm.refitNote")}
                </Text>
              )}

              <Text style={[s.fieldLabel, { marginTop: 16 }]}>
                THICKNESS (mm) · {incomingTreadCount} GROOVES
              </Text>
              {renderThicknessRow(incomingThickness, setIncomingThickness)}

              <Text style={s.fieldLabel}>{t("tyres.replacementForm.pressure")}</Text>
              <TextInput
                value={incomingPressure}
                onChangeText={setIncomingPressure}
                placeholder={t("tyres.replacementForm.pressurePlaceholder")}
                placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad"
                style={s.pressureInput}
                editable={!submitting}
              />

              <Text style={s.fieldLabel}>{t("tyres.replacementForm.sidewallCondition")}</Text>
              {renderConditionRow(
                incomingCondition,
                setIncomingCondition,
                incomingSidewallPhoto,
                setIncomingSidewallPhoto,
              )}

              <Text style={s.fieldLabel}>{t("tyres.replacementForm.timesRetreaded")}</Text>
              <Text style={s.fieldHint}>
                {t("tyres.replacementForm.retreadHint")}
                {selectedSpare && selectedSpare.tyre_retread_count > 0
                  ? t("tyres.replacementForm.retreadOnRecord", {
                      count: retreadLabel(selectedSpare.tyre_retread_count),
                    })
                  : ""}
              </Text>
              <RetreadCountSelector
                value={Number(incomingRetread) || 0}
                minimum={selectedSpare?.tyre_retread_count ?? 0}
                onChange={(n) => setIncomingRetread(String(n))}
                disabled={submitting}
              />

              {needsRetreadSticker && (
                <View style={{ marginTop: 16 }}>
                  <ImagePickerField
                    title={t("tyres.replacementForm.retreadStickerPhoto")}
                    icon={<FontAwesome5 name="tag" size={16} color="#0891B2" />}
                    iconAccentLight="#ECFEFF"
                    required
                    maxItems={1}
                    value={retreadSticker}
                    onChange={setRetreadSticker}
                    disabled={submitting}
                  />
                </View>
              )}

              <View style={{ marginTop: 16 }}>
                <ImagePickerField
                  title={t("tyres.replacementForm.installPhoto")}
                  icon={<FontAwesome5 name="camera" size={16} color="#7C3AED" />}
                  iconAccentLight="#F5F3FF"
                  required
                  maxItems={1}
                  value={photo}
                  onChange={setPhoto}
                  disabled={submitting}
                />
              </View>
            </View>

            <Pressable
              style={[s.confirmBtn, !canConfirm && s.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={!canConfirm}
            >
              <Text style={s.confirmBtnText}>
                {submitting ? t("tyres.replacementForm.confirming") : t("tyres.replacementForm.confirm")}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "92%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "800", color: "#111827" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    marginLeft: 12,
  },
  body: { paddingHorizontal: 20, paddingBottom: 28, paddingTop: 8 },

  section: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  // These two headings are the only thing separating the tyre coming OFF from
  // the tyre going ON, and the readings under them are easy to enter into the
  // wrong half. Sized to be unmissable at a glance rather than to match the
  // field labels below them.
  sectionTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  serialText: { fontSize: 15, fontWeight: "700", color: "#111827" },
  metaText: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 2 },

  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 8,
  },
  thicknessRow: { flexDirection: "row", gap: 8 },
  thicknessInput: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: 10,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  refitNote: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#ECFEFF",
    fontSize: 11,
    fontWeight: "700",
    color: "#0E7490",
  },
  fieldHint: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", marginBottom: 8, marginTop: -4 },
  fieldError: { fontSize: 11, fontWeight: "600", color: "#DC2626", marginTop: 6 },
  conditionRow: { flexDirection: "row", gap: 10 },
  conditionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
  },
  conditionBtnOk: { borderColor: "#16A34A", backgroundColor: "#F0FDF4" },
  conditionBtnNc: { borderColor: "#DC2626", backgroundColor: "#FEF2F2" },
  conditionBtnText: { fontSize: 13, fontWeight: "800", color: "#9CA3AF" },
  conditionBtnTextActive: { color: "#111827" },

  unmountOnlyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
  },
  unmountOnlyText: { fontSize: 12, fontWeight: "700", color: "#DC2626" },

  dropdown: {
    backgroundColor: "#F9FAFB",
    borderColor: "#E5E7EB",
    borderRadius: 12,
    minHeight: 48,
  },
  dropdownContainer: { borderColor: "#E5E7EB", borderRadius: 12 },

  pressureInput: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },

  confirmBtn: {
    marginTop: 24,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
  },
  confirmBtnDisabled: { backgroundColor: "#D1D5DB" },
  confirmBtnText: { color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: 0.5 },
});
