import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import React from "react";
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/ctx";
import { useI18n } from "@/i18n/i18n-ctx";
import { LANGUAGE_LABELS } from "@/i18n/translations";
import { ALL_PROJECTS, useProject } from "@/project-ctx";
import { roleColorsFor } from "@/utils/roles";
import UserAvatar from "./UserAvatar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Nov 2026" from the build's extra.releaseDate ("2026-11-12"). */
function formatRelease(iso?: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

type Props = {
  visible: boolean;
  topOffset: number;
  onClose: () => void;
  onOpenLanguage: () => void;
};

/**
 * A5: the account menu under the avatar, the same for every role in its role
 * colour. My profile, Language (replaces the globe that was in the header),
 * Sign out, and the version card read from the installed build.
 */
export default function AccountMenu({ visible, topOffset, onClose, onOpenLanguage }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { dbUser, signOut } = useSession();
  const { projectId } = useProject();
  const { t, language } = useI18n();

  if (!dbUser) return null;

  const color = roleColorsFor(dbUser.user_role);
  const name = dbUser.full_name || dbUser.user_name || dbUser.user_email || "";
  const projectLabel =
    projectId === ALL_PROJECTS ? t("account.allProjects") : projectId ? String(projectId) : null;
  const version = Constants.expoConfig?.version ?? "";
  const released = formatRelease((Constants.expoConfig?.extra as any)?.releaseDate);

  const confirmSignOut = () => {
    const go = async () => {
      onClose();
      await signOut();
      router.replace("/sign-in");
    };
    if (Platform.OS === "web") {
      // Alert with buttons is a no-op on web.
      if (globalThis.confirm?.(t("account.signOutConfirmTitle"))) go();
      return;
    }
    Alert.alert(t("account.signOutConfirmTitle"), t("account.signOutConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("account.signOut"), style: "destructive", onPress: go },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[s.backdrop, { paddingTop: insets.top + topOffset }]} onPress={onClose}>
        <Pressable style={s.menu} onPress={(e) => e.stopPropagation()}>
          <View style={s.userBlock}>
            <UserAvatar name={name} photoUrl={dbUser.avatar_url} role={dbUser.user_role} size={52} />
            <View style={s.userText}>
              <Text style={s.name} numberOfLines={1}>{name}</Text>
              {!!dbUser.username && <Text style={s.username} numberOfLines={1}>@{dbUser.username}</Text>}
              <View style={s.pills}>
                <View style={[s.pill, { backgroundColor: color.light }]}>
                  <Text style={[s.pillText, { color: color.accent }]}>{t(`roles.${dbUser.user_role}`)}</Text>
                </View>
                {!!projectLabel && (
                  <View style={[s.pill, s.projectPill]}>
                    <Text style={[s.pillText, { color: "#374151" }]} numberOfLines={1}>{projectLabel}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            onPress={() => {
              onClose();
              router.push("/profile" as any);
            }}
          >
            <Ionicons name="person-outline" size={19} color="#374151" />
            <Text style={s.rowText}>{t("account.myProfile")}</Text>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </Pressable>

          <Pressable
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            onPress={() => {
              onClose();
              onOpenLanguage();
            }}
          >
            <Ionicons name="globe-outline" size={19} color="#374151" />
            <Text style={s.rowText}>{t("account.language")}</Text>
            <Text style={s.rowValue}>{LANGUAGE_LABELS[language]}</Text>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </Pressable>

          <Pressable style={({ pressed }) => [s.row, pressed && s.rowPressed]} onPress={confirmSignOut}>
            <Ionicons name="log-out-outline" size={19} color="#DC2626" />
            <Text style={[s.rowText, { color: "#DC2626" }]}>{t("account.signOut")}</Text>
          </Pressable>

          <View style={[s.versionCard, { backgroundColor: color.light, borderColor: `${color.accent}33` }]}>
            <Ionicons name="information-circle-outline" size={20} color={color.accent} />
            <View>
              <Text style={[s.appName, { color: color.accent }]}>{t("account.appName")}</Text>
              <Text style={s.version}>{t("account.version", { version })}</Text>
              {!!released && <Text style={s.released}>{t("account.released", { date: released })}</Text>}
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.35)",
    alignItems: "flex-end",
    paddingRight: 12,
  },
  menu: {
    width: 300,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 12,
  },
  userBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  userText: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: "800", color: "#111827" },
  username: { fontSize: 13, fontWeight: "600", color: "#6B7280", marginTop: 1 },
  pills: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  projectPill: { backgroundColor: "#F3F4F6", maxWidth: 120 },
  pillText: { fontSize: 11.5, fontWeight: "800" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1, fontSize: 15, fontWeight: "700", color: "#111827" },
  rowValue: { fontSize: 13.5, color: "#6B7280", fontWeight: "600" },
  versionCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  appName: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  version: { fontSize: 17, fontWeight: "800", color: "#111827" },
  released: { fontSize: 12.5, color: "#6B7280", fontWeight: "600" },
});
