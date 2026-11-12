// Pre-inspection (booking), Technician screen 3: read only; everything comes
// from the inspection the Fleet Manager registered.

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Pill from "@/components/puspakom/Pill";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import { InfoRow, Section } from "@/components/puspakom/Section";
import { usePrecheck } from "@/hooks/usePrecheck";
import { useI18n } from "@/i18n/i18n-ctx";
import { TECH_PILL_TONE, addDays, fmtDateTime, fmtDayDate, mytDate } from "@/utils/puspakom";
import { ROLE_COLORS } from "@/utils/roles";

const ACCENT = ROLE_COLORS.technician.accent;

export default function PrecheckBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { detail, draft, stats } = usePrecheck(Number(id));
  const insp = detail?.inspection;

  // A re-inspection has a re-check instead (from notifications).
  useEffect(() => {
    if (insp?.inspection_type === "REINSPECTION") router.replace(`/puspakom/tech/${id}/recheck` as any);
  }, [insp, id, router]);

  if (!detail || !insp) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const started = Object.keys(draft?.answers ?? {}).length > 0;
  const submitted = !!detail.precheck?.submitted_at || !!draft?.locked;
  const pill = submitted ? "SUBMITTED" : started ? "IN_PROGRESS" : "PRECHECK_TODO";

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <Section>
          <PuspakomMark />
          <Text style={s.plate}>
            {detail.bus.bus_id}
            {!!detail.bus.bus_ev_no && <Text style={s.ev}> ({detail.bus.bus_ev_no})</Text>}
          </Text>
          {!!detail.bus.bus_model && <Text style={s.model}>{detail.bus.bus_model}</Text>}
          <Pill
            label={pill === "IN_PROGRESS" ? t("puspakom.techPill.IN_PROGRESS", { done: stats?.done ?? 0, total: stats?.total ?? 44 }) : t(`puspakom.techPill.${pill}`)}
            tone={TECH_PILL_TONE[pill]}
            style={{ marginTop: 8 }}
          />
        </Section>

        <Section icon="calendar-alt" title={t("puspakom.inspection")}>
          <InfoRow label={t("puspakom.bus.type")} value={t(`puspakom.typeLong.${insp.inspection_type}`)} />
          <InfoRow label={t("puspakom.bus.date")} value={fmtDateTime(insp.scheduled_at)} />
          <InfoRow label={t("puspakom.bus.bookingRef")} value={insp.booking_ref ?? "—"} />
          <InfoRow
            label={t("puspakom.tech.checklistDue")}
            value={<Text style={s.due}>{fmtDayDate(addDays(mytDate(insp.scheduled_at), -1))}</Text>}
            last
          />
        </Section>

        <Section icon="user" title={t("puspakom.tech.fromFm")}>
          <Text style={s.fmName}>{insp.registered_by ?? "—"}</Text>
          <Text style={s.fmMeta}>{t("puspakom.tech.registeredOn", { date: fmtDateTime(insp.registered_at) })}</Text>
          {!!insp.notes && <Text style={s.notes}>“{insp.notes}”</Text>}
        </Section>
      </ScrollView>

      <View style={s.bar}>
        {submitted ? (
          <Pressable style={[s.btn, { backgroundColor: "#16A34A" }]} onPress={() => router.push(`/puspakom/checklist/${id}` as any)}>
            <Text style={s.btnText}>{t("puspakom.bus.viewChecklist")}</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.btn, { backgroundColor: ACCENT }]} onPress={() => router.push(`/puspakom/tech/${id}/route` as any)}>
            <FontAwesome5 name="clipboard-list" size={14} color="#fff" />
            <Text style={s.btnText}>{started ? t("puspakom.tech.continue") : t("puspakom.tech.start")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 120, width: "100%", maxWidth: 640, alignSelf: "center" },
  plate: { fontSize: 24, fontWeight: "800", color: "#111827", marginTop: 6 },
  ev: { fontSize: 15, fontWeight: "600", color: "#6B7280" },
  model: { fontSize: 13, fontWeight: "700", color: "#374151", marginTop: 2 },
  due: { fontSize: 13, fontWeight: "800", color: "#C2410C" },
  fmName: { fontSize: 15, fontWeight: "800", color: "#111827", paddingTop: 8 },
  fmMeta: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  notes: { fontSize: 14, color: "#374151", backgroundColor: "#F9FAFB", borderRadius: 10, padding: 10, marginTop: 10, fontStyle: "italic" },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 28, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  btn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 15 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
