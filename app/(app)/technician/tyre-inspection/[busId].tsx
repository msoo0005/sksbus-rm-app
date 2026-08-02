import { FontAwesome5 } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import type { Tyre, TyreInspectionResult } from "../../../api/client";
import { api } from "../../../api/client";

type TreadState = [string, string, string, string];

type TyreFormState = {
  pressure: string;
  retreadCount: string;
  result: TyreInspectionResult;
  rejectReason: string;
  treads: TreadState;
};

const RESULT_OPTIONS: { value: TyreInspectionResult; label: string; color: string; bg: string }[] = [
  { value: "pass", label: "Pass", color: "#16A34A", bg: "#F0FDF4" },
  { value: "monitor", label: "Monitor", color: "#D97706", bg: "#FFFBEB" },
  { value: "reject", label: "Reject", color: "#DC2626", bg: "#FEF2F2" },
];

function defaultFormFor(tyre: Tyre): TyreFormState {
  return {
    pressure: "",
    retreadCount: String(tyre.tyre_retread_count ?? 0),
    result: "pass",
    rejectReason: "",
    treads: ["", "", "", ""],
  };
}

export default function TyreInspectionFormScreen() {
  const { busId: busIdParam } = useLocalSearchParams<{ busId: string }>();
  const busId = String(busIdParam ?? "");
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [tyres, setTyres] = useState<Tyre[]>([]);
  const [odometer, setOdometer] = useState("");
  const [forms, setForms] = useState<Record<number, TyreFormState>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      if (!busId) return;
      try {
        setLoading(true);
        const rows = await api.listBusTyres(busId);
        const list = Array.isArray(rows) ? rows : [];
        setTyres(list);
        const next: Record<number, TyreFormState> = {};
        for (const t of list) next[t.tyre_id] = defaultFormFor(t);
        setForms(next);
      } catch (e: any) {
        Alert.alert("Failed to load tyres", e?.message ?? "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [busId]);

  const updateForm = (tyreId: number, patch: Partial<TyreFormState>) => {
    setForms((f) => ({ ...f, [tyreId]: { ...f[tyreId], ...patch } }));
  };

  const updateTread = (tyreId: number, index: number, value: string) => {
    setForms((f) => {
      const current = f[tyreId];
      const treads = [...current.treads] as TreadState;
      treads[index] = value;
      return { ...f, [tyreId]: { ...current, treads } };
    });
  };

  const positionLabel = (t: Tyre) => {
    if (t.axle_number == null || !t.axle_side) return "Unknown position";
    const side = t.axle_side === "left" ? "Left" : "Right";
    const wheel = t.wheel_position && t.wheel_position !== "single" ? ` ${t.wheel_position}` : "";
    return `Axle ${t.axle_number} — ${side}${wheel}`;
  };

  const hasInvalidReject = useMemo(
    () => tyres.some((t) => forms[t.tyre_id]?.result === "reject" && !forms[t.tyre_id]?.rejectReason.trim()),
    [tyres, forms],
  );

  const hasInvalidRetreadCount = useMemo(
    () =>
      tyres.some((t) => {
        const n = Number(forms[t.tyre_id]?.retreadCount);
        const previous = t.tyre_retread_count ?? 0;
        return !Number.isFinite(n) || !Number.isInteger(n) || n < previous;
      }),
    [tyres, forms],
  );

  const submit = () => {
    if (!tyres.length) {
      Alert.alert("No tyres", "This bus has no tyres currently mounted.");
      return;
    }
    if (hasInvalidReject) {
      Alert.alert("Reject reason required", "Please explain why any rejected tyre failed inspection.");
      return;
    }
    if (hasInvalidRetreadCount) {
      Alert.alert(
        "Invalid retread count",
        "Retread count must be a whole number, and cannot be lower than the tyre's previously recorded count.",
      );
      return;
    }

    Alert.alert(
      "Submit Inspection",
      `Submit tyre inspection for Bus ${busId} covering ${tyres.length} tyre${tyres.length === 1 ? "" : "s"}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Submit", style: "default", onPress: doSubmit },
      ],
    );
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        odometer_reading: odometer.trim() ? Number(odometer.trim()) : undefined,
        tyres: tyres.map((t) => {
          const f = forms[t.tyre_id];
          const treads = f.treads
            .map((v, i) => ({ tread_position: i + 1, tread_thickness_mm: Number(v) }))
            .filter((tr) => Number.isFinite(tr.tread_thickness_mm) && tr.tread_thickness_mm >= 0 && String(tr.tread_thickness_mm).length && f.treads[tr.tread_position - 1].trim() !== "");
          return {
            tyre_id: t.tyre_id,
            tyre_pressure: f.pressure.trim() ? Number(f.pressure.trim()) : undefined,
            retread_count_observed: f.retreadCount.trim() ? Number(f.retreadCount.trim()) : undefined,
            inspection_result: f.result,
            reject_reason: f.result === "reject" ? f.rejectReason.trim() : undefined,
            treads,
          };
        }),
      };

      await api.createTyreInspectionSession(busId, payload);
      Alert.alert("Inspection submitted", "Thank you — the inspection has been recorded.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert("Submission failed", e?.message ?? "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: "#F9FAFB" }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      bottomOffset={24}
    >
      <Text style={styles.title}>Tyre Inspection</Text>
      <Text style={styles.subtitle}>Bus {busId}</Text>

      <Text style={styles.label}>Odometer Reading (km)</Text>
      <TextInput
        style={styles.input}
        value={odometer}
        onChangeText={setOdometer}
        placeholder="e.g. 128340"
        placeholderTextColor="#9CA3AF"
        keyboardType="number-pad"
        editable={!submitting}
      />

      {tyres.length === 0 ? (
        <Text style={styles.emptyText}>No tyres currently mounted on this bus.</Text>
      ) : (
        tyres.map((t) => {
          const f = forms[t.tyre_id];
          if (!f) return null;
          return (
            <View key={t.tyre_id} style={styles.tyreCard}>
              <Text style={styles.positionLabel}>{positionLabel(t)}</Text>
              <Text style={styles.tyreSerial}>{t.tyre_serial_number}</Text>
              <Text style={styles.tyreMeta}>
                {[t.tyre_brand, t.tyre_model].filter(Boolean).join(" · ") || "No model details"}
              </Text>

              <Text style={styles.fieldLabel}>Retread Count</Text>
              <Text style={styles.helperText}>
                Previously recorded: {t.tyre_retread_count ?? 0} (cannot enter lower than this)
              </Text>
              <View style={styles.stepperRow}>
                <Pressable
                  style={styles.stepperBtn}
                  disabled={submitting || (Number(f.retreadCount) || 0) <= (t.tyre_retread_count ?? 0)}
                  onPress={() =>
                    updateForm(t.tyre_id, {
                      retreadCount: String(
                        Math.max(t.tyre_retread_count ?? 0, (Number(f.retreadCount) || 0) - 1),
                      ),
                    })
                  }
                >
                  <FontAwesome5 name="minus" size={12} color="#374151" />
                </Pressable>
                <TextInput
                  style={styles.stepperInput}
                  value={f.retreadCount}
                  onChangeText={(v) => updateForm(t.tyre_id, { retreadCount: v })}
                  keyboardType="number-pad"
                  editable={!submitting}
                />
                <Pressable
                  style={styles.stepperBtn}
                  disabled={submitting}
                  onPress={() =>
                    updateForm(t.tyre_id, {
                      retreadCount: String((Number(f.retreadCount) || 0) + 1),
                    })
                  }
                >
                  <FontAwesome5 name="plus" size={12} color="#374151" />
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>Tyre Pressure</Text>
              <TextInput
                style={styles.input}
                value={f.pressure}
                onChangeText={(v) => updateForm(t.tyre_id, { pressure: v })}
                placeholder="e.g. 110"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
                editable={!submitting}
              />

              <Text style={styles.fieldLabel}>Tread Thickness (mm)</Text>
              <View style={styles.treadRow}>
                {f.treads.map((v, i) => (
                  <TextInput
                    key={i}
                    style={styles.treadInput}
                    value={v}
                    onChangeText={(val) => updateTread(t.tyre_id, i, val)}
                    placeholder={`${i + 1}`}
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                    editable={!submitting}
                  />
                ))}
              </View>

              <Text style={styles.fieldLabel}>Inspection Result</Text>
              <View style={styles.resultRow}>
                {RESULT_OPTIONS.map((opt) => {
                  const active = f.result === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      style={[
                        styles.resultBtn,
                        active && { backgroundColor: opt.bg, borderColor: opt.color },
                      ]}
                      onPress={() => !submitting && updateForm(t.tyre_id, { result: opt.value })}
                    >
                      <Text style={[styles.resultBtnText, active && { color: opt.color }]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {f.result === "reject" && (
                <>
                  <Text style={styles.fieldLabel}>Reject Reason</Text>
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    value={f.rejectReason}
                    onChangeText={(v) => updateForm(t.tyre_id, { rejectReason: v })}
                    placeholder="Why is this tyre being rejected?"
                    placeholderTextColor="#9CA3AF"
                    multiline
                    editable={!submitting}
                  />
                </>
              )}
            </View>
          );
        })
      )}

      <Pressable
        style={[styles.submitButton, (submitting || tyres.length === 0) && { opacity: 0.6 }]}
        onPress={submit}
        disabled={submitting || tyres.length === 0}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <FontAwesome5 name="check" size={14} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.submitButtonText}>Submit Inspection</Text>
          </>
        )}
      </Pressable>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB" },

  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
  subtitle: { fontSize: 13, fontWeight: "600", color: "#6B7280", marginTop: 2, marginBottom: 16 },

  label: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginTop: 12, marginBottom: 6 },
  helperText: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", marginTop: -4, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  textarea: { minHeight: 70, textAlignVertical: "top" },

  emptyText: { color: "#9CA3AF", fontWeight: "600", marginTop: 24, textAlign: "center" },

  tyreCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    marginTop: 16,
  },
  positionLabel: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", letterSpacing: 0.5 },
  tyreSerial: { fontSize: 16, fontWeight: "800", color: "#111827", marginTop: 4 },
  tyreMeta: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 2 },

  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingVertical: 11,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },

  treadRow: { flexDirection: "row", gap: 8 },
  treadInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: 10,
    textAlign: "center",
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },

  resultRow: { flexDirection: "row", gap: 8 },
  resultBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  resultBtnText: { fontSize: 13, fontWeight: "700", color: "#6B7280" },

  submitButton: {
    flexDirection: "row",
    marginTop: 24,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
