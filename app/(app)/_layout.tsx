import { Ionicons } from "@expo/vector-icons";
import { Stack, usePathname, useRouter } from "expo-router";
import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../api/client";
import { useSession } from "../ctx";
import { useI18n } from "../i18n/i18n-ctx";
import { LANGUAGE_LABELS, Language } from "../i18n/translations";

// Native stack header height when no large title is used.
const HEADER_HEIGHT = Platform.OS === "ios" ? 44 : 56;

type RoleKey =
  | "admin"
  | "driver"
  | "fleet_manager"
  | "rm_manager"
  | "technician"
  | "inventory_manager";

const ROLE_ALLOWED_PREFIXES: Record<RoleKey, string[]> = {
  admin: ["/fleet-manager", "/rm-manager", "/technician", "/inventory", "/form", "/project-selector", "/buses", "/notifications"],
  fleet_manager: ["/fleet-manager-home", "/fleet-manager", "/form", "/project-selector"],
  rm_manager: ["/rm-manager-home", "/rm-manager", "/notifications", "/project-selector"],
  technician: ["/technician-home", "/technician", "/notifications"],
  inventory_manager: ["/inventory"],
  driver: ["/form", "/project-selector"],
};

// Roles that receive in-app notifications (per the feature's scope).
const NOTIFIABLE_ROLES = new Set(["admin", "rm_manager", "technician"]);

const ROLE_HOME: Record<RoleKey, string> = {
  admin: "/",
  fleet_manager: "/fleet-manager-home",
  rm_manager: "/rm-manager-home",
  technician: "/technician-home",
  inventory_manager: "/inventory",
  driver: "/project-selector",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  fleet_manager: "Fleet Manager",
  rm_manager: "R&M Manager",
  technician: "Technician",
  inventory_manager: "Inventory Manager",
  driver: "Driver",
};

// Same accent system used across HomeHeader / the home-screen module cards,
// so the avatar reads as one consistent identity color for a given role.
const ROLE_COLORS: Record<string, { accent: string; light: string }> = {
  admin: { accent: "#4338CA", light: "#EEF2FF" },
  fleet_manager: { accent: "#2563EB", light: "#EFF6FF" },
  rm_manager: { accent: "#16A34A", light: "#F0FDF4" },
  technician: { accent: "#EA580C", light: "#FFF7ED" },
  inventory_manager: { accent: "#7C3AED", light: "#F5F3FF" },
  driver: { accent: "#2563EB", light: "#EFF6FF" },
};
const DEFAULT_ROLE_COLOR = ROLE_COLORS.driver;

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function RouteGuard() {
  const { dbUser } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    if (!dbUser) return;
    if (pathname === "/" || pathname === "") return;

    const role = (dbUser.user_role ?? "driver") as RoleKey;
    const allowed = ROLE_ALLOWED_PREFIXES[role] ?? [];
    const isAllowed = allowed.some((prefix) => pathname.startsWith(prefix));

    if (!isAllowed) {
      router.replace(ROLE_HOME[role] as any);
    }
  }, [pathname, dbUser]);

  return null;
}

// Rendered as a floating overlay above the Stack rather than through
// headerRight — on iOS 26, native headerRight content is wrapped in a
// UIBarButtonItem, and the OS unconditionally draws its own "Liquid Glass"
// pill background behind it with no opt-out. Floating outside the native
// header sidesteps that entirely.
function FloatingHeaderButtons({
  onAvatarPress,
  onLanguagePress,
}: {
  onAvatarPress: () => void;
  onLanguagePress: () => void;
}) {
  const { dbUser } = useSession();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = React.useState(0);

  const canSeeNotifications = !!dbUser && NOTIFIABLE_ROLES.has(dbUser.user_role);

  const refreshUnreadCount = React.useCallback(async () => {
    try {
      const { count } = await api.unreadNotificationCount();
      setUnreadCount(count);
    } catch {
      // best-effort — badge just skips this refresh cycle
    }
  }, []);

  React.useEffect(() => {
    if (!canSeeNotifications) return;
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, 30_000);
    return () => clearInterval(interval);
  }, [canSeeNotifications, refreshUnreadCount]);

  if (!dbUser) return null;

  const initials = getInitials(dbUser.user_name || dbUser.user_email);
  const color = ROLE_COLORS[dbUser.user_role] ?? DEFAULT_ROLE_COLOR;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.floatingWrap,
        { top: insets.top + (HEADER_HEIGHT - 34) / 2 },
      ]}
    >
      <Pressable
        onPress={onLanguagePress}
        style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.75 }]}
      >
        <Ionicons name="globe-outline" size={19} color="#374151" />
      </Pressable>

      {canSeeNotifications && (
        <Pressable
          onPress={() => router.push("/notifications")}
          style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="notifications-outline" size={19} color="#374151" />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </Text>
            </View>
          )}
        </Pressable>
      )}

      <Pressable
        onPress={onAvatarPress}
        style={({ pressed }) => [
          styles.avatarBtn,
          { backgroundColor: color.accent },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={styles.avatarText}>{initials}</Text>
      </Pressable>
    </View>
  );
}

// Modal lives at layout root level, outside the Stack header tree
function ProfileModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { dbUser, signOut } = useSession();
  const insets = useSafeAreaInsets();

  const { t } = useI18n();

  const handleSignOut = async () => {
    onClose();
    await signOut();
    router.replace("/sign-in");
  };

  if (!dbUser) return null;

  const initials = getInitials(dbUser.user_name || dbUser.user_email);
  const roleLabel = ROLE_LABEL[dbUser.user_role]
    ? t(`roles.${dbUser.user_role}`)
    : dbUser.user_role;
  const color = ROLE_COLORS[dbUser.user_role] ?? DEFAULT_ROLE_COLOR;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, { paddingTop: insets.top + HEADER_HEIGHT + 6 }]}
        onPress={onClose}
      >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View
            style={[styles.avatarLarge, { backgroundColor: color.accent }]}
          >
            <Text style={styles.avatarLargeText}>{initials}</Text>
          </View>

          <Text style={styles.name}>{dbUser.user_name}</Text>
          <Text style={styles.email}>{dbUser.user_email}</Text>

          <View style={[styles.roleBadge, { backgroundColor: color.light }]}>
            <View style={[styles.roleDot, { backgroundColor: color.accent }]} />
            <Text style={[styles.roleBadgeText, { color: color.accent }]}>
              {roleLabel}
            </Text>
          </View>

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [
              styles.signOutBtn,
              pressed && { opacity: 0.85 },
            ]}
            onPress={handleSignOut}
          >
            <Ionicons name="log-out-outline" size={17} color="#DC2626" />
            <Text style={styles.signOutText}>{t("chrome.signOut")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const LANGUAGE_OPTIONS: Language[] = ["en", "ms"];

// Modal lives at layout root level, outside the Stack header tree — same
// pattern as ProfileModal. Persisted language selection takes effect
// immediately across the whole app since every t() call reads from context.
function LanguagePickerModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { language, setLanguage, t } = useI18n();
  const insets = useSafeAreaInsets();

  const handleSelect = async (lang: Language) => {
    await setLanguage(lang);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, { paddingTop: insets.top + HEADER_HEIGHT + 6 }]}
        onPress={onClose}
      >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.languageHeaderRow}>
            <Ionicons name="globe-outline" size={18} color="#374151" />
            <Text style={styles.languageTitle}>{t("common.selectLanguage")}</Text>
          </View>

          {LANGUAGE_OPTIONS.map((lang) => {
            const selected = lang === language;
            return (
              <Pressable
                key={lang}
                style={({ pressed }) => [
                  styles.languageRow,
                  selected && styles.languageRowSelected,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => handleSelect(lang)}
              >
                <Text
                  style={[
                    styles.languageRowText,
                    selected && styles.languageRowTextSelected,
                  ]}
                >
                  {LANGUAGE_LABELS[lang]}
                </Text>
                {selected && (
                  <Ionicons name="checkmark-circle" size={18} color="#4338CA" />
                )}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function RootLayout() {
  const { t } = useI18n();
  const [profileVisible, setProfileVisible] = React.useState(false);
  const [languageVisible, setLanguageVisible] = React.useState(false);

  return (
    <View style={styles.root}>
      <RouteGuard />
      <ProfileModal
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
      />
      <LanguagePickerModal
        visible={languageVisible}
        onClose={() => setLanguageVisible(false)}
      />
      <Stack>
        <Stack.Screen name="index" options={{ title: "Home" }} />
        <Stack.Screen name="fleet-manager-home" options={{ title: "Home" }} />
        <Stack.Screen name="fleet-manager" options={{ title: t("adminHome.fleetManagerTitle") }} />
        <Stack.Screen
          name="project-selector"
          options={{ title: t("projectSelector.title") }}
        />
        <Stack.Screen
          name="fleet-manager-history"
          options={{ title: "Your Submitted Reports" }}
        />
        <Stack.Screen name="rm-manager-home" options={{ title: "Home" }} />
        <Stack.Screen name="rm-manager" options={{ title: "R&M Manager" }} />
        <Stack.Screen name="rm-manager/job/[id]" options={{ title: "Job Details" }} />
        <Stack.Screen name="rm-manager/tyres" options={{ title: "Tyre Management" }} />
        <Stack.Screen name="rm-manager/tyres/[busId]" options={{ title: "Bus Tyres" }} />
        <Stack.Screen
          name="rm-manager/tyres/inspection/[sessionId]"
          options={{ title: "Inspection Details" }}
        />
        <Stack.Screen name="technician-home" options={{ title: "Home" }} />
        <Stack.Screen name="technician/index" options={{ title: "Technician" }} />
        <Stack.Screen name="technician/job/[id]" options={{ title: "Job Details" }} />
        <Stack.Screen name="technician/tyres" options={{ title: "Tyre Inspections" }} />
        <Stack.Screen
          name="technician/tyre-inspection/[busId]"
          options={{ title: "Tyre Inspection" }}
        />
        <Stack.Screen name="inventory" options={{ title: t("inventory.navTitle") }} />
        <Stack.Screen name="form" options={{ title: t("reportForm.title") }} />
        <Stack.Screen name="buses" options={{ title: t("buses.navTitle") }} />
        <Stack.Screen name="notifications" options={{ title: t("notifications.navTitle") }} />
      </Stack>
      <FloatingHeaderButtons
        onAvatarPress={() => setProfileVisible(true)}
        onLanguagePress={() => setLanguageVisible(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  floatingWrap: {
    position: "absolute",
    right: 16,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatarBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  bellBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#F9FAFB",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.35)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingRight: 16,
  },
  sheet: {
    backgroundColor: "#fff",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#F3F4F6",
    padding: 24,
    width: 288,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 12,
  },

  avatarLarge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  avatarLargeText: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  name: {
    fontSize: 17,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    marginBottom: 3,
  },
  email: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 14,
  },

  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 999,
  },
  roleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  divider: {
    width: "100%",
    height: 1,
    backgroundColor: "#F3F4F6",
    marginVertical: 18,
  },

  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    height: 48,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  signOutText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#DC2626",
  },

  languageHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  languageTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  languageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  languageRowSelected: {},
  languageRowText: { fontSize: 15, fontWeight: "600", color: "#374151" },
  languageRowTextSelected: { color: "#4338CA", fontWeight: "800" },
});
