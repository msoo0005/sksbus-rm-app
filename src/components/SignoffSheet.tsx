import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSession } from "../ctx";
import { useI18n } from "../i18n/i18n-ctx";
import { roleColorsFor } from "../utils/roles";
import { LocalMedia, pickImage, SELFIE_SIZE } from "./ImagePicker";
import { KeyboardDoneAccessory } from "@/components/KeyboardDone";
import { KEYBOARD_DISMISS_MODE } from "@/utils/keyboard";

export type SignoffVerb =
  | "submitting"
  | "approving"
  | "declining"
  | "accepting"
  | "completing"
  | "registering"
  | "recording"
  | "sendingBack"
  | "updating"
  | "counting";

type Props = {
  visible: boolean;
  /** Picks the title ("Who is approving?") and the button ("Sign & approve"). */
  verb: SignoffVerb;
  /** The bold line under "You are about to", e.g. "Approve job completion". */
  action: string;
  /** The grey line under it: reference, bus, … */
  detail?: string | null;
  /** Overrides "Who is <verb>?" when a section needs its own wording. */
  title?: string;
  /** Overrides "Sign & <verb>". */
  confirmLabel?: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (payload: { selfie: LocalMedia; name: string }) => void;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatNow(d: Date) {
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${h}:${m} ${d.getHours() >= 12 ? "pm" : "am"}`;
}

/**
 * S1–S3 · the one sign-off card used by every section: a front-camera selfie
 * and the signer's name. The name starts empty and is typed every time: a
 * sign-off is the person at the phone saying who they are, so it is never
 * filled in from the account. Nothing is saved until Sign; Cancel keeps the
 * screen as it was.
 * The server stores the selfie, the name as signed, the username, the role and
 * its own time on the step's event.
 */
export default function SignoffSheet({
  visible,
  verb,
  action,
  detail,
  title,
  confirmLabel,
  submitting = false,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  const { dbUser } = useSession();
  const color = roleColorsFor(dbUser?.user_role);

  const [selfie, setSelfie] = useState<LocalMedia | null>(null);
  const [name, setName] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!visible) return;
    setSelfie(null);
    setName("");
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [visible]);

  const takeSelfie = async () => {
    if (submitting) return;
    const result = await pickImage(
      true,
      ImagePicker.CameraType.front,
      {
        title: t("common.permissionRequired"),
        cameraBody: t("common.cameraPermissionBody"),
        galleryBody: t("common.galleryPermissionBody"),
      },
      SELFIE_SIZE,
    );
    if (result) setSelfie(result);
  };

  const canSign = !!selfie && name.trim().length > 0 && !submitting;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !submitting && onCancel()}>
      <KeyboardDoneAccessory />
      <KeyboardAvoidingView style={s.overlay} behavior="padding">
        {/* Scrolls when it doesn't fit: on an iPad held sideways the keyboard
            covers half the screen, and the Sign button used to end up out of
            reach behind it. */}
        <ScrollView
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={KEYBOARD_DISMISS_MODE}
          showsVerticalScrollIndicator={false}
        >
        <View style={s.card}>
          <View style={s.headRow}>
            <View style={[s.headIcon, { backgroundColor: color.light }]}>
              <Ionicons name="camera-outline" size={18} color={color.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{title ?? t(`signoff.who.${verb}`)}</Text>
              <Text style={s.subtitle}>{t("signoff.subtitle")}</Text>
            </View>
            <Pressable onPress={onCancel} disabled={submitting} hitSlop={10} style={s.close}>
              <Ionicons name="close" size={18} color="#374151" />
            </Pressable>
          </View>

          <View style={[s.aboutBox, { backgroundColor: color.light, borderColor: `${color.accent}33` }]}>
            <Text style={[s.aboutLabel, { color: color.accent }]}>{t("signoff.aboutTo")}</Text>
            <Text style={s.aboutAction}>{action}</Text>
            {!!detail && <Text style={s.aboutDetail}>{detail}</Text>}
          </View>

          <View style={s.body}>
            <Pressable
              onPress={takeSelfie}
              disabled={submitting}
              style={[s.selfie, { borderColor: color.accent, backgroundColor: selfie ? "#000" : color.light }]}
            >
              {selfie ? (
                <>
                  <Image source={{ uri: selfie.localUri }} style={s.selfieImg} />
                  <View style={s.retake}>
                    <Ionicons name="camera-reverse-outline" size={13} color="#fff" />
                    <Text style={s.retakeText}>{t("signoff.retake")}</Text>
                  </View>
                </>
              ) : (
                <>
                  <Ionicons name="camera-outline" size={26} color={color.accent} />
                  <Text style={[s.selfieText, { color: color.accent }]}>{t("signoff.tapSelfie")}</Text>
                </>
              )}
            </Pressable>

            <View style={s.nameCol}>
              <Text style={s.nameLabel}>{t("signoff.name")}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                style={[s.nameInput, { borderColor: color.accent }]}
                placeholder={t("signoff.namePlaceholder")}
                placeholderTextColor="#9CA3AF"
                autoCapitalize="words"
                autoCorrect={false}
                editable={!submitting}
                maxLength={150}
              />
              <Text style={s.fromProfile}>{t("signoff.nameHint")}</Text>
              <View style={s.userRow}>
                {!!dbUser?.username && <Text style={s.username}>@{dbUser.username}</Text>}
                {!!dbUser && (
                  <View style={[s.rolePill, { backgroundColor: color.light }]}>
                    <Text style={[s.roleText, { color: color.accent }]}>{t(`roles.${dbUser.user_role}`)}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          <View style={s.timeRow}>
            <Text style={s.time}>{formatNow(now)}</Text>
            {selfie ? (
              <Text style={[s.selfieState, { color: "#15803D" }]}>✓ {t("signoff.selfieTaken")}</Text>
            ) : (
              <View style={s.selfieNeeded}>
                <Ionicons name="camera-outline" size={13} color={color.accent} />
                <Text style={[s.selfieState, { color: color.accent }]}>{t("signoff.selfieNeeded")}</Text>
              </View>
            )}
          </View>

          <View style={s.buttons}>
            <Pressable style={s.cancelBtn} onPress={onCancel} disabled={submitting}>
              <Text style={s.cancelText}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable
              style={[s.signBtn, { backgroundColor: canSign ? color.accent : "#E5E7EB" }]}
              onPress={() => selfie && name.trim() && onConfirm({ selfie, name: name.trim() })}
              disabled={!canSign}
            >
              <Ionicons name="checkmark" size={16} color={canSign ? "#fff" : "#9CA3AF"} />
              <Text style={[s.signText, !canSign && { color: "#9CA3AF" }]}>
                {submitting ? t("signoff.signing") : confirmLabel ?? t(`signoff.sign.${verb}`)}
              </Text>
            </Pressable>
          </View>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.5)",
  },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 16 },
  card: { backgroundColor: "#fff", borderRadius: 22, padding: 16, maxWidth: 440, width: "100%", alignSelf: "center" },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "800", color: "#111827" },
  subtitle: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  close: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  aboutBox: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  aboutLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  aboutAction: { fontSize: 15, fontWeight: "800", color: "#111827", marginTop: 3 },
  aboutDetail: { fontSize: 12.5, color: "#4B5563", marginTop: 2 },
  body: { flexDirection: "row", gap: 12, marginTop: 14, alignItems: "flex-start" },
  selfie: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  selfieImg: { width: "100%", height: "100%" },
  selfieText: { fontSize: 12, fontWeight: "800", marginTop: 4, textAlign: "center" },
  retake: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  retakeText: { color: "#fff", fontSize: 11.5, fontWeight: "800" },
  nameCol: { flex: 1, minWidth: 0 },
  nameLabel: { fontSize: 11, fontWeight: "800", color: "#6B7280", letterSpacing: 0.6, marginBottom: 5 },
  nameInput: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 11 : 8,
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  fromProfile: { fontSize: 11.5, color: "#6B7280", marginTop: 5 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" },
  username: { fontSize: 12, color: "#4B5563", fontWeight: "600" },
  rolePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  roleText: { fontSize: 11, fontWeight: "800" },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  time: { fontSize: 12.5, color: "#374151", fontWeight: "600" },
  selfieNeeded: { flexDirection: "row", alignItems: "center", gap: 4 },
  selfieState: { fontSize: 12.5, fontWeight: "800" },
  buttons: { flexDirection: "row", gap: 10, marginTop: 14 },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "800", color: "#111827" },
  signBtn: {
    flex: 1.6,
    height: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  signText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
