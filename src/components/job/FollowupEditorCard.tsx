import { FontAwesome5 } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useI18n } from "../../i18n/i18n-ctx";
import ImagePickerField, { LocalMedia } from "../ImagePicker";
import { KEYBOARD_DONE_ID } from "@/components/KeyboardDone";

export type FollowupDraft = { issue: string; action: string; photos: LocalMedia[] };
export const emptyFollowupDraft = (): FollowupDraft => ({ issue: "", action: "", photos: [] });

const MAX_PHOTOS = 5;
const MAX_LEN = 300;

type Props = {
  n: number;
  accent: string;
  saving?: boolean;
  /** Called with a complete draft; the screen uploads and saves it. */
  onSave: (draft: FollowupDraft) => Promise<boolean>;
};

/**
 * C3 · Add Follow-up: the same pattern as Add Task. Issue, required action and
 * 1–5 photos are all required. Saving clears the form for the next one.
 */
export default function FollowupEditorCard({ n, accent, saving = false, onSave }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<FollowupDraft>(emptyFollowupDraft);
  const [errors, setErrors] = useState<{ issue?: boolean; action?: boolean; photos?: boolean }>({});

  const submit = async () => {
    const e = {
      issue: !draft.issue.trim(),
      action: !draft.action.trim(),
      photos: draft.photos.length < 1,
    };
    setErrors(e);
    if (e.issue || e.action || e.photos) return;
    const ok = await onSave({ ...draft, issue: draft.issue.trim(), action: draft.action.trim() });
    if (ok) {
      setDraft(emptyFollowupDraft());
      setErrors({});
    }
  };

  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={s.num}>
          <Text style={s.numText}>{n}</Text>
        </View>
        <View>
          <Text style={s.title}>{t("job2.followups.followUp", { n })}</Text>
          <Text style={s.sub}>{t("job2.followups.notFinished")}</Text>
        </View>
      </View>

      <Text style={s.label}>
        {t("job2.followups.issue")} <Text style={s.req}>*</Text>
      </Text>
      <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
        value={draft.issue}
        onChangeText={(v) => {
          setDraft((d) => ({ ...d, issue: v }));
          if (v.trim()) setErrors((x) => ({ ...x, issue: false }));
        }}
        placeholder={t("job2.followups.issuePlaceholder")}
        placeholderTextColor="#9CA3AF"
        style={[s.input, errors.issue && s.inputError]}
        multiline
        maxLength={MAX_LEN}
        editable={!saving}
      />
      {errors.issue && <Text style={s.error}>{t("job2.followups.enterIssue")}</Text>}

      <Text style={s.label}>
        {t("job2.followups.action")} <Text style={s.req}>*</Text>
      </Text>
      <TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}
        value={draft.action}
        onChangeText={(v) => {
          setDraft((d) => ({ ...d, action: v }));
          if (v.trim()) setErrors((x) => ({ ...x, action: false }));
        }}
        placeholder={t("job2.followups.actionPlaceholder")}
        placeholderTextColor="#9CA3AF"
        style={[s.input, errors.action && s.inputError]}
        multiline
        maxLength={MAX_LEN}
        editable={!saving}
      />
      {errors.action && <Text style={s.error}>{t("job2.followups.enterAction")}</Text>}

      <View style={{ marginTop: 12 }}>
        <ImagePickerField
          title={t("job2.followups.photos")}
          required
          value={draft.photos}
          onChange={(m) => {
            setDraft((d) => ({ ...d, photos: m.slice(0, MAX_PHOTOS) }));
            if (m.length) setErrors((x) => ({ ...x, photos: false }));
          }}
          disabled={saving}
          limit={MAX_PHOTOS}
        />
        {errors.photos && <Text style={s.error}>{t("job2.followups.addPhoto")}</Text>}
      </View>

      <Pressable
        style={({ pressed }) => [s.btn, { backgroundColor: accent }, (pressed || saving) && { opacity: 0.75 }]}
        onPress={submit}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <FontAwesome5 name="check" size={13} color="#fff" />
            <Text style={s.btnText}>{t("job2.followups.add")}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#F3F4F6", borderRadius: 14, padding: 14, backgroundColor: "#fff", marginTop: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFF7ED", alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 12, fontWeight: "800", color: "#C4501A" },
  title: { fontSize: 15, fontWeight: "800", color: "#111827" },
  sub: { fontSize: 12, color: "#C4501A", fontWeight: "600" },
  label: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  req: { color: "#DC2626" },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    minHeight: 64,
    textAlignVertical: "top",
  },
  inputError: { borderColor: "#DC2626" },
  error: { fontSize: 12, color: "#DC2626", fontWeight: "700", marginTop: 4 },
  btn: {
    marginTop: 14,
    height: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
