// One walk-around stop (Technician screens 5–11): its drawing with numbered
// pins, the helper notes and every check on that stop.

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import BusDrawing, { defaultPinSpot, viewForStop } from "@/components/puspakom/BusDrawing";
import CheckRowEditor, { rowColor } from "@/components/puspakom/CheckRowEditor";
import SyncBadge from "@/components/puspakom/SyncBadge";
import { usePrecheck } from "@/hooks/usePrecheck";
import { useI18n } from "@/i18n/i18n-ctx";
import { updateAnswer } from "@/offline/puspakomDrafts";
import { localDone } from "@/utils/puspakomLocal";
import { ROLE_COLORS } from "@/utils/roles";

const ACCENT = ROLE_COLORS.technician.accent;
const GREEN = "#16A34A";

export default function StopScreen() {
  const { id, no, check } = useLocalSearchParams<{ id: string; no: string; check?: string }>();
  const inspectionId = Number(id);
  const stopNo = Number(no);
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useI18n();
  const { detail, draft, stats, pending, busy, online } = usePrecheck(inspectionId);
  const scroll = useRef<ScrollView>(null);
  const rowY = useRef<Record<string, number>>({});
  const scrolledTo = useRef<string | null>(null);

  const stop = stats?.stops.find((x) => x.stop.stop_no === stopNo);
  useEffect(() => {
    if (stop) navigation.setOptions({ title: stop.stop.stop_name });
  }, [navigation, stop]);

  if (!detail || !stats || !stop) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const settings = detail.settings;
  const answers = draft?.answers ?? {};
  const readOnly = !!draft?.locked;
  const view = stop.stop.has_drawing ? viewForStop(stopNo) : null;
  const firstOpen = stop.checks.find((c) => !localDone(c, answers[c.check_id]));
  const isLast = stopNo === stats.stops[stats.stops.length - 1].stop.stop_no;
  const complete = stop.done === stop.total;
  const nextEnabled = isLast ? stats.complete : complete;
  const goStop = (n: number) => router.replace(`/puspakom/tech/${id}/stop/${n}` as any);
  const scrollTo = (checkId: string) => {
    const y = rowY.current[checkId];
    if (y != null) scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  };

  return (
    <View style={s.page}>
      <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.tabs}>
          {stats.stops.map((st, i) => {
            const c = st.done === st.total ? GREEN : st.started ? ACCENT : "#D1D5DB";
            const on = st.stop.stop_no === stopNo;
            return (
              <React.Fragment key={st.stop.stop_no}>
                {i > 0 && <View style={s.tabLine} />}
                <Pressable
                  onPress={() => !on && goStop(st.stop.stop_no)}
                  style={[
                    s.tab,
                    { borderColor: c, backgroundColor: st.done === st.total ? GREEN : on ? ACCENT : "#fff" },
                    on && st.done !== st.total && { borderColor: ACCENT },
                  ]}
                >
                  {st.done === st.total ? (
                    <FontAwesome5 name="check" size={9} color="#fff" />
                  ) : (
                    <Text style={[s.tabText, { color: on ? "#fff" : "#6B7280" }]}>{st.stop.stop_no}</Text>
                  )}
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>

        <Text style={s.kicker}>{t("puspakom.tech.stopOf", { no: stopNo, total: stats.stops.length })}</Text>
        <View style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.h1}>{stop.stop.stop_name}</Text>
            <Text style={s.where}>{stop.stop.stop_where}</Text>
          </View>
          <Text style={[s.doneCount, { color: complete ? GREEN : ACCENT }]}>
            {t("puspakom.tech.nOfStopDone", { done: stop.done, total: stop.total })}
          </Text>
        </View>
        <SyncBadge pending={pending} busy={busy} online={online} error={draft?.lastError} />
        {readOnly && (
          <View style={s.locked}>
            <FontAwesome5 name="lock" size={11} color="#1D4ED8" />
            <Text style={s.lockedText}>{t("puspakom.tech.locked")}</Text>
          </View>
        )}

        {view && (
          <View style={s.drawingCard}>
            <BusDrawing
              view={view}
              pins={stop.checks.map((c, i) => {
                const spot = c.pin_x_pct != null && c.pin_y_pct != null ? { x: c.pin_x_pct, y: c.pin_y_pct } : defaultPinSpot(i, stop.checks.length, view);
                return {
                  key: c.check_id,
                  label: String(i + 1),
                  x: spot.x,
                  y: spot.y,
                  color: rowColor(c, answers[c.check_id], c.check_id === firstOpen?.check_id, settings),
                };
              })}
              onPin={scrollTo}
            />
          </View>
        )}

        {!!stop.stop.helper_top && <Helper text={stop.stop.helper_top} />}

        {stop.checks.map((c, i) => (
          <View
            key={c.check_id}
            onLayout={(e) => {
              rowY.current[c.check_id] = e.nativeEvent.layout.y;
              // Opened from Review on a particular check: bring it into view.
              if (check === c.check_id && scrolledTo.current !== check) {
                scrolledTo.current = check;
                setTimeout(() => scrollTo(c.check_id), 50);
              }
            }}
          >
            <CheckRowEditor
              def={c}
              no={i + 1}
              answer={answers[c.check_id]}
              current={c.check_id === firstOpen?.check_id}
              settings={settings}
              view={view}
              readOnly={readOnly}
              onChange={(patch) => updateAnswer(inspectionId, c.check_id, patch)}
            />
          </View>
        ))}

        {!!stop.stop.helper_end && <Helper text={stop.stop.helper_end} />}
      </ScrollView>

      <View style={s.footer}>
        <Text style={[s.footNote, complete && { color: GREEN }]}>
          {complete
            ? stop.attention.length
              ? t("puspakom.tech.stopDoneAttention", { total: stop.total, count: stop.attention.length })
              : t("puspakom.tech.stopDone", { total: stop.total })
            : t("puspakom.tech.leftOnSide", { count: stop.total - stop.done })}
        </Text>
        <Pressable
          disabled={!nextEnabled}
          onPress={() => (isLast ? router.push(`/puspakom/tech/${id}/review` as any) : goStop(stats.stops[stats.stops.findIndex((x) => x.stop.stop_no === stopNo) + 1].stop.stop_no))}
          style={[s.btn, { backgroundColor: nextEnabled ? ACCENT : "#E5E7EB" }]}
        >
          <Text style={[s.btnText, !nextEnabled && { color: "#9CA3AF" }]}>
            {isLast
              ? t("puspakom.tech.reviewSubmit")
              : t("puspakom.tech.nextStop", { name: stats.stops[stats.stops.findIndex((x) => x.stop.stop_no === stopNo) + 1].stop.stop_name })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Helper({ text }: { text: string }) {
  return (
    <View style={s.helper}>
      <FontAwesome5 name="user-friends" size={12} color="#9A3412" />
      <Text style={s.helperText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 150, width: "100%", maxWidth: 640, alignSelf: "center" },
  tabs: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", padding: 10, marginBottom: 12 },
  tab: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 12, fontWeight: "800" },
  tabLine: { width: 10, height: 2, backgroundColor: "#E5E7EB" },
  kicker: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.5 },
  titleRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  h1: { fontSize: 22, fontWeight: "800", color: "#111827" },
  where: { fontSize: 13, color: "#6B7280" },
  doneCount: { fontSize: 13, fontWeight: "800" },
  locked: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#EFF6FF", borderRadius: 10, padding: 10, marginBottom: 8 },
  lockedText: { flex: 1, fontSize: 12, color: "#1D4ED8" },
  drawingCard: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", padding: 10, marginBottom: 10 },
  helper: { flexDirection: "row", gap: 8, backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 12, padding: 12, marginBottom: 10 },
  helperText: { flex: 1, fontSize: 13, color: "#9A3412" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 28, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  footNote: { textAlign: "center", fontSize: 12, fontWeight: "700", color: ACCENT, marginBottom: 6 },
  btn: { borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
