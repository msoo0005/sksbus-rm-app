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
import { api } from "@/api/client";
import AccountMenu from "@/components/AccountMenu";
import UserAvatar from "@/components/UserAvatar";
import { useSession } from "@/ctx";
import { useProject } from "@/project-ctx";
import { ROLE_HOME, type RoleKey } from "@/utils/roles";
import { useI18n } from "@/i18n/i18n-ctx";
import { LANGUAGE_LABELS, Language } from "@/i18n/translations";

// Native stack header height when no large title is used.
const HEADER_HEIGHT = Platform.OS === "ios" ? 44 : 56;
// Leaves room for the floating controls overlaying the right of the header.
const HEADER_TITLE_MAX_WIDTH = 190;


const ROLE_ALLOWED_PREFIXES: Record<RoleKey, string[]> = {
  admin: ["/profile", "/job/", "/fleet-manager", "/rm-manager", "/technician", "/inventory", "/form", "/project-selector", "/buses", "/notifications", "/inspection-record", "/tyres", "/performance", "/puspakom"],
  // /rm-manager/job: "View report" from a bus history opens the job (read-only).
  fleet_manager: ["/profile", "/job/", "/fleet-manager-home", "/fleet-manager", "/form", "/project-selector", "/performance", "/rm-manager/job", "/puspakom", "/notifications"],
  rm_manager: ["/profile", "/job/", "/rm-manager-home", "/rm-manager", "/notifications", "/project-selector", "/inspection-record", "/tyres", "/inventory", "/performance", "/puspakom"],
  technician: ["/profile", "/job/", "/technician-home", "/technician", "/notifications", "/project-selector", "/inspection-record", "/tyres", "/puspakom"],
  inventory_manager: ["/profile", "/inventory", "/project-selector"],
  driver: ["/profile", "/form", "/project-selector"],
};

// Roles that receive in-app notifications (per the feature's scope).
// fleet_manager joined with PUSPAKOM (v2.0.0): pre-inspection submitted, a bus
// turning Not booked / Overdue, and inspections waiting for a result.
const NOTIFIABLE_ROLES = new Set(["admin", "rm_manager", "technician", "fleet_manager"]);



// EVERY role picks a project before it can reach anything else. The screens
// below are all scoped to one, so landing on them without a selection would show
// either nothing or the wrong fleet.
//
// Admin used to be exempt, on the grounds that its home is the cross-project
// console. It is gated now like everyone else and keeps that console by choosing
// "All projects" on the selector, which is a real choice that happens to apply no
// filter — see ALL_PROJECTS in project-ctx.
const PROJECT_SELECTOR = "/project-selector";

function RouteGuard() {
  const { dbUser } = useSession();
  const { hasChosen, loading: projectLoading } = useProject();
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    if (!dbUser) return;

    const role = (dbUser.user_role ?? "driver") as RoleKey;

    // The project gate runs FIRST and covers "/" too, which the role check
    // below skips — otherwise a user would sit on their home screen with
    // unscoped data until they happened to navigate somewhere.
    //
    // Keyed on hasChosen, not on the project id: an admin who chose "All
    // projects" has chosen, even though that applies no filter.
    //
    // Waits for the stored selection to load, or it would bounce a user who
    // already has a project straight back to the selector on every cold start.
    if (!projectLoading && !hasChosen) {
      if (!pathname.startsWith(PROJECT_SELECTOR)) {
        router.replace(PROJECT_SELECTOR as any);
      }
      return;
    }

    if (pathname === "/" || pathname === "") return;

    const allowed = ROLE_ALLOWED_PREFIXES[role] ?? [];
    const isAllowed = allowed.some((prefix) => pathname.startsWith(prefix));

    if (!isAllowed) {
      router.replace(ROLE_HOME[role] as any);
    }
  }, [pathname, dbUser, hasChosen, projectLoading, router]);

  return null;
}

// Rendered as a floating overlay above the Stack rather than through
// headerRight — on iOS 26, native headerRight content is wrapped in a
// UIBarButtonItem, and the OS unconditionally draws its own "Liquid Glass"
// pill background behind it with no opt-out. Floating outside the native
// header sidesteps that entirely.
function FloatingHeaderButtons({ onAvatarPress }: { onAvatarPress: () => void }) {
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

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.floatingWrap,
        { top: insets.top + (HEADER_HEIGHT - 34) / 2 },
      ]}
    >
      {/* v2.0.0: the language globe moved into the account menu (A5). */}

      {canSeeNotifications && (
        <Pressable
          onPress={() => router.push("/notifications")}
          style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="notifications-outline" size={19} color="#374151" />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </Text>
            </View>
          )}
        </Pressable>
      )}

      <Pressable
        onPress={onAvatarPress}
        style={({ pressed }) => [styles.avatarBtn, pressed && { opacity: 0.8 }]}
        accessibilityRole="button"
        accessibilityLabel={dbUser.full_name || dbUser.user_name}
      >
        <UserAvatar
          name={dbUser.full_name || dbUser.user_name || dbUser.user_email}
          photoUrl={dbUser.avatar_url}
          role={dbUser.user_role}
          size={34}
        />
      </Pressable>
    </View>
  );
}

const LANGUAGE_OPTIONS: Language[] = ["en", "ms"];

// Modal lives at layout root level, outside the Stack header tree, like the
// account menu. Persisted language selection takes effect
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

// A4: while an administrator is inside a role's screens, a thin charcoal bar
// says whose screens they are in, with a way back to the admin home.
const ADMIN_VIEW_PREFIXES: { prefix: string; role: RoleKey }[] = [
  { prefix: "/fleet-manager", role: "fleet_manager" },
  { prefix: "/form", role: "fleet_manager" },
  { prefix: "/rm-manager", role: "rm_manager" },
  { prefix: "/technician", role: "technician" },
];

function AdminViewingBar() {
  const { dbUser } = useSession();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  if (dbUser?.user_role !== "admin") return null;
  const hit = ADMIN_VIEW_PREFIXES.find((p) => pathname.startsWith(p.prefix));
  if (!hit) return null;
  return (
    <View style={[styles.adminBar, { top: insets.top + HEADER_HEIGHT }]}>
      <Ionicons name="shield-checkmark" size={13} color="#fff" />
      <Text style={styles.adminBarText} numberOfLines={1}>
        {t("account.viewingAs", { role: t(`roles.${hit.role}`) })}
      </Text>
      <Pressable onPress={() => router.replace("/" as any)} hitSlop={8}>
        <Text style={styles.adminBarLink}>{t("account.backToAdmin")}</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const { t } = useI18n();
  const [menuVisible, setMenuVisible] = React.useState(false);
  const [languageVisible, setLanguageVisible] = React.useState(false);

  return (
    <View style={styles.root}>
      <RouteGuard />
      <AccountMenu
        visible={menuVisible}
        topOffset={HEADER_HEIGHT + 6}
        onClose={() => setMenuVisible(false)}
        onOpenLanguage={() => setLanguageVisible(true)}
      />
      <LanguagePickerModal
        visible={languageVisible}
        onClose={() => setLanguageVisible(false)}
      />
      <Stack
        screenOptions={{
          // Keep the native title clear of FloatingHeaderButtons.
          //
          // Those three controls are absolutely positioned over the header at
          // right: 16 with zIndex 20, because native headerRight gets wrapped in
          // a "Liquid Glass" pill on iOS 26 with no opt-out (see the note on
          // FloatingHeaderButtons). The cost is that the native title lays out at
          // full width underneath them, so a long one — "Tyre Summary and Data",
          // "Bus Inspection Record" — renders straight through the buttons.
          //
          // Constraining the title's own width makes it ellipsise before it gets
          // there, without handing anything back to headerRight.
          headerTitle: ({ children }) => (
            <Text style={styles.headerTitle} numberOfLines={1}>
              {children}
            </Text>
          ),
        }}
      >
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
        <Stack.Screen name="rm-manager/review/[id]" options={{ title: t("job2.review.title") }} />
        <Stack.Screen name="job/[id]" options={{ title: t("job2.jobReport") }} />
        <Stack.Screen name="tyres/index" options={{ title: t("tyres.nav.hub") }} />
        {/* These two set their own titles from the bus they are showing — a
            static "Bus Tyres" three levels down says nothing about which bus
            you are on. The tyre record below keeps a static title as its
            pre-load fallback and swaps in the serial once it has one. */}
        <Stack.Screen name="tyres/buses/[busId]/index" />
        <Stack.Screen name="tyres/buses/[busId]/inspect" />
        <Stack.Screen name="tyres/tyre/[tyreId]" options={{ title: t("tyres.nav.tyreDetails") }} />
        <Stack.Screen name="inspection-record/[sessionId]" options={{ title: "Inspection Record" }} />
        <Stack.Screen name="technician-home" options={{ title: "Home" }} />
        <Stack.Screen name="technician/index" options={{ title: "Technician" }} />
        <Stack.Screen name="technician/job/[id]" options={{ title: "Job Details" }} />
        <Stack.Screen name="technician/job-order" options={{ title: t("jobOrder.navTitle") }} />
        <Stack.Screen name="performance/index" options={{ title: t("performance.navTitle") }} />
        <Stack.Screen name="performance/bus/[busId]" options={{ title: t("performance.busHistoryTitle") }} />
        <Stack.Screen name="performance/export" options={{ title: t("performance.exportTitle") }} />
        <Stack.Screen name="inventory" options={{ title: t("inventory.navTitle") }} />
        <Stack.Screen name="form" options={{ title: t("reportForm.title") }} />
        <Stack.Screen name="buses" options={{ title: t("buses.navTitle") }} />
        <Stack.Screen name="notifications" options={{ title: t("notifications.navTitle") }} />
        <Stack.Screen name="profile" options={{ title: t("profile.title") }} />
        <Stack.Screen name="puspakom/index" options={{ title: t("puspakom.title") }} />
        <Stack.Screen name="puspakom/register" options={{ title: t("puspakom.form.title") }} />
        <Stack.Screen name="puspakom/bus/[busId]" options={{ title: t("puspakom.bus.screenTitle") }} />
        <Stack.Screen name="puspakom/inspection/[id]" options={{ title: t("puspakom.bus.screenTitle") }} />
        <Stack.Screen name="puspakom/checklist/[id]" options={{ title: t("puspakom.checklist.title") }} />
        <Stack.Screen name="puspakom/reports" options={{ title: t("puspakom.reportsKpis") }} />
        <Stack.Screen name="puspakom/report/[id]" options={{ title: t("puspakom.reports.reportTitle") }} />
        <Stack.Screen name="puspakom/tech/index" options={{ title: t("puspakom.tech.navList") }} />
        <Stack.Screen name="puspakom/tech/[id]/index" options={{ title: t("puspakom.tech.navList") }} />
        <Stack.Screen name="puspakom/tech/[id]/route" options={{ title: t("puspakom.tech.navList") }} />
        <Stack.Screen name="puspakom/tech/[id]/stop/[no]" options={{ title: t("puspakom.tech.navList") }} />
        <Stack.Screen name="puspakom/tech/[id]/review" options={{ title: t("puspakom.tech.navReview") }} />
        <Stack.Screen name="puspakom/tech/[id]/recheck" options={{ title: t("puspakom.tech.navRecheck") }} />
      </Stack>
      <AdminViewingBar />
      <FloatingHeaderButtons onAvatarPress={() => setMenuVisible((v) => !v)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // Width reserved for the floating bell + avatar, plus breathing room.
  headerTitle: {
    maxWidth: HEADER_TITLE_MAX_WIDTH,
    fontSize: 17,
    fontWeight: "600",
    color: "#111827",
  },
  adminBar: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 30,
    height: 28,
    backgroundColor: "#1F2937",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  adminBarText: { flex: 1, color: "#fff", fontSize: 12.5, fontWeight: "700" },
  adminBarLink: { color: "#D1D5DB", fontSize: 12.5, fontWeight: "800", textDecorationLine: "underline" },
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
