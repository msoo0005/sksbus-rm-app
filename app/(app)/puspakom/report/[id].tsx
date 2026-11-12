// Inspection report (screen 6): read only, from records already in the app.
// Download PDF gives the same content as an A4 SKS Chassis report.

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PspDetail, PspEvent, puspakomApi } from "@/api/puspakom";
import { eventDetail } from "@/components/puspakom/BusInspectionView";
import Pill from "@/components/puspakom/Pill";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import { Section } from "@/components/puspakom/Section";
import { useSession } from "@/ctx";
import { usePdfDownload } from "@/hooks/usePdfDownload";
import { useI18n } from "@/i18n/i18n-ctx";
import { STATUS_TONE, fmtDate, fmtDateTime } from "@/utils/puspakom";
import { ROLE_COLORS } from "@/utils/roles";

const EV_ICON: Record<PspEvent["type"], [string, string]> = {
  REGISTERED: ["calendar-alt", "#2563EB"],
  BOOKING_CHANGED: ["calendar-alt", "#2563EB"],
  PRECHECK_SUBMITTED: ["clipboard-check", "#16A34A"],
  RESULT_FAILED: ["times", "#DC2626"],
  REINSPECTION_BOOKED: ["calendar-plus", "#DC2626"],
  RECHECK_SUBMITTED: ["clipboard-check", "#16A34A"],
  RESULT_PASSED: ["shield-alt", "#16A34A"],
};

export default function InspectionReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { dbUser } = useSession() as any;
  const accent = dbUser?.user_role === "rm_manager" ? ROLE_COLORS.rm_manager.accent : ROLE_COLORS.fleet_manager.accent;
  const pdf = usePdfDownload();
  const [data, setData] = useState<PspDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[] | null>(null);

  useEffect(() => {
    puspakomApi
      .inspection(Number(id))
      .then(setData)
      .catch((e) => setError(e?.message ?? t("puspakom.loadError")));
  }, [id, t]);

  if (!data) {
    return <View style={s.center}>{error ? <Text style={s.error}>{error}</Text> : <ActivityIndicator />}</View>;
  }
  const chain = data.chain;
  const root = chain[0];
  const pass = chain.find((c) => c.result === "PASSED") ?? null;
  const reinspected = chain.length > 1;
  const firstFailed = data.failed_items.filter((f) => f.inspection_id === root.inspection_id).map((f) => f.check_id);
  const nextDue = data.events.find((e) => e.type === "RESULT_PASSED")?.detail?.next_due ?? null;
  const pillLabel = !pass ? t(`puspakom.status.${data.state.status}`) : reinspected ? t("puspakom.reports.passedAfterRe") : t("puspakom.status.PASSED");

  const links = (e: PspEvent) => {
    if (e.type === "PRECHECK_SUBMITTED")
      return [{ label: t("puspakom.bus.viewChecklist"), onPress: () => router.push(`/puspakom/checklist/${root.inspection_id}` as any) }];
    if (e.type === "RESULT_FAILED" || e.type === "RESULT_PASSED") {
      const slips = data.slips.filter((m) => m.inspection_id === e.inspection_id).map((m) => m.url).filter((u): u is string => !!u);
      return slips.length ? [{ label: t("puspakom.reports.viewSlip"), onPress: () => setPhotos(slips) }] : [];
    }
    if (e.type === "RECHECK_SUBMITTED") {
      const insp = chain.find((c) => c.inspection_id === e.inspection_id);
      const fixPhotos = data.failed_items
        .filter((f) => f.inspection_id === insp?.parent_inspection_id)
        .flatMap((f) => f.fix_photos.map((p) => p.url))
        .filter((u): u is string => !!u);
      return fixPhotos.length ? [{ label: t("puspakom.reports.viewFixPhotos"), onPress: () => setPhotos(fixPhotos) }] : [];
    }
    return [];
  };

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <Section>
          <PuspakomMark />
          <Text style={s.kicker}>{t("puspakom.reports.reportKicker")}</Text>
          <Text style={s.plate}>
            {data.bus.bus_id}
            {!!data.bus.bus_ev_no && <Text style={s.ev}> ({data.bus.bus_ev_no})</Text>}
          </Text>
          {!!data.bus.bus_model && <Text style={s.model}>{data.bus.bus_model}</Text>}
          <Pill label={pillLabel} tone={pass ? STATUS_TONE.PASSED : STATUS_TONE[data.state.status]} style={{ marginTop: 8 }} />
          <View style={s.facts}>
            <Fact label={t("puspakom.bus.type")} value={t(`puspakom.type.${root.inspection_type}`)} sub={t(`puspakom.typeLong.${root.inspection_type}`).replace(/^.*\((.*)\)$/, "$1")} />
            <Fact
              label={t("puspakom.reports.firstInspection")}
              value={fmtDate(root.result_date ?? root.scheduled_at.slice(0, 10))}
              sub={root.result === "FAILED" ? `${t("puspakom.bus.failed")} (${firstFailed.join(", ")})` : root.result ? t("puspakom.bus.passed") : "—"}
            />
            {pass && <Fact label={t("puspakom.bus.passed")} value={fmtDate(pass.result_date)} sub={t(`puspakom.type.${pass.inspection_type}`)} />}
          </View>
          <View style={s.refRow}>
            <Text style={s.refText}>{t("puspakom.reports.ref", { ref: root.ref_no ?? "—" })}</Text>
            {!!nextDue && <Text style={s.refText}>{t("puspakom.reports.nextDue", { date: fmtDate(nextDue) })}</Text>}
          </View>
        </Section>

        <Section icon="history" title={t("puspakom.bus.chronology")} right={<Text style={s.meta}>{t("puspakom.reports.eventsOldest", { count: data.events.length })}</Text>}>
          {data.events.map((e, i) => {
            const [icon, color] = EV_ICON[e.type];
            const failedChips = e.type === "RESULT_FAILED" ? (e.detail?.failed ?? []) : [];
            return (
              <View key={e.event_id} style={s.ev2}>
                <View style={s.rail}>
                  <View style={[s.icon, { backgroundColor: `${color}1A` }]}>
                    <FontAwesome5 name={icon as any} size={11} color={color} />
                  </View>
                  {i < data.events.length - 1 && <View style={s.line} />}
                </View>
                <View style={{ flex: 1, paddingBottom: 16 }}>
                  <Text style={s.evTitle}>{t(`puspakom.events.${e.type}`)}</Text>
                  <Text style={s.evWho}>{e.actor ?? "—"}</Text>
                  <Text style={s.evAt}>{fmtDateTime(e.at)}</Text>
                  {failedChips.length > 0 ? (
                    <View style={s.chips}>
                      {failedChips.map((f: any) => (
                        <View key={f.check_id} style={s.chip}>
                          <Text style={s.chipText}>✕ {f.check_id} {f.label}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    !!eventDetail(e, t) && <Text style={s.evDetail}>{eventDetail(e, t)}</Text>
                  )}
                  {links(e).map((l) => (
                    <Pressable key={l.label} onPress={l.onPress} style={{ marginTop: 6 }}>
                      <Text style={[s.link, { color: accent }]}>{l.label} ›</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
        </Section>
        {pdf.busy && <Text style={s.meta}>{t("pdf.preparing")}</Text>}
      </ScrollView>

      {pass && (
        <View style={s.bar}>
          <Pressable style={s.share} disabled={pdf.busy} onPress={() => pdf.run(() => puspakomApi.reportPdf(root.inspection_id))}>
            <FontAwesome5 name="share-square" size={13} color="#374151" />
            <Text style={s.shareText}>{t("puspakom.reports.share")}</Text>
          </Pressable>
          <Pressable
            style={[s.dl, { backgroundColor: accent }, pdf.busy && { opacity: 0.6 }]}
            disabled={pdf.busy}
            onPress={() => pdf.run(() => puspakomApi.reportPdf(root.inspection_id))}
          >
            {pdf.busy ? <ActivityIndicator color="#fff" /> : <FontAwesome5 name="download" size={13} color="#fff" />}
            <Text style={s.dlText}>{pdf.busy ? t("pdf.preparing") : t("puspakom.reports.download")}</Text>
          </Pressable>
        </View>
      )}

      <Modal visible={!!photos} transparent animationType="fade" onRequestClose={() => setPhotos(null)}>
        <Pressable style={s.zoomBg} onPress={() => setPhotos(null)}>
          <ScrollView contentContainerStyle={{ gap: 12, padding: 20, paddingTop: 60 }}>
            {(photos ?? []).map((u) => (
              <Image key={u} source={{ uri: u }} style={s.zoomImg} resizeMode="contain" />
            ))}
          </ScrollView>
        </Pressable>
      </Modal>
    </View>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLbl}>{label}</Text>
      <Text style={s.factVal}>{value}</Text>
      {!!sub && <Text style={s.factSub}>{sub}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { color: "#B91C1C", textAlign: "center" },
  content: { padding: 16, paddingBottom: 120, width: "100%", maxWidth: 640, alignSelf: "center" },
  kicker: { fontSize: 10, fontWeight: "800", color: "#6B7280", letterSpacing: 0.6, marginTop: 8 },
  plate: { fontSize: 24, fontWeight: "800", color: "#111827" },
  ev: { fontSize: 14, fontWeight: "600", color: "#6B7280" },
  model: { fontSize: 13, fontWeight: "700", color: "#374151", marginTop: 2 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  fact: { width: "48%", backgroundColor: "#F9FAFB", borderRadius: 12, padding: 10 },
  factLbl: { fontSize: 10, fontWeight: "800", color: "#6B7280", letterSpacing: 0.4, textTransform: "uppercase" },
  factVal: { fontSize: 15, fontWeight: "800", color: "#111827", marginTop: 2 },
  factSub: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  refRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 10, marginTop: 10 },
  refText: { fontSize: 12, color: "#6B7280" },
  meta: { fontSize: 12, color: "#9CA3AF", textAlign: "center" },
  ev2: { flexDirection: "row", gap: 10, paddingTop: 10 },
  rail: { width: 26, alignItems: "center" },
  icon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  line: { flex: 1, width: 2, backgroundColor: "#E5E7EB", marginTop: 2 },
  evTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  evWho: { fontSize: 13, fontWeight: "700", color: "#374151", marginTop: 2 },
  evAt: { fontSize: 12, color: "#6B7280" },
  evDetail: { fontSize: 12, color: "#374151", marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: "800", color: "#B91C1C" },
  link: { fontSize: 13, fontWeight: "800" },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 10, padding: 16, paddingBottom: 28, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  share: { flexDirection: "row", gap: 8, alignItems: "center", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18 },
  shareText: { fontSize: 15, fontWeight: "700", color: "#374151" },
  dl: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 14 },
  dlText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  zoomBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  zoomImg: { width: "100%", height: 480 },
});
