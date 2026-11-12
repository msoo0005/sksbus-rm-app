// Register inspection (Fleet Manager screen 3). With ?inspection_id it is the
// "Edit booking" form, pre-filled, saving with "Save changes".

import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PspBusState, PspInspectionType, puspakomApi, uploadPuspakomPhoto } from "@/api/puspakom";
import BusPickerField from "@/components/BusPickerField";
import DateTimeField from "@/components/puspakom/DateTimeField";
import PuspakomMark from "@/components/puspakom/PuspakomMark";
import { FieldLabel, Section } from "@/components/puspakom/Section";
import VerificationModal from "@/components/VerificationModal";
import { useProjectFilter } from "@/hooks/useProjectFilter";
import { useI18n } from "@/i18n/i18n-ctx";
import { busLabel, fmtDate, mytDate, mytHourMinute, mytInstant } from "@/utils/puspakom";
import { ROLE_COLORS } from "@/utils/roles";

const ACCENT = ROLE_COLORS.fleet_manager.accent;
const TYPES: PspInspectionType[] = ["PERIODIC", "REINSPECTION", "SPECIAL"];

export default function RegisterInspectionScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useI18n();
  const projectId = useProjectFilter();
  const params = useLocalSearchParams<{ inspection_id?: string; bus_id?: string }>();
  const editId = params.inspection_id ? Number(params.inspection_id) : null;

  const [buses, setBuses] = useState<PspBusState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busId, setBusId] = useState<string | null>(params.bus_id ?? null);
  const [type, setType] = useState<"PERIODIC" | "SPECIAL" | "REINSPECTION">("PERIODIC");
  const today = mytDate();
  const [date, setDate] = useState(today);
  const [time, setTime] = useState({ h: 9, m: 0 });
  const [bookingRef, setBookingRef] = useState("");
  const [notes, setNotes] = useState("");
  const [original, setOriginal] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: editId ? t("puspakom.form.editTitle") : t("puspakom.form.title") });
  }, [navigation, editId, t]);

  useEffect(() => {
    (async () => {
      try {
        const sched = await puspakomApi.schedule(projectId);
        setBuses(sched.buses);
        if (editId) {
          const d = await puspakomApi.inspection(editId);
          const insp = d.inspection!;
          setBusId(insp.bus_id);
          setType(insp.inspection_type);
          setDate(mytDate(insp.scheduled_at));
          setTime(mytHourMinute(insp.scheduled_at));
          setBookingRef(insp.booking_ref ?? "");
          setNotes(insp.notes ?? "");
          setOriginal(
            JSON.stringify([insp.inspection_type, mytDate(insp.scheduled_at), mytHourMinute(insp.scheduled_at), insp.booking_ref ?? "", insp.notes ?? ""]),
          );
        }
      } catch (e: any) {
        Alert.alert(t("common.error"), e?.message ?? t("puspakom.loadError"));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, editId, t]);

  const state = useMemo(() => buses.find((b) => b.bus_id === busId) ?? null, [buses, busId]);

  // Buses with an open booking are listed but can't be picked (spec 3.1).
  const disabledReasons = useMemo(() => {
    const out: Record<string, string> = {};
    for (const b of buses) if (b.open && b.open.inspection_id !== editId) out[b.bus_id] = t("puspakom.form.alreadyBooked");
    return out;
  }, [buses, editId, t]);

  const afterDue = !!state?.next_due && date > state.next_due;
  const dirty = editId
    ? JSON.stringify([type, date, time, bookingRef, notes]) !== original
    : !!busId || !!bookingRef || !!notes;
  const ready = !!busId && !!date && (editId ? dirty : true);

  // Leaving with unsaved input asks first.
  useEffect(() => {
    const sub = navigation.addListener("beforeRemove", (e: any) => {
      if (!dirty || saving) return;
      e.preventDefault();
      Alert.alert(t("puspakom.form.discardTitle"), t("puspakom.form.discardBody"), [
        { text: t("puspakom.form.keepEditing"), style: "cancel" },
        { text: t("puspakom.form.discard"), style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return sub;
  }, [navigation, dirty, saving, t]);

  const scheduledAt = mytInstant(date, time.h, time.m);

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      await puspakomApi.updateBooking(editId, {
        scheduled_at: scheduledAt,
        booking_ref: bookingRef.trim() || null,
        notes: notes.trim() || null,
        ...(type !== "REINSPECTION" ? { inspection_type: type } : {}),
      });
      Alert.alert(t("puspakom.form.saved"));
      router.back();
    } catch (e: any) {
      setSaving(false);
      Alert.alert(t("common.error"), e?.message ?? "");
    }
  };

  const register = async ({ selfie, name }: { selfie: { localUri: string; mime_type: string }; name: string }) => {
    if (!busId || type === "REINSPECTION") return;
    setSaving(true);
    try {
      const key = await uploadPuspakomPhoto(busId, "selfie", selfie);
      await puspakomApi.register({
        bus_id: busId,
        inspection_type: type,
        scheduled_at: scheduledAt,
        booking_ref: bookingRef.trim() || null,
        notes: notes.trim() || null,
        verified_name: name,
        selfie_s3_key: key,
      });
      setSigning(false);
      Alert.alert(t("puspakom.form.registered"));
      router.back();
    } catch (e: any) {
      setSaving(false);
      Alert.alert(t("common.error"), e?.message ?? "");
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Section>
          <PuspakomMark />
          <Text style={s.h1}>{editId ? t("puspakom.form.editTitle") : t("puspakom.form.title")}</Text>
          <View style={s.info}>
            <FontAwesome5 name="info-circle" size={13} color={ACCENT} />
            <Text style={s.infoText}>{editId ? t("puspakom.form.editIntro") : t("puspakom.form.intro")}</Text>
          </View>
        </Section>

        <Section icon="bus" title={t("puspakom.form.bus")}>
          <FieldLabel>{t("puspakom.form.busLabel")}</FieldLabel>
          <BusPickerField
            value={busId}
            onChange={(id) => setBusId(id)}
            accent={ACCENT}
            disabled={!!editId}
            disabledReasons={disabledReasons}
          />
          {state && (
            <>
              <View style={s.dueRow}>
                <View style={s.dueBox}>
                  <Text style={s.dueLabel}>{t("puspakom.form.lastPassed")}</Text>
                  <Text style={s.dueValue}>{fmtDate(state.last_passed)}</Text>
                </View>
                <View
                  style={[
                    s.dueBox,
                    state.days_to_due != null && state.days_to_due < 0
                      ? s.dueRed
                      : state.days_to_due != null && state.days_to_due <= 60
                        ? s.dueOrange
                        : null,
                  ]}
                >
                  <Text style={s.dueLabel}>{t("puspakom.form.nextDueBy")}</Text>
                  <Text style={s.dueValue}>{fmtDate(state.next_due)}</Text>
                </View>
              </View>
              <Text style={s.hint}>{state.last_passed ? t("puspakom.form.workedOut") : t("puspakom.form.neverPassed")}</Text>
            </>
          )}
        </Section>

        <Section icon="shield-alt" title={t("puspakom.form.inspection")}>
          <FieldLabel>{t("puspakom.form.typeLabel")}</FieldLabel>
          {TYPES.map((k) => {
            // A re-inspection is booked from the Failed result; here it is
            // only shown (selected) when editing one.
            const locked = k === "REINSPECTION" ? type !== "REINSPECTION" : type === "REINSPECTION";
            const on = type === k;
            return (
              <Pressable
                key={k}
                disabled={locked}
                onPress={() => setType(k)}
                style={[s.typeRow, on && { borderColor: ACCENT, backgroundColor: "#EFF6FF" }, locked && { opacity: 0.45 }]}
              >
                <View style={[s.radio, on && { borderColor: ACCENT }]}>{on && <View style={[s.radioDot, { backgroundColor: ACCENT }]} />}</View>
                <View style={{ flex: 1 }}>
                  <Text style={s.typeTitle}>{t(`puspakom.type.${k}`)}</Text>
                  <Text style={s.typeHint}>
                    {k === "REINSPECTION" && locked ? t("puspakom.form.reinspectionLocked") : t(`puspakom.typeHint.${k}`)}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          <View style={s.dateRow}>
            <DateTimeField mode="date" label={t("puspakom.form.date")} value={date} onChange={setDate} minimumDate={today} />
            <DateTimeField mode="time" label={t("puspakom.form.time")} value={time} onChange={setTime} step={15} />
          </View>
          {afterDue && (
            <View style={s.warn}>
              <FontAwesome5 name="exclamation-triangle" size={12} color="#B45309" />
              <Text style={s.warnText}>{t("puspakom.form.afterDue", { date: fmtDate(state?.next_due) })}</Text>
            </View>
          )}

          <FieldLabel>{t("puspakom.form.bookingRef")}</FieldLabel>
          <TextInput
            value={bookingRef}
            onChangeText={setBookingRef}
            placeholder={t("puspakom.form.bookingRefPh")}
            placeholderTextColor="#9CA3AF"
            style={s.input}
            maxLength={64}
            autoCapitalize="characters"
          />
          <FieldLabel>{t("puspakom.form.notes")}</FieldLabel>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder={t("puspakom.form.notesPh")}
            placeholderTextColor="#9CA3AF"
            style={[s.input, s.textarea]}
            multiline
            maxLength={500}
          />
        </Section>
      </ScrollView>

      <View style={s.bar}>
        <Pressable style={s.cancel} onPress={() => router.back()}>
          <Text style={s.cancelText}>{t("common.cancel")}</Text>
        </Pressable>
        <Pressable
          disabled={!ready || saving}
          style={[s.submit, { backgroundColor: ACCENT }, (!ready || saving) && { opacity: 0.5 }]}
          onPress={() => (editId ? saveEdit() : setSigning(true))}
        >
          {saving && !signing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <FontAwesome5 name="check" size={13} color="#fff" />
              <Text style={s.submitText}>{editId ? t("puspakom.form.save") : t("puspakom.form.submit")}</Text>
            </>
          )}
        </Pressable>
      </View>

      <VerificationModal
        visible={signing}
        title={t("puspakom.form.signTitle")}
        message={t("puspakom.form.signMessage", { bus: busId ? busLabel(busId, state?.bus_ev_no) : "" })}
        confirmLabel={t("puspakom.form.submit")}
        submitting={saving}
        onCancel={() => !saving && setSigning(false)}
        onConfirm={register}
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 120, width: "100%", maxWidth: 640, alignSelf: "center" },
  h1: { fontSize: 22, fontWeight: "800", color: "#111827", marginTop: 6 },
  info: { flexDirection: "row", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12, marginTop: 10 },
  infoText: { flex: 1, fontSize: 13, color: "#1E3A8A", lineHeight: 18 },
  dueRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  dueBox: { flex: 1, backgroundColor: "#F9FAFB", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: "#F3F4F6" },
  dueOrange: { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" },
  dueRed: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  dueLabel: { fontSize: 10, fontWeight: "800", color: "#6B7280", letterSpacing: 0.4, textTransform: "uppercase" },
  dueValue: { fontSize: 15, fontWeight: "800", color: "#111827", marginTop: 2 },
  hint: { fontSize: 12, color: "#6B7280", marginTop: 6 },
  typeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  typeTitle: { fontSize: 15, fontWeight: "800", color: "#111827" },
  typeHint: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  dateRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  warn: { flexDirection: "row", gap: 8, backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10, marginTop: 8 },
  warnText: { flex: 1, fontSize: 12, color: "#92400E" },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    backgroundColor: "#fff",
    color: "#111827",
  },
  textarea: { minHeight: 84, textAlignVertical: "top" },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  cancel: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18 },
  cancelText: { fontSize: 15, fontWeight: "700", color: "#374151" },
  submit: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 14 },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
