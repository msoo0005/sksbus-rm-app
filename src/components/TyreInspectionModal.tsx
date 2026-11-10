import { FontAwesome5 } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
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
import type { Tyre, TyreSidewallCondition } from "../api/client";
import RetreadCountSelector, { retreadLabel, toRetreadBucket } from "./RetreadCountSelector";
import TyreTreadProfile from "./TyreTreadProfile";
import TreadOrderCaptions from "./tyres/TreadOrderCaptions";
import ImagePickerField, { type LocalMedia } from "./ImagePicker";
import type { TyrePosition } from "./TyreReplacementModal";
import { evaluateTyre, wearLabelKey, wearToneFor } from "../utils/tyreWear";
import { useI18n } from "../i18n/i18n-ctx";

// One tyre's inspection, opened from the wheel diagram — the same shape as the
// replacement form (readings + profile + sidewall + photoless detail), so a
// technician moves through the same fields in the same order for either job.
// The six tyres are filled in one at a time and submitted together as a single
// inspection session by the parent screen.

export type TyreInspectionState = {
  treads: string[];
  pressure: string;
  sidewall: TyreSidewallCondition | null;
  // What was seen, required whenever the sidewall is NC. "NC" on its own told a
  // reviewer nothing about what was actually wrong.
  sidewallNote: string;
  sidewallPhoto: LocalMedia[];
  retreadCount: string;
  retreadSticker: LocalMedia[];
};

export function emptyInspection(tyre: Tyre): TyreInspectionState {
  return {
    treads: Array.from({ length: tyre.tyre_tread_count || 4 }, () => ""),
    pressure: "",
    sidewall: null,
    sidewallNote: "",
    sidewallPhoto: [],
    retreadCount: String(toRetreadBucket(tyre.tyre_retread_count)),
    retreadSticker: [],
  };
}

// A tyre counts as inspected once every groove has a reading, the sidewall has
// been judged, and an NC sidewall has been described AND photographed.
//
// The photo IS required on an NC sidewall, and the server takes the same line.
// It used to be optional, so that a technician with a failing camera could still
// file the finding — but that traded a verifiable finding for an unverifiable
// one every time an upload failed quietly, and the casing is often scrapped
// before anyone can go back and look.
export function isInspectionComplete(state: TyreInspectionState | undefined): boolean {
  if (!state) return false;
  if (state.treads.some((v) => !v.trim() || !Number.isFinite(Number(v)) || Number(v) < 0)) return false;
  if (!state.sidewall) return false;
  if (state.sidewall === "not_ok") {
    if (!state.sidewallNote.trim()) return false;
    // The photo is the finding's evidence, not a nicety: the casing may be
    // scrapped before anyone else can look at it. Blocking here means an upload
    // failure surfaces while the tyre is still in front of the technician.
    if (!state.sidewallPhoto.length) return false;
  }
  // A recorded retread count needs the sticker it was read off. The count only
  // ever goes up (GREATEST server-side) and the ceiling scraps the casing, so
  // it cannot be corrected later — the evidence has to come with it. A
  // never-retreaded casing has no sticker, so 0 asks for nothing.
  if (toRetreadBucket(Number(state.retreadCount)) > 0 && !state.retreadSticker.length) return false;
  return true;
}

type Props = {
  visible: boolean;
  position: TyrePosition | null;
  tyre: Tyre | null;
  value: TyreInspectionState | null;
  onSave: (next: TyreInspectionState) => void;
  onClose: () => void;
};

export default function TyreInspectionModal({
  visible,
  position,
  tyre,
  value,
  onSave,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<TyreInspectionState | null>(value);

  // Edits are held locally and only handed back on "Done", so backing out of
  // one tyre never half-writes it into the session.
  useEffect(() => {
    if (visible) setState(value ?? (tyre ? emptyInspection(tyre) : null));
  }, [visible, value, tyre]);

  if (!state || !tyre) return null;

  const patch = (p: Partial<TyreInspectionState>) => setState((s) => (s ? { ...s, ...p } : s));
  const setTread = (i: number, v: string) =>
    setState((s) => {
      if (!s) return s;
      const treads = [...s.treads];
      treads[i] = v;
      return { ...s, treads };
    });

  const complete = isInspectionComplete(state);
  const retreadValid =
    toRetreadBucket(Number(state.retreadCount)) >= toRetreadBucket(tyre.tyre_retread_count);

  // The verdict the server will derive on submit, computed here from the same
  // rules so the technician sees the conclusion as they type rather than finding
  // out afterwards. Nothing is sent — the server derives it again on write.
  // position carries axle_side, which decides whether box 1 is the outboard or
  // the inboard shoulder on this particular wheel — and so whether a gradient
  // reads as toe-in or toe-out.
  const evaluation = evaluateTyre({
    readings: state.treads,
    sidewallCondition: state.sidewall,
    axleSide: position?.axle_side ?? null,
  });
  // Amber once there is a pattern to act on, green while the tread is wearing
  // evenly. Not the verdict's palette: this card no longer reports a verdict.
  const wearTone = wearToneFor(evaluation.wear.type);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.sheet}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1}>
                {position?.label ?? t("tyres.inspectionForm.fallbackTyre")}
              </Text>
              <Text style={s.headerMeta} numberOfLines={1}>
                {tyre.tyre_serial_number}
                {" · "}
                {[tyre.tyre_brand, tyre.tyre_model].filter(Boolean).join(" ") || t("tyres.inspectionForm.noModel")}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={s.closeBtn}>
              <FontAwesome5 name="times" size={14} color="#374151" />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.fieldLabel}>
              {t("tyres.inspectionForm.treadThickness", { count: state.treads.length })}
            </Text>
            <View style={s.treadRow}>
              {state.treads.map((v, i) => (
                <TextInput
                  key={i}
                  value={v}
                  onChangeText={(t) => setTread(i, t)}
                  placeholder={`${i + 1}`}
                  placeholderTextColor="#9CA3AF"
                  keyboardType="decimal-pad"
                  style={s.treadInput}
                />
              ))}
            </View>
            <TreadOrderCaptions count={state.treads.length} axleSide={position?.axle_side ?? null} />
            <TyreTreadProfile readings={state.treads} showUnevenWear={false} />

            <Text style={s.fieldLabel}>
              {t("tyres.inspectionForm.sidewallCondition")} <Text style={{ color: "#EF4444" }}>*</Text>
            </Text>
            <View style={s.row}>
              {(["ok", "not_ok"] as const).map((v) => {
                const active = state.sidewall === v;
                return (
                  <Pressable
                    key={v}
                    style={[s.toggle, active && (v === "ok" ? s.toggleOk : s.toggleNc)]}
                    onPress={() =>
                      // Switching back to OK clears the NC detail rather than
                      // leaving an orphaned note and photo to be submitted.
                      patch(
                        v === "ok"
                          ? { sidewall: v, sidewallNote: "", sidewallPhoto: [] }
                          : { sidewall: v },
                      )
                    }
                  >
                    <Text style={[s.toggleText, active && s.toggleTextActive]}>
                      {v === "ok" ? t("tyres.inspectionForm.sidewallOk") : t("tyres.inspectionForm.sidewallNcShort")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Only an NC sidewall asks for anything further — an OK one needs
                no description and no photo. */}
            {state.sidewall === "not_ok" && (
              <>
                <Text style={s.fieldLabel}>
                  {t("tyres.inspectionForm.sidewallProblem")} <Text style={{ color: "#EF4444" }}>*</Text>
                </Text>
                <TextInput
                  value={state.sidewallNote}
                  onChangeText={(v) => patch({ sidewallNote: v })}
                  placeholder={t("tyres.inspectionForm.sidewallProblemPlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  multiline
                  maxLength={500}
                  style={[s.input, { minHeight: 72, textAlignVertical: "top" }]}
                />

                <View style={{ marginTop: 14 }}>
                  <ImagePickerField
                    title={t("tyres.inspectionForm.sidewallPhoto")}
                    required
                    icon={<FontAwesome5 name="camera" size={16} color="#DC2626" />}
                    iconAccentLight="#FEF2F2"
                    maxItems={1}
                    value={state.sidewallPhoto}
                    onChange={(media) => patch({ sidewallPhoto: media })}
                  />
                </View>
              </>
            )}

            <Text style={s.fieldLabel}>{t("tyres.inspectionForm.pressure")}</Text>
            <TextInput
              value={state.pressure}
              onChangeText={(v) => patch({ pressure: v })}
              placeholder={t("tyres.inspectionForm.pressurePlaceholder")}
              placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad"
              style={s.input}
            />

            <Text style={s.fieldLabel}>{t("tyres.inspectionForm.timesRetreaded")}</Text>
            <Text style={s.hint}>
              {t("tyres.inspectionForm.retreadHint", { count: retreadLabel(tyre.tyre_retread_count) })}
            </Text>
            <RetreadCountSelector
              value={Number(state.retreadCount) || 0}
              minimum={tyre.tyre_retread_count ?? 0}
              // Dropping back to 0 clears the sticker, so a count changed after
              // the fact cannot leave a photo attached to a casing now recorded
              // as never retreaded.
              onChange={(n) =>
                patch({ retreadCount: String(n), ...(n > 0 ? {} : { retreadSticker: [] }) })
              }
            />

            {toRetreadBucket(Number(state.retreadCount)) > 0 && (
              <View style={{ marginTop: 14 }}>
                <ImagePickerField
                  title={t("tyres.inspectionForm.retreadStickerPhoto")}
                  required
                  icon={<FontAwesome5 name="camera" size={16} color="#B45309" />}
                  iconAccentLight="#FFFBEB"
                  maxItems={1}
                  value={state.retreadSticker}
                  onChange={(media) => patch({ retreadSticker: media })}
                />
              </View>
            )}

            {/* The CLASSIFICATION only. This card used to lead with the derived
                pass/monitor/reject verdict; the verdict is still derived and
                stored server-side (it drives the fleet summary and the nightly
                digest), it is simply no longer what a technician is asked to
                read at the moment of entry. What they act on is the wear
                pattern. */}
            <Text style={s.fieldLabel}>{t("tyres.inspectionForm.classification")}</Text>
            <View style={[s.verdictCard, { borderColor: wearTone.fg, backgroundColor: wearTone.bg }]}>
              <View style={s.verdictHead}>
                <Text style={[s.verdictLabel, { color: wearTone.fg }]}>
                  {t(wearLabelKey(evaluation.wear.type))}
                </Text>
                {evaluation.minTread != null && (
                  <Text style={s.verdictMeta}>
                    {t("tyres.inspectionForm.shallowest", { mm: String(evaluation.minTread) })}
                  </Text>
                )}
              </View>

              {evaluation.wear.spread != null && (
                <Text style={[s.verdictWear, { color: wearTone.fg }]}>
                  {t("tyres.inspectionForm.spread", { mm: String(evaluation.wear.spread) })}
                </Text>
              )}

              {state.sidewall === "not_ok" && (
                <Text style={[s.verdictWear, { color: wearTone.fg }]}>
                  {t("tyres.inspectionForm.sidewallNc")}
                </Text>
              )}

              <Text style={s.verdictHint}>{t("tyres.inspectionForm.autoAssessed")}</Text>
            </View>

            <Pressable
              style={[s.doneBtn, !(complete && retreadValid) && s.doneBtnDisabled]}
              disabled={!(complete && retreadValid)}
              onPress={() => {
                onSave(state);
                onClose();
              }}
            >
              <Text style={s.doneBtnText}>{t("tyres.inspectionForm.saveTyre")}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  verdictCard: { borderWidth: 1.5, borderRadius: 14, padding: 14, marginTop: 4 },
  verdictHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  verdictLabel: { fontSize: 16, fontWeight: "800", letterSpacing: 0.4 },
  verdictMeta: { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  verdictWear: { marginTop: 6, fontSize: 12, fontWeight: "800" },
  verdictHint: { marginTop: 8, fontSize: 10, fontWeight: "600", color: "#9CA3AF" },

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
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#111827" },
  headerMeta: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 2 },
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

  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.6,
    marginTop: 18,
    marginBottom: 8,
  },
  hint: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", marginTop: -4, marginBottom: 8 },
  error: { fontSize: 11, fontWeight: "600", color: "#DC2626", marginTop: 6 },

  treadRow: { flexDirection: "row", gap: 8 },
  treadInput: {
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
  input: {
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
  inputInvalid: { borderColor: "#DC2626" },

  row: { flexDirection: "row", gap: 10 },
  toggle: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
  },
  toggleOk: { borderColor: "#16A34A", backgroundColor: "#F0FDF4" },
  toggleNc: { borderColor: "#DC2626", backgroundColor: "#FEF2F2" },
  toggleText: { fontSize: 13, fontWeight: "800", color: "#9CA3AF" },
  toggleTextActive: { color: "#111827" },


  doneBtn: {
    marginTop: 24,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
  },
  doneBtnDisabled: { backgroundColor: "#D1D5DB" },
  doneBtnText: { color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: 0.5 },
});
