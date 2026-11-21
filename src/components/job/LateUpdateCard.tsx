import { FontAwesome5 } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../api/client";
import { uploadJobKindPhoto, uploadVerificationSelfie } from "../../api/media";
import { useI18n } from "../../i18n/i18n-ctx";
import ImagePickerField, { LocalMedia } from "../ImagePicker";
import SignoffSheet from "../SignoffSheet";
import { KEYBOARD_DONE_ID } from "@/components/KeyboardDone";

type Reason = "TRAFFIC" | "BUS_IN_OPERATION" | "OTHER";

function durationLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

type Props = {
  jobId: number;
  refLabel: string;
  limitMin: number;
  repeatMin: number;
  onSent: () => void;
};

/**
 * C15 · "Update required": not arrived 90 min after accepting. Reason, an
 * optional note (required for Other), at least one camera photo, then the
 * sign-off. It comes back 30 min after each update while still not arrived.
 */
export default function LateUpdateCard({ jobId, refLabel, limitMin, repeatMin, onSent }: Props) {
  const { t } = useI18n();
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<LocalMedia[]>([]);
  const [signing, setSigning] = useState(false);
  const [sending, setSending] = useState(false);
  const [triedSend, setTriedSend] = useState(false);

  const noteMissing = reason === "OTHER" && !note.trim();
  const ready = !!reason && !noteMissing && photos.length > 0;

  const options: { key: Reason; label: string; hint?: string; icon: string }[] = [
    { key: "TRAFFIC", label: t("job2.late.traffic"), icon: "car" },
    { key: "BUS_IN_OPERATION", label: t("job2.late.busInOperation"), hint: t("job2.late.busInOperationHint"), icon: "bus" },
    { key: "OTHER", label: t("job2.late.other"), icon: "ellipsis-h" },
  ];

  const send = async ({ selfie, name }: { selfie: LocalMedia; name: string }) => {
    if (!reason) return;
    setSending(true);
    try {
      const keys: string[] = [];
      for (const p of photos) keys.push(await uploadJobKindPhoto(jobId, "delay", p));
      const selfieKey = await uploadVerificationSelfie("job-delay", jobId, selfie);
      await api.addDelayUpdate(jobId, {
        reason,
        note: note.trim() || null,
        photo_keys: keys,
        verified_name: name,
        selfie_s3_key: selfieKey,
      });
      setSigning(false);
      setReason(null);
      setNote("");
      setPhotos([]);
      setTriedSend(false);
      Alert.alert(t("job2.late.sent"));
      onSent();
    } catch (e: any) {
      Alert.alert(t("job2.late.failed"), e?.message ?? "");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.head}>
        <FontAwesome5 name="exclamation-triangle" size={14} color="#DC2626" />
        <Text style={s.title}>{t("job2.late.cardTitle")}</Text>
      </View>
      <Text style={s.body}>{t("job2.late.cardBody", { limit: durationLabel(limitMin) })}</Text>

      <Text style={s.label}>
        {t("job2.late.reason")} <Text style={{ color: "#DC2626" }}>*</Text>
      </Text>
      {options.map((o) => {
        const on = reason === o.key;
        return (
          <Pressable key={o.key} style={[s.option, on && s.optionOn]} onPress={() => setReason(o.key)}>
            <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
            <FontAwesome5 name={o.icon as any} size={13} color={on ? "#DC2626" : "#6B7280"} />
            <View style={{ flex: 1 }}>
              <Text style={[s.optionText, on && { color: "#991B1B" }]}>{o.label}</Text>
              {!!o.hint && <Text style={s.optionHint}>{o.hint}</Text>}
            </View>
          </Pressable>
        );
      })}

      <Text style={s.label}>{t("job2.late.note")}</Text>
      <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
        value={note}
        onChangeText={setNote}
        placeholder={t("job2.late.notePlaceholder")}
        placeholderTextColor="#9CA3AF"
        style={[s.input, triedSend && noteMissing && { borderColor: "#DC2626" }]}
        multiline
        maxLength={300}
      />
      {triedSend && noteMissing && <Text style={s.error}>{t("job2.late.noteRequired")}</Text>}

      <View style={{ marginTop: 12 }}>
        <ImagePickerField
          title={t("job2.late.photos")}
          required
          value={photos}
          onChange={(m) => setPhotos(m.slice(0, 5))}
          showUploadButton={false}
        />
      </View>

      <Pressable
        style={[s.btn, !ready && { opacity: 0.5 }]}
        onPress={() => {
          setTriedSend(true);
          if (ready) setSigning(true);
        }}
      >
        <FontAwesome5 name="paper-plane" size={13} color="#fff" />
        <Text style={s.btnText}>{t("job2.late.send")}</Text>
      </Pressable>
      <Text style={s.repeat}>{t("job2.late.repeatNote", { repeat: durationLabel(repeatMin) })}</Text>

      <SignoffSheet
        visible={signing}
        verb="updating"
        action={t("job2.late.action")}
        detail={refLabel}
        submitting={sending}
        onCancel={() => !sending && setSigning(false)}
        onConfirm={send}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 20, borderWidth: 2, borderColor: "#FCA5A5", padding: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "800", color: "#991B1B" },
  body: { fontSize: 13, color: "#4B5563", marginTop: 6, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  optionOn: { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: "#DC2626" },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#DC2626" },
  optionText: { fontSize: 14, fontWeight: "700", color: "#111827" },
  optionHint: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    minHeight: 60,
    fontSize: 14,
    color: "#111827",
    textAlignVertical: "top",
  },
  error: { fontSize: 12, color: "#DC2626", fontWeight: "700", marginTop: 4 },
  btn: {
    marginTop: 14,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#DC2626",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  repeat: { fontSize: 12, color: "#6B7280", marginTop: 8, textAlign: "center" },
});
