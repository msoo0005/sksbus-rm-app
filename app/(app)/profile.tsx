import { Ionicons } from "@expo/vector-icons";
import * as ExpoImagePicker from "expo-image-picker";
import { useNavigation, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "@/api/client";
import { LocalMedia, pickImage, SELFIE_SIZE } from "@/components/ImagePicker";
import UserAvatar from "@/components/UserAvatar";
import { useSession } from "@/ctx";
import { useI18n } from "@/i18n/i18n-ctx";
import { ALL_PROJECTS, useProject } from "@/project-ctx";
import { roleColorsFor } from "@/utils/roles";

// The avatar is a small round picture; it doesn't need more than a selfie does.
const AVATAR_SIZE = SELFIE_SIZE;

/**
 * A6 · My profile: name and avatar. The name fills the home greeting and every
 * sign-off card. Username, role and project are read-only (set by the
 * administrator). Nothing is saved until Save changes.
 */
export default function MyProfileScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const navigation = useNavigation();
  const { dbUser, setDbUser } = useSession();
  const { projectId } = useProject();

  const initialName = dbUser?.full_name || dbUser?.user_name || "";
  const [name, setName] = React.useState(initialName);
  // undefined = unchanged; null = remove; LocalMedia = new photo.
  const [photo, setPhoto] = React.useState<LocalMedia | null | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);
  const [nameError, setNameError] = React.useState(false);

  const dirty = name.trim() !== initialName.trim() || photo !== undefined;
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty && !saving;

  // Back / Cancel asks first when something changed.
  React.useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e: any) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      Alert.alert(t("profile.discardTitle"), t("profile.discardBody"), [
        { text: t("profile.keepEditing"), style: "cancel" },
        {
          text: t("profile.discard"),
          style: "destructive",
          onPress: () => {
            dirtyRef.current = false;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return unsub;
  }, [navigation, t]);

  if (!dbUser) return null;
  const color = roleColorsFor(dbUser.user_role);

  const labels = {
    title: t("common.permissionRequired"),
    cameraBody: t("common.cameraPermissionBody"),
    galleryBody: t("common.galleryPermissionBody"),
  };
  const take = async (fromCamera: boolean) => {
    const res = await pickImage(fromCamera, fromCamera ? ExpoImagePicker.CameraType.front : undefined, labels, AVATAR_SIZE);
    if (res) setPhoto(res);
  };

  const shownPhoto =
    photo === undefined ? dbUser.avatar_url ?? null : photo === null ? null : photo.localUri;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    setSaving(true);
    try {
      let me = dbUser;
      if (photo === null) {
        me = await api.setMyAvatar(null);
      } else if (photo) {
        const presign = await api.presignMyAvatar(photo.mime_type);
        const blob = await (await fetch(photo.localUri)).blob();
        const put = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": photo.mime_type },
          body: blob,
        });
        if (!put.ok) throw new Error(t("profile.photoFailed"));
        me = await api.setMyAvatar(presign.s3_key);
      }
      if (trimmed !== initialName.trim()) {
        me = await api.updateMyProfile({ full_name: trimmed });
      }
      setDbUser(me);
      dirtyRef.current = false;
      router.back();
    } catch (e: any) {
      Alert.alert(t("profile.saveFailed"), e?.message ?? "");
    } finally {
      setSaving(false);
    }
  };

  const projectLabel =
    projectId === ALL_PROJECTS ? t("account.allProjects") : projectId ? String(projectId) : "—";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <View style={s.avatarWrap}>
            <View style={[s.avatarRing, { borderColor: `${color.accent}55` }]}>
              <UserAvatar name={name || initialName} photoUrl={shownPhoto} role={dbUser.user_role} size={120} />
            </View>
            <Pressable style={[s.cameraBadge, { backgroundColor: color.accent }]} onPress={() => take(true)}>
              <Ionicons name="camera" size={16} color="#fff" />
            </Pressable>
          </View>
          <View style={s.photoButtons}>
            <Pressable style={[s.photoBtn, { borderColor: `${color.accent}33`, backgroundColor: color.light }]} onPress={() => take(true)}>
              <Ionicons name="camera-outline" size={16} color={color.accent} />
              <Text style={[s.photoBtnText, { color: color.accent }]}>{t("profile.takePhoto")}</Text>
            </Pressable>
            <Pressable style={[s.photoBtn, { borderColor: `${color.accent}33`, backgroundColor: color.light }]} onPress={() => take(false)}>
              <Ionicons name="image-outline" size={16} color={color.accent} />
              <Text style={[s.photoBtnText, { color: color.accent }]}>{t("profile.choosePhoto")}</Text>
            </Pressable>
            {!!shownPhoto && (
              <Pressable
                style={[s.photoBtn, s.removeBtn]}
                onPress={() => setPhoto(null)}
                accessibilityLabel={t("profile.removePhoto")}
              >
                <Ionicons name="trash-outline" size={16} color="#DC2626" />
              </Pressable>
            )}
          </View>
          <Text style={s.hint}>{t("profile.photoHint")}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.label}>
            {t("profile.nameLabel")} <Text style={{ color: "#DC2626" }}>*</Text>
          </Text>
          <TextInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              if (v.trim()) setNameError(false);
            }}
            maxLength={150}
            style={[s.input, { borderColor: nameError ? "#DC2626" : color.accent }]}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!saving}
          />
          {nameError ? (
            <Text style={s.error}>{t("profile.nameRequired")}</Text>
          ) : (
            <Text style={s.hint}>{t("profile.nameHint", { name: name.trim() || initialName })}</Text>
          )}

          <Text style={[s.label, s.gap]}>{t("profile.username")}</Text>
          <LockedField>
            <Text style={s.lockedText}>{dbUser.username ? `@${dbUser.username}` : "—"}</Text>
          </LockedField>

          <Text style={[s.label, s.gap]}>{t("profile.role")}</Text>
          <LockedField>
            <View style={[s.rolePill, { backgroundColor: color.light }]}>
              <Text style={[s.rolePillText, { color: color.accent }]}>{t(`roles.${dbUser.user_role}`)}</Text>
            </View>
          </LockedField>

          <Text style={[s.label, s.gap]}>{t("profile.project")}</Text>
          <LockedField>
            <Text style={s.lockedText}>{projectLabel}</Text>
          </LockedField>

          <View style={s.note}>
            <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
            <Text style={s.noteText}>{t("profile.adminNote")}</Text>
          </View>
        </View>

        <View style={s.buttons}>
          <Pressable style={s.cancelBtn} onPress={() => router.back()} disabled={saving}>
            <Text style={s.cancelText}>{t("common.cancel")}</Text>
          </Pressable>
          <Pressable
            style={[s.saveBtn, { backgroundColor: color.accent }, (!dirty || saving) && { opacity: 0.5 }]}
            onPress={save}
            disabled={!dirty || saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>{t("profile.save")}</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function LockedField({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.locked}>
      <View style={{ flex: 1 }}>{children}</View>
      <Ionicons name="lock-closed-outline" size={16} color="#9CA3AF" />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#F3F4F6",
    padding: 18,
  },
  avatarWrap: { alignSelf: "center", marginBottom: 14 },
  avatarRing: { borderWidth: 3, borderRadius: 70, padding: 4 },
  cameraBadge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  photoButtons: { flexDirection: "row", justifyContent: "center", gap: 8 },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  removeBtn: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  photoBtnText: { fontSize: 13.5, fontWeight: "800" },
  hint: { fontSize: 12.5, color: "#6B7280", marginTop: 8, lineHeight: 17, textAlign: "left" },
  error: { fontSize: 12.5, color: "#DC2626", marginTop: 6, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "800", color: "#374151", marginBottom: 6 },
  gap: { marginTop: 16 },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 13 : 10,
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  locked: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  lockedText: { fontSize: 15, color: "#4B5563", fontWeight: "600" },
  rolePill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  rolePillText: { fontSize: 12.5, fontWeight: "800" },
  note: {
    flexDirection: "row",
    gap: 8,
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  noteText: { flex: 1, fontSize: 12.5, color: "#4B5563", lineHeight: 17 },
  buttons: { flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 15.5, fontWeight: "800", color: "#111827" },
  saveBtn: { flex: 2, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveText: { fontSize: 15.5, fontWeight: "800", color: "#fff" },
});
