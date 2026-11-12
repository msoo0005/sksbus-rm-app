import { FontAwesome5 } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n/i18n-ctx";
import { fmtDayDate } from "../../utils/puspakom";

// The picker works in the phone's own clock; PUSPAKOM dates are Malaysian
// calendar days ("YYYY-MM-DD") and times ({h, m}), so values are moved in and
// out of a local Date by their parts and never through a timezone conversion.

function dateToLocal(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day, 12);
}
function localToDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtTime(h: number, m: number) {
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

type DateProps = {
  mode: "date";
  value: string;
  onChange: (v: string) => void;
  minimumDate?: string;
  maximumDate?: string;
};
type TimeProps = {
  mode: "time";
  value: { h: number; m: number };
  onChange: (v: { h: number; m: number }) => void;
  /** Minutes between choices (spec: 15). */
  step?: number;
};

export default function DateTimeField(props: (DateProps | TimeProps) & { label?: string; disabled?: boolean; tone?: "danger" }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pickerValue =
    props.mode === "date" ? dateToLocal(props.value) : new Date(2000, 0, 1, props.value.h, props.value.m);
  const text = props.mode === "date" ? fmtDayDate(props.value) : fmtTime(props.value.h, props.value.m);

  const apply = (d?: Date) => {
    if (!d) return;
    if (props.mode === "date") props.onChange(localToDate(d));
    else {
      const step = props.step ?? 15;
      const total = Math.round((d.getHours() * 60 + d.getMinutes()) / step) * step;
      props.onChange({ h: Math.floor(total / 60) % 24, m: total % 60 });
    }
  };

  const picker = (inline: boolean) => (
    <DateTimePicker
      value={pickerValue}
      mode={props.mode}
      display={inline ? (props.mode === "date" ? "inline" : "spinner") : "default"}
      minimumDate={props.mode === "date" && props.minimumDate ? dateToLocal(props.minimumDate) : undefined}
      maximumDate={props.mode === "date" && props.maximumDate ? dateToLocal(props.maximumDate) : undefined}
      minuteInterval={props.mode === "time" ? ((props.step ?? 15) as 15) : undefined}
      onChange={(_, d) => {
        if (Platform.OS === "android") setOpen(false);
        apply(d ?? undefined);
      }}
    />
  );

  return (
    <View style={{ flex: props.mode === "date" ? 1.4 : 1 }}>
      {!!props.label && <Text style={[s.label, props.tone === "danger" && { color: "#B91C1C" }]}>{props.label}</Text>}
      <Pressable
        disabled={props.disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [s.field, props.disabled && s.disabled, pressed && { opacity: 0.8 }]}
      >
        <Text style={s.value} numberOfLines={1}>
          {text}
        </Text>
        <FontAwesome5 name="chevron-down" size={11} color="#6B7280" />
      </Pressable>

      {open && Platform.OS === "android" && picker(false)}
      {Platform.OS === "ios" && (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
            <Pressable style={s.sheet} onPress={() => {}}>
              {open && picker(true)}
              <Pressable style={s.done} onPress={() => setOpen(false)}>
                <Text style={s.doneText}>{t("reportForm.done")}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#fff",
    gap: 8,
  },
  disabled: { opacity: 0.5 },
  value: { fontSize: 15, fontWeight: "700", color: "#111827", flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#fff", borderRadius: 16, padding: 12, maxWidth: 420, width: "100%", alignSelf: "center" },
  done: { alignSelf: "flex-end", paddingHorizontal: 16, paddingVertical: 10 },
  doneText: { fontSize: 16, fontWeight: "700", color: "#2563EB" },
});
