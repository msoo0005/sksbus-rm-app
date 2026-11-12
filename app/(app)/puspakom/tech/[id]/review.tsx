// Review & submit (Technician screen 12). Read only except Remarks and the
// declaration. Submitting needs a connection: every photo must be uploaded.

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiError } from "@/api/client";
import { PspCheckDef, puspakomApi, uploadPuspakomPhoto } from "@/api/puspakom";
import Pill from "@/components/puspakom/Pill";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import { InfoRow, Section } from "@/components/puspakom/Section";
import SyncBadge from "@/components/puspakom/SyncBadge";
import VerificationModal from "@/components/VerificationModal";
import { useSession } from "@/ctx";
import { usePrecheck } from "@/hooks/usePrecheck";
import { useI18n } from "@/i18n/i18n-ctx";
import { LocalAnswer, clearDraft, getDraft, markLocked, pendingCount, setRemarks, syncDraft } from "@/offline/puspakomDrafts";
import { TAG_TONE, fmtDateTime, fmtShortDateTime } from "@/utils/puspakom";
import { localTag } from "@/utils/puspakomLocal";
import { ROLE_COLORS } from "@/utils/roles";

const ACCENT = ROLE_COLORS.technician.accent;

function localSummary(def: PspCheckDef, a: LocalAnswer | undefined, t: (k: string, v?: any) => string) {
  if (!a) return "";
  if (def.answer_type === "OK_NG")
    return [a.ng_reason && t(`puspakom.ngReason.${a.ng_reason}`), a.note].filter(Boolean).join(" · ");
  if (def.answer_type === "TYRE") return `${t("puspakom.tech.tread")} ${a.tread_mm ?? "—"} mm · ${a.pressure_psi ?? "—"} psi`;
  if (def.answer_type === "BRAKE") return `${t("puspakom.tech.pad")} ${a.pad_mm ?? "—"} mm`;
  return a.damages.map((d) => `${d.no} · ${d.type ? t(`puspakom.damageType.${d.type}`) : ""} ${d.where}`.trim()).join("; ");
}

export default function ReviewSubmit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspectionId = Number(id);
  const router = useRouter();
  const { t } = useI18n();
  const { dbUser } = useSession() as any;
  const { detail, draft, stats, pending, busy, online } = usePrecheck(inspectionId);
  const [remarks, setRemarksText] = useState("");
  const [declared, setDeclared] = useState(false);
  const [signing, setSigning] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) setRemarksText((r) => r || draft.remarks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.inspectionId]);

  if (!detail || !stats || !draft) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const insp = detail.inspection!;
  const settings = detail.settings;
  const answers = draft.answers;
  const photos = Object.values(answers).reduce(
    (n, a) => n + (a.photo ? 1 : 0) + a.damages.filter((d) => d.photo).length,
    0,
  );
  const attention = stats.stops.flatMap((st) => st.attention.map((c) => ({ c, stop: st.stop.stop_no })));
  const canSubmit = stats.complete && declared && !draft.locked;

  const startSubmit = async () => {
    setSaving(true);
    await setRemarks(inspectionId, remarks);
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
      await puspakomApi.submitPrecheck(inspectionId, { remarks: remarks.trim() || null, declared: true, verified_name: name, selfie_s3_key: key });
      setSigning(false);
      await clearDraft(inspectionId);
      Alert.alert(t("puspakom.tech.submitted"));
      router.dismissTo("/puspakom/tech" as any);
    } catch (e: any) {
      setSaving(false);
      if (e instanceof ApiError && e.code === "LOCKED") await markLocked(inspectionId);
      const missing = e instanceof ApiError && Array.isArray(e.body?.missing) ? `\n${e.body.missing.join(", ")}` : "";
      Alert.alert(t("common.error"), `${e?.message ?? ""}${missing}`);
    }
  };

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.busRow}>
          <PuspakomMark size={24} withText={false} />
          <View style={{ flex: 1 }}>
            <Text style={s.bus}>
              {detail.bus.bus_id}
              {!!detail.bus.bus_ev_no && <Text style={s.ev}> ({detail.bus.bus_ev_no})</Text>}
            </Text>
            <Text style={s.busMeta}>
              {t(`puspakom.type.${insp.inspection_type}`)} · {fmtShortDateTime(insp.scheduled_at)}
            </Text>
          </View>
        </View>

        <View style={[s.summary, !stats.complete && { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" }]}>
          <View style={[s.summaryIcon, { backgroundColor: stats.complete ? "#16A34A" : ACCENT }]}>
            <FontAwesome5 name={stats.complete ? "check" : "hourglass-half"} size={14} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.summaryTitle}>{t("puspakom.tech.nChecksDone", { done: stats.done, total: stats.total })}</Text>
            <Text style={s.summaryMeta}>
              {t("puspakom.tech.photosReady", { count: photos })}
            </Text>
          </View>
        </View>
        <SyncBadge pending={pending} busy={busy} online={online} error={draft.lastError} />

        <Section icon="clipboard-check" title={t("puspakom.tech.walkAround", { count: stats.stops.length })}>
          {stats.stops.map((st) => {
            const ng = st.attention.filter((c) => localTag(c, answers[c.check_id], settings) === "NG").length;
            const fix = st.attention.length - ng;
            const extra = [ng ? t("puspakom.tech.nNg", { count: ng }) : null, fix ? t("puspakom.tech.nToFix", { count: fix }) : null].filter(Boolean).join(" · ");
            return (
              <Pressable key={st.stop.stop_no} style={s.stopRow} onPress={() => router.push(`/puspakom/tech/${id}/stop/${st.stop.stop_no}` as any)}>
                <FontAwesome5 name={st.done === st.total ? "check-circle" : "circle"} solid size={15} color={st.done === st.total ? "#16A34A" : "#D1D5DB"} />
                <Text style={s.stopName}>
                  {st.stop.stop_no} · {st.stop.stop_name}
                </Text>
                <Text style={[s.stopCount, !!extra && { color: "#B91C1C", fontWeight: "800" }]}>
                  {t("puspakom.failedSheet.nChecks", { count: st.total })}
                  {extra ? ` · ${extra}` : ""}
                </Text>
              </Pressable>
            );
          })}
        </Section>

        {attention.length > 0 && (
          <Section icon="exclamation-triangle" title={t("puspakom.checklist.needsAttention", { count: attention.length })}>
            {attention.map(({ c, stop }) => {
              const tag = localTag(c, answers[c.check_id], settings)!;
              return (
                <Pressable
                  key={c.check_id}
                  style={s.attRow}
                  onPress={() => router.push(`/puspakom/tech/${id}/stop/${stop}?check=${c.check_id}` as any)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.attTitle}>{c.label}</Text>
                    <Text style={s.attMeta}>{localSummary(c, answers[c.check_id], t)}</Text>
                  </View>
                  <Pill small label={t(`puspakom.tags.${tag}`)} tone={TAG_TONE[tag]} />
                </Pressable>
              );
            })}
          </Section>
        )}

        <Section icon="pen" title={t("puspakom.checklist.remarks")}>
          <TextInput
            value={remarks}
            onChangeText={setRemarksText}
            onBlur={() => setRemarks(inspectionId, remarks)}
            placeholder={t("puspakom.tech.remarksPh")}
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={500}
            editable={!draft.locked}
            style={s.remarks}
          />
        </Section>

        <Section>
          <InfoRow label={t("puspakom.tech.inspectedBy")} value={dbUser?.user_name ?? "—"} />
          <InfoRow label={t("puspakom.bus.date")} value={fmtDateTime(new Date().toISOString())} last />
          <Pressable style={s.declare} onPress={() => setDeclared(!declared)}>
            <View style={[s.check, declared && { backgroundColor: ACCENT, borderColor: ACCENT }]}>
              {declared && <FontAwesome5 name="check" size={10} color="#fff" />}
            </View>
            <Text style={s.declareText}>{t("puspakom.tech.declaration")}</Text>
          </Pressable>
        </Section>
      </ScrollView>

      <View style={s.footer}>
        <Text style={s.footNote}>{t("puspakom.tech.fmNotified")}</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable style={s.back} onPress={() => router.back()}>
            <Text style={s.backText}>{t("common.back")}</Text>
          </Pressable>
          <Pressable
            disabled={!canSubmit || saving}
            onPress={startSubmit}
            style={[s.btn, { backgroundColor: canSubmit ? ACCENT : "#E5E7EB" }]}
          >
            {saving && !signing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[s.btnText, !canSubmit && { color: "#9CA3AF" }]}>{t("puspakom.tech.submitChecklist")}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <VerificationModal
        visible={signing}
        title={t("puspakom.tech.signTitle")}
        message={t("puspakom.tech.signMessage", { bus: detail.bus.bus_id })}
        confirmLabel={t("puspakom.tech.submitChecklist")}
        submitting={saving}
        onCancel={() => !saving && setSigning(false)}
        onConfirm={submit}
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 150, width: "100%", maxWidth: 640, alignSelf: "center" },
  busRow: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 10 },
  bus: { fontSize: 15, fontWeight: "800", color: "#111827" },
  ev: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  busMeta: { fontSize: 12, color: "#6B7280" },
  summary: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 14, padding: 14 },
  summaryIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontSize: 15, fontWeight: "800", color: "#14532D" },
  summaryMeta: { fontSize: 12, color: "#15803D", marginTop: 2 },
  stopRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  stopName: { flex: 1, fontSize: 14, fontWeight: "700", color: "#111827" },
  stopCount: { fontSize: 12, color: "#6B7280" },
  attRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  attTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  attMeta: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  remarks: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, padding: 12, minHeight: 80, textAlignVertical: "top", fontSize: 14, color: "#111827", marginTop: 8 },
  declare: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 12, padding: 12, marginTop: 10 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  declareText: { flex: 1, fontSize: 13, fontWeight: "700", color: "#9A3412" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 28, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  footNote: { textAlign: "center", fontSize: 12, color: "#9CA3AF", marginBottom: 6 },
  back: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, paddingVertical: 15, paddingHorizontal: 20 },
  backText: { fontSize: 15, fontWeight: "700", color: "#374151" },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
