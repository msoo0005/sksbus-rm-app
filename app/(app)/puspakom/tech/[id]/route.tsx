// Walk-around route (Technician screen 4): 7 stops, 44 checks, one loop.

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import SyncBadge from "@/components/puspakom/SyncBadge";
import { usePrecheck } from "@/hooks/usePrecheck";
import { useI18n } from "@/i18n/i18n-ctx";
import { fmtShortDateTime } from "@/utils/puspakom";
import { ROLE_COLORS } from "@/utils/roles";

const ACCENT = ROLE_COLORS.technician.accent;
const GREEN = "#16A34A";

// Where each stop sits around the bus (top view, front at the top).
const STOP_XY: Record<number, [number, number, string]> = {
  1: [100, 52, ""],
  2: [100, 120, ""],
  3: [100, 14, "Front"],
  4: [40, 120, "Left"],
  5: [100, 226, "Rear"],
  6: [160, 120, "Right"],
  7: [100, 180, ""],
};

export default function WalkAroundRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { detail, draft, stats, pending, busy, online } = usePrecheck(Number(id));

  if (!detail || !stats) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const insp = detail.inspection!;
  const color = (st: (typeof stats.stops)[number]) => (st.done === st.total ? GREEN : st.started ? ACCENT : "#9CA3AF");
  const openStop = (no: number) => router.push(`/puspakom/tech/${id}/stop/${no}` as any);

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
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

        <View style={s.progress}>
          <View style={s.progHead}>
            <Text style={s.progTitle}>{t("puspakom.tech.nOfDone", { done: stats.done, total: stats.total })}</Text>
            <Text style={s.progTogo}>{t("puspakom.tech.toGo", { count: stats.total - stats.done })}</Text>
          </View>
          <View style={s.bar}>
            <View style={[s.barFill, { width: `${(stats.done / Math.max(1, stats.total)) * 100}%` }]} />
          </View>
          {stats.carryOn ? (
            <View style={s.carry}>
              <View style={{ flex: 1 }}>
                <Text style={s.carryLbl}>{t("puspakom.tech.carryOn")}</Text>
                <Text style={s.carryStop}>
                  {t("puspakom.tech.stopN", { no: stats.carryOn.stop.stop_no })} · {stats.carryOn.stop.stop_name}
                </Text>
                <Text style={s.carryLeft}>{t("puspakom.tech.leftOnSide", { count: stats.carryOn.total - stats.carryOn.done })}</Text>
              </View>
              <Pressable style={s.continue} onPress={() => openStop(stats.carryOn!.stop.stop_no)}>
                <Text style={s.continueText}>{t("puspakom.tech.continueBtn")}</Text>
                <FontAwesome5 name="chevron-right" size={11} color={ACCENT} />
              </Pressable>
            </View>
          ) : (
            <Text style={s.carryStop}>{t("puspakom.tech.allDone", { total: stats.total })}</Text>
          )}
        </View>
        <SyncBadge pending={pending} busy={busy} online={online} error={draft?.lastError} />

        <View style={s.card}>
          <View style={s.cardHead}>
            <Text style={s.cardTitle}>{t("puspakom.tech.yourRoute")}</Text>
            <Text style={s.cardMeta}>{t("puspakom.tech.oneScreenPerStop")}</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Svg width={200} height={244} viewBox="0 0 200 244">
              <Path d="M100 14 L40 30 L40 210 L100 226 L160 210 L160 30 Z" fill="none" stroke={ACCENT} strokeWidth={1.5} strokeDasharray="4 4" />
              <Rect x={70} y={26} width={60} height={190} rx={10} fill="#F9FAFB" stroke="#4B5563" strokeWidth={1.5} />
              <Rect x={76} y={32} width={48} height={16} rx={3} fill="#DBEAFE" stroke="#4B5563" strokeWidth={0.8} />
              <Rect x={82} y={166} width={36} height={28} rx={4} fill="none" stroke="#9CA3AF" strokeWidth={1} strokeDasharray="3 2" />
              {stats.stops.map((st) => {
                const [x, y, lbl] = STOP_XY[st.stop.stop_no] ?? [100, 120, ""];
                const c = color(st);
                return (
                  <G key={st.stop.stop_no} onPress={() => openStop(st.stop.stop_no)}>
                    <Circle cx={x} cy={y} r={10} fill={st.done === st.total ? c : "#fff"} stroke={c} strokeWidth={2} />
                    <SvgText x={x} y={y + 4} fontSize={10} fontWeight="800" textAnchor="middle" fill={st.done === st.total ? "#fff" : c}>
                      {st.stop.stop_no}
                    </SvgText>
                    {!!lbl && (
                      <SvgText x={x + (x === 40 ? -14 : x === 160 ? 14 : 16)} y={y + (x === 100 ? 4 : 22)} fontSize={9} fill="#6B7280" textAnchor={x === 40 ? "end" : "start"}>
                        {lbl}
                      </SvgText>
                    )}
                  </G>
                );
              })}
            </Svg>
          </View>
        </View>

        {stats.stops.map((st) => {
          const c = color(st);
          const current = stats.carryOn?.stop.stop_no === st.stop.stop_no && st.started;
          return (
            <Pressable
              key={st.stop.stop_no}
              onPress={() => openStop(st.stop.stop_no)}
              style={[s.stopRow, current && { borderColor: ACCENT, backgroundColor: "#FFF7ED" }]}
            >
              <View style={[s.stopNo, { backgroundColor: st.done === st.total ? GREEN : st.started ? ACCENT : "#F3F4F6" }]}>
                {st.done === st.total ? (
                  <FontAwesome5 name="check" size={11} color="#fff" />
                ) : (
                  <Text style={[s.stopNoText, { color: st.started ? "#fff" : "#6B7280" }]}>{st.stop.stop_no}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.stopName}>{st.stop.stop_name}</Text>
                <Text style={s.stopWhere}>{st.stop.stop_where}</Text>
              </View>
              <Text style={[s.stopCount, { color: st.started ? c : "#6B7280" }]}>
                {st.started ? `${st.done}/${st.total}` : t("puspakom.failedSheet.nChecks", { count: st.total })}
              </Text>
              <FontAwesome5 name="chevron-right" size={11} color="#9CA3AF" />
            </Pressable>
          );
        })}
        <View style={s.helper}>
          <FontAwesome5 name="user-friends" size={12} color="#6B7280" />
          <Text style={s.helperText}>{t("puspakom.tech.bringHelper")}</Text>
        </View>
      </ScrollView>

      <View style={s.footer}>
        {!stats.complete && <Text style={s.footNote}>{t("puspakom.tech.answerAll", { total: stats.total })}</Text>}
        <Pressable
          disabled={!stats.complete}
          onPress={() => router.push(`/puspakom/tech/${id}/review` as any)}
          style={[s.btn, { backgroundColor: stats.complete ? ACCENT : "#E5E7EB" }]}
        >
          <Text style={[s.btnText, !stats.complete && { color: "#9CA3AF" }]}>{t("puspakom.tech.reviewSubmit")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 140, width: "100%", maxWidth: 640, alignSelf: "center" },
  busRow: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 10 },
  bus: { fontSize: 15, fontWeight: "800", color: "#111827" },
  ev: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  busMeta: { fontSize: 12, color: "#6B7280" },
  progress: { backgroundColor: ACCENT, borderRadius: 16, padding: 14 },
  progHead: { flexDirection: "row", justifyContent: "space-between" },
  progTitle: { color: "#fff", fontSize: 13, fontWeight: "800", letterSpacing: 0.3 },
  progTogo: { color: "#FED7AA", fontSize: 12 },
  bar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.3)", marginTop: 8 },
  barFill: { height: 6, borderRadius: 3, backgroundColor: "#fff" },
  carry: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  carryLbl: { color: "#FED7AA", fontSize: 12 },
  carryStop: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 6 },
  carryLeft: { color: "#FED7AA", fontSize: 12, marginTop: 1 },
  continue: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  continueText: { color: ACCENT, fontWeight: "800", fontSize: 14 },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 10 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  cardTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  cardMeta: { fontSize: 12, color: "#9CA3AF" },
  stopRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 8 },
  stopNo: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stopNoText: { fontSize: 13, fontWeight: "800" },
  stopName: { fontSize: 15, fontWeight: "800", color: "#111827" },
  stopWhere: { fontSize: 12, color: "#6B7280" },
  stopCount: { fontSize: 13, fontWeight: "800" },
  helper: { flexDirection: "row", gap: 8, backgroundColor: "#F3F4F6", borderRadius: 12, padding: 12, marginTop: 4 },
  helperText: { flex: 1, fontSize: 12, color: "#4B5563" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 28, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  footNote: { textAlign: "center", fontSize: 12, color: "#9CA3AF", marginBottom: 6 },
  btn: { borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
