// Re-check after a fail (Technician screen 13). Only the checks PUSPAKOM
// failed: what was fixed + 1–5 photos each. Saves on the phone as typed.

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiError } from "@/api/client";
import { puspakomApi, uploadPuspakomPhoto } from "@/api/puspakom";
import { pickImage } from "@/components/ImagePicker";
import Pill from "@/components/puspakom/Pill";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import SyncBadge from "@/components/puspakom/SyncBadge";
import VerificationModal from "@/components/VerificationModal";
import { useI18n } from "@/i18n/i18n-ctx";
import {
  LocalFix,
  clearDraft,
  getDraft,
  keepPhoto,
  markLocked,
  pendingCount,
  syncDraft,
  updateFix,
  useInspectionDraft,
} from "@/offline/puspakomDrafts";
import { TECH_PILL_TONE, addDays, daysBetween, fmtDayDate, fmtShortDateTime, mytDate } from "@/utils/puspakom";
import { photoUri } from "@/utils/puspakomLocal";
import { ROLE_COLORS } from "@/utils/roles";

const ACCENT = ROLE_COLORS.technician.accent;
const MAX_PHOTOS = 5;

const fixDone = (f: LocalFix | undefined) => !!f && f.fixed_text.trim().length > 0 && f.photos.length > 0;

export default function RecheckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspectionId = Number(id);
  const router = useRouter();
  const { t } = useI18n();
  const { detail, draft, online, busy } = useInspectionDraft(inspectionId, "RECHECK");
  const [slipOpen, setSlipOpen] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!detail || !draft) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const insp = detail.inspection!;
  const parent = detail.chain.find((c) => c.inspection_id === insp.parent_inspection_id);
  const items = detail.failed_items.filter((f) => f.inspection_id === insp.parent_inspection_id);
  const slips = detail.slips.filter((m) => m.inspection_id === insp.parent_inspection_id);
  const fixes = draft.fixes;
  const doneCount = items.filter((f) => fixDone(fixes[f.check_id])).length;
  const allDone = items.length > 0 && doneCount === items.length;
  const readOnly = draft.locked;
  const today = mytDate();
  const due = addDays(mytDate(insp.scheduled_at), -1);
  const daysLeft = daysBetween(today, due);
  const pending = pendingCount(draft);

  const addPhoto = async (checkId: string) => {
    const m = await pickImage(true);
    if (!m) return;
    const cur = getDraft(inspectionId)?.fixes[checkId];
    const photos = [...(cur?.photos ?? []), { localUri: await keepPhoto(m.localUri), s3_key: null, url: null }];
    updateFix(inspectionId, checkId, { photos: photos.slice(0, MAX_PHOTOS), fixed_text: cur?.fixed_text ?? "" });
  };

  const startSubmit = async () => {
    setSaving(true);
    await syncDraft(inspectionId);
    setSaving(false);
    const left = pendingCount(getDraft(inspectionId));
    if (left.rows || left.photos) {
      Alert.alert(t("puspakom.tech.needConnectionTitle"), t("puspakom.tech.needConnection", { rows: left.rows, photos: left.photos }));
      return;
    }
    setSigning(true);
  };

  const submit = async ({ selfie, name }: { selfie: { localUri: string; mime_type: string }; name: string }) => {
    setSaving(true);
    try {
      const key = await uploadPuspakomPhoto(detail.bus.bus_id, "selfie", selfie);
      await puspakomApi.submitRecheck(inspectionId, { verified_name: name, selfie_s3_key: key });
      setSigning(false);
      await clearDraft(inspectionId);
      Alert.alert(t("puspakom.tech.recheckSubmitted"));
      router.dismissTo("/puspakom/tech" as any);
    } catch (e: any) {
      setSaving(false);
      if (e instanceof ApiError && e.code === "LOCKED") await markLocked(inspectionId);
      Alert.alert(t("common.error"), e?.message ?? "");
    }
  };

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <PuspakomMark />
          <Text style={s.plate}>
            {detail.bus.bus_id}
            {!!detail.bus.bus_ev_no && <Text style={s.ev}> ({detail.bus.bus_ev_no})</Text>}
          </Text>
          {!!detail.bus.bus_model && <Text style={s.model}>{detail.bus.bus_model}</Text>}
          <Pill
            label={t(`puspakom.techPill.${readOnly ? "RECHECK_SUBMITTED" : "RECHECK_TODO"}`)}
            tone={TECH_PILL_TONE[readOnly ? "RECHECK_SUBMITTED" : "RECHECK_TODO"]}
            style={{ marginTop: 8 }}
          />
          <View style={s.boxes}>
            <View style={s.box}>
              <Text style={s.boxLbl}>{t("puspakom.bus.reinspection")}</Text>
              <Text style={s.boxVal}>{fmtShortDateTime(insp.scheduled_at)}</Text>
            </View>
            <View style={s.box}>
              <Text style={s.boxLbl}>{t("puspakom.tech.recheckDue")}</Text>
              <Text style={s.boxVal}>{fmtDayDate(due)}</Text>
              <Text style={[s.boxNote, daysLeft <= 0 && { color: "#B91C1C", fontWeight: "700" }]}>
                {daysLeft < 0 ? t("puspakom.tech.overdueBy", { count: -daysLeft }) : daysLeft === 0 ? t("puspakom.dueToday") : t("puspakom.daysLeft", { count: daysLeft })}
              </Text>
            </View>
          </View>
        </View>

        <View style={s.failedPanel}>
          <Text style={s.failedTitle}>{t("puspakom.bus.failedAt", { date: fmtDayDate(parent?.result_date) })}</Text>
          <Text style={s.failedText}>{t("puspakom.tech.recheckIntro")}</Text>
          {slips.length > 0 && (
            <Pressable style={s.slipBtn} onPress={() => setSlipOpen(true)}>
              <FontAwesome5 name="file-image" size={12} color="#B91C1C" />
              <Text style={s.slipBtnText}>{t("puspakom.tech.viewSlip")}</Text>
            </Pressable>
          )}
        </View>
        <SyncBadge pending={pending} busy={busy} online={online} error={draft.lastError} />

        <Text style={s.progress}>{t("puspakom.tech.failedProgress", { done: doneCount, total: items.length })}</Text>
        {items.map((f) => {
          const fix = fixes[f.check_id];
          return (
            <View key={f.check_id} style={[s.item, fixDone(fix) && { borderColor: "#BBF7D0" }]}>
              <View style={s.chip}>
                <FontAwesome5 name="times" size={9} color="#B91C1C" />
                <Text style={s.chipText}>
                  {f.check_id} {f.label}
                </Text>
              </View>
              <View style={s.found}>
                <Text style={s.foundText}>
                  <Text style={{ fontWeight: "800" }}>{t("puspakom.tech.puspakomFound")} </Text>
                  {f.puspakom_found}
                </Text>
              </View>
              <Text style={s.lbl}>{t("puspakom.bus.fixed")} *</Text>
              <FixText
                value={fix?.fixed_text ?? ""}
                editable={!readOnly}
                onCommit={(v) => updateFix(inspectionId, f.check_id, { fixed_text: v, photos: getDraft(inspectionId)?.fixes[f.check_id]?.photos ?? [] })}
              />
              <Text style={s.lbl}>{t("puspakom.tech.photosAfterFix")} *</Text>
              <View style={s.photos}>
                {(fix?.photos ?? []).map((p, i) => (
                  <Pressable
                    key={`${i}-${p.localUri ?? p.s3_key}`}
                    onPress={() => {
                      const u = photoUri(p);
                      if (readOnly) return u && setZoom(u);
                      Alert.alert(f.label, undefined, [
                        { text: t("puspakom.tech.viewPhoto"), onPress: () => u && setZoom(u) },
                        {
                          text: t("puspakom.tech.deletePhoto"),
                          style: "destructive",
                          onPress: () =>
                            updateFix(inspectionId, f.check_id, { photos: (fix?.photos ?? []).filter((_, j) => j !== i), fixed_text: fix?.fixed_text ?? "" }),
                        },
                        { text: t("common.cancel"), style: "cancel" },
                      ]);
                    }}
                  >
                    <Image source={{ uri: photoUri(p) ?? undefined }} style={s.photo} />
                    <View style={[s.tick, !p.s3_key && { backgroundColor: "#D97706" }]}>
                      <FontAwesome5 name={p.s3_key ? "check" : "cloud-upload-alt"} size={8} color="#fff" />
                    </View>
                  </Pressable>
                ))}
                {!readOnly && (fix?.photos.length ?? 0) < MAX_PHOTOS && (
                  <Pressable style={s.addPhoto} onPress={() => addPhoto(f.check_id)}>
                    <FontAwesome5 name="camera" size={16} color={ACCENT} />
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {!readOnly && (
        <View style={s.footer}>
          {!allDone && <Text style={s.footNote}>{t("puspakom.tech.recheckHint")}</Text>}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable style={s.back} onPress={() => router.back()}>
              <Text style={s.backText}>{t("puspakom.tech.saveDraft")}</Text>
            </Pressable>
            <Pressable
              disabled={!allDone || saving}
              onPress={startSubmit}
              style={[s.btn, { backgroundColor: allDone ? ACCENT : "#E5E7EB" }]}
            >
              {saving && !signing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[s.btnText, !allDone && { color: "#9CA3AF" }]}>{t("puspakom.tech.submitRecheck")}</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      <Modal visible={slipOpen || !!zoom} transparent animationType="fade" onRequestClose={() => (setSlipOpen(false), setZoom(null))}>
        <Pressable style={s.zoomBg} onPress={() => (setSlipOpen(false), setZoom(null))}>
          <ScrollView contentContainerStyle={{ gap: 12, padding: 20, paddingTop: 60 }}>
            {(zoom ? [zoom] : slips.map((m) => m.url).filter((u): u is string => !!u)).map((u) => (
              <Image key={u} source={{ uri: u }} style={s.zoomImg} resizeMode="contain" />
            ))}
          </ScrollView>
        </Pressable>
      </Modal>

      <VerificationModal
        visible={signing}
        title={t("puspakom.tech.signRecheckTitle")}
        message={t("puspakom.tech.signRecheckMessage", { bus: detail.bus.bus_id })}
        confirmLabel={t("puspakom.tech.submitRecheck")}
        submitting={saving}
        onCancel={() => !saving && setSigning(false)}
        onConfirm={submit}
      />
    </View>
  );
}

function FixText({ value, editable, onCommit }: { value: string; editable: boolean; onCommit: (v: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const h = setTimeout(() => onCommit(text), 600);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={() => text !== value && onCommit(text)}
      editable={editable}
      placeholder={t("puspakom.tech.describeFix")}
      placeholderTextColor="#9CA3AF"
      multiline
      maxLength={300}
      style={s.input}
    />
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 150, width: "100%", maxWidth: 640, alignSelf: "center" },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, marginBottom: 12 },
  plate: { fontSize: 22, fontWeight: "800", color: "#111827", marginTop: 6 },
  ev: { fontSize: 14, fontWeight: "600", color: "#6B7280" },
  model: { fontSize: 13, fontWeight: "700", color: "#374151", marginTop: 2 },
  boxes: { flexDirection: "row", gap: 8, marginTop: 12 },
  box: { flex: 1, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 10 },
  boxLbl: { fontSize: 10, fontWeight: "800", color: "#6B7280", letterSpacing: 0.4, textTransform: "uppercase" },
  boxVal: { fontSize: 14, fontWeight: "800", color: "#111827", marginTop: 3 },
  boxNote: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  failedPanel: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 16, padding: 14 },
  failedTitle: { fontSize: 15, fontWeight: "800", color: "#991B1B" },
  failedText: { fontSize: 13, color: "#7F1D1D", marginTop: 4 },
  slipBtn: { flexDirection: "row", gap: 8, alignSelf: "flex-start", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#FECACA", paddingHorizontal: 12, paddingVertical: 8, marginTop: 10 },
  slipBtnText: { color: "#B91C1C", fontWeight: "800", fontSize: 13 },
  progress: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.5, marginTop: 6, marginBottom: 8, textTransform: "uppercase" },
  item: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 10 },
  chip: { flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start", backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: "800", color: "#B91C1C" },
  found: { backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10, marginTop: 8 },
  foundText: { fontSize: 13, color: "#7F1D1D" },
  lbl: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.4, marginTop: 12, marginBottom: 6, textTransform: "uppercase" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, padding: 12, minHeight: 70, textAlignVertical: "top", fontSize: 14, color: "#111827" },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 64, height: 64, borderRadius: 10, backgroundColor: "#E5E7EB" },
  tick: { position: "absolute", top: 3, right: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center" },
  addPhoto: { width: 64, height: 64, borderRadius: 10, borderWidth: 1.5, borderStyle: "dashed", borderColor: ACCENT, backgroundColor: "#FFF7ED", alignItems: "center", justifyContent: "center" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 28, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  footNote: { textAlign: "center", fontSize: 12, color: "#9CA3AF", marginBottom: 6 },
  back: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, paddingVertical: 15, paddingHorizontal: 18 },
  backText: { fontSize: 15, fontWeight: "700", color: "#374151" },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  zoomBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  zoomImg: { width: "100%", height: 480 },
});
