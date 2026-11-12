// The technician's submitted pre-inspection checklist, read only, with every
// photo ("View checklist & photos"). Opened by the Fleet Manager, the R&M
// Manager and technicians.

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PspAnswer, PspCheckDef, PspDetail, puspakomApi } from "@/api/puspakom";
import { answerSummary } from "@/components/puspakom/BusInspectionView";
import Pill from "@/components/puspakom/Pill";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import { Section } from "@/components/puspakom/Section";
import { useI18n } from "@/i18n/i18n-ctx";
import { ATTENTION_TAGS, TAG_TONE, fmtDateTime } from "@/utils/puspakom";

export default function ChecklistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const [data, setData] = useState<PspDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    puspakomApi
      .inspection(Number(id))
      .then(setData)
      .catch((e) => setError(e?.message ?? t("puspakom.loadError")));
  }, [id, t]);

  const byId = useMemo(() => new Map((data?.precheck?.answers ?? []).map((a) => [a.check_id, a])), [data]);

  if (!data) {
    return <View style={s.center}>{error ? <Text style={s.error}>{error}</Text> : <ActivityIndicator />}</View>;
  }
  const pre = data.precheck;
  const defs = data.defs;
  const attention = (defs?.checks ?? []).filter((c) => ATTENTION_TAGS.includes(byId.get(c.check_id)?.tag as any));

  return (
    <>
      <ScrollView style={s.page} contentContainerStyle={s.content}>
        <Section>
          <PuspakomMark />
          <Text style={s.plate}>
            {data.bus.bus_id}
            {!!data.bus.bus_ev_no && <Text style={s.ev}> ({data.bus.bus_ev_no})</Text>}
          </Text>
          <Text style={s.meta}>
            {pre?.submitted_at
              ? t("puspakom.checklist.readOnly", { date: fmtDateTime(pre.submitted_at), name: pre.submitted_by ?? "—" })
              : t("puspakom.checklist.notSubmitted")}
          </Text>
          {pre && (
            <Text style={s.meta}>
              {t("puspakom.bus.checksLine", { done: pre.done, total: pre.total, attention: pre.needs_attention.length })}
            </Text>
          )}
        </Section>

        {attention.length > 0 && (
          <Section icon="exclamation-triangle" title={t("puspakom.checklist.needsAttention", { count: attention.length })}>
            {attention.map((c) => (
              <CheckRow key={c.check_id} def={c} a={byId.get(c.check_id)} onZoom={setZoom} compact />
            ))}
          </Section>
        )}

        {!!pre?.remarks && (
          <Section icon="comment" title={t("puspakom.checklist.remarks")}>
            <Text style={s.remarks}>{pre.remarks}</Text>
          </Section>
        )}

        {defs?.stops.map((st) => (
          <Section key={st.stop_no} icon="map-marker-alt" title={t("puspakom.checklist.stop", { no: st.stop_no, name: st.stop_name })}>
            {defs.checks
              .filter((c) => c.stop_no === st.stop_no)
              .map((c) => (
                <CheckRow key={c.check_id} def={c} a={byId.get(c.check_id)} onZoom={setZoom} />
              ))}
          </Section>
        ))}
      </ScrollView>

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={s.zoomBg} onPress={() => setZoom(null)}>
          {!!zoom && <Image source={{ uri: zoom }} style={s.zoomImg} resizeMode="contain" />}
          <View style={s.zoomClose}>
            <FontAwesome5 name="times" size={16} color="#fff" />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function CheckRow({ def, a, onZoom, compact }: { def: PspCheckDef; a?: PspAnswer; onZoom: (u: string) => void; compact?: boolean }) {
  const { t } = useI18n();
  const flagged = ATTENTION_TAGS.includes(a?.tag as any);
  return (
    <View style={[s.row, flagged && s.rowFlagged]}>
      <View style={s.rowHead}>
        <Text style={[s.id, flagged && { color: "#B91C1C" }]}>{def.check_id}</Text>
        <Text style={s.label}>{def.label}</Text>
        {a?.tag && <Pill small label={t(`puspakom.tags.${a.tag}`)} tone={TAG_TONE[a.tag]} />}
      </View>
      {!compact && (
        <Text style={s.okIf}>
          {t("puspakom.checklist.okIf")}: {def.ok_if}
        </Text>
      )}
      {a ? (
        <>
          <Text style={s.answer}>{answerSummary(def, a, t)}</Text>
          {!!a.note && <Text style={s.note}>{a.note}</Text>}
          <View style={s.photos}>
            {a.photo_url ? (
              <Pressable onPress={() => onZoom(a.photo_url!)}>
                <Image source={{ uri: a.photo_url }} style={s.photo} />
              </Pressable>
            ) : (
              <Text style={s.noPhoto}>{t("puspakom.checklist.noPhoto")}</Text>
            )}
            {a.damages.map((d) => (
              <Pressable key={d.no} onPress={() => d.photo_url && onZoom(d.photo_url)} style={s.damage}>
                {d.photo_url ? <Image source={{ uri: d.photo_url }} style={s.photo} /> : <View style={[s.photo, s.photoEmpty]} />}
                <Text style={s.damageText} numberOfLines={2}>
                  {t("puspakom.checklist.damageN", { no: d.no })}
                  {d.type ? ` · ${t(`puspakom.damageType.${d.type}`)}` : ""}
                  {d.where ? `\n${d.where}` : ""}
                </Text>
              </Pressable>
            ))}
          </View>
          {!!a.entered_by && (
            <Text style={s.by}>
              {a.entered_by} · {fmtDateTime(a.entered_at)}
            </Text>
          )}
        </>
      ) : (
        <Text style={s.noPhoto}>{t("puspakom.failedSheet.notAnswered")}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, paddingBottom: 48, width: "100%", maxWidth: 640, alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { color: "#B91C1C", textAlign: "center" },
  plate: { fontSize: 22, fontWeight: "800", color: "#111827", marginTop: 6 },
  ev: { fontSize: 14, fontWeight: "600", color: "#6B7280" },
  meta: { fontSize: 13, color: "#6B7280", marginTop: 4 },
  remarks: { fontSize: 14, color: "#111827", paddingTop: 8 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  rowFlagged: { backgroundColor: "#FEF2F2", marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 10 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  id: { fontSize: 12, fontWeight: "800", color: "#6B7280", width: 30 },
  label: { flex: 1, fontSize: 14, fontWeight: "800", color: "#111827" },
  okIf: { fontSize: 12, color: "#6B7280", marginTop: 4, marginLeft: 38 },
  answer: { fontSize: 13, fontWeight: "700", color: "#111827", marginTop: 6, marginLeft: 38 },
  note: { fontSize: 13, color: "#374151", marginTop: 2, marginLeft: 38 },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginLeft: 38 },
  photo: { width: 92, height: 69, borderRadius: 8, backgroundColor: "#E5E7EB" },
  photoEmpty: { borderWidth: 1, borderColor: "#E5E7EB" },
  noPhoto: { fontSize: 12, color: "#9CA3AF", marginTop: 6, marginLeft: 38 },
  damage: { width: 92 },
  damageText: { fontSize: 11, color: "#374151", marginTop: 3 },
  by: { fontSize: 11, color: "#9CA3AF", marginTop: 6, marginLeft: 38 },
  zoomBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  zoomImg: { width: "100%", height: "80%" },
  zoomClose: { position: "absolute", top: 56, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
});
