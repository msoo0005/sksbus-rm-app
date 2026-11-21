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
import { KeyboardDoneAccessory } from "@/components/KeyboardDone";
import UserAvatar from "@/components/UserAvatar";
import { useSession } from "@/ctx";
import { useProject } from "@/project-ctx";
import { ROLE_HOME, type RoleKey } from "@/utils/roles";
import { useI18n } from "@/i18n/i18n-ctx";
import { LANGUAGE_LABELS, Language } from "@/i18n/translations";

// Native stack header height when no large title is used.
const HEADER_HEIGHT = Platform.OS === "ios" ? 44 : 56;


const ROLE_ALLOWED_PREFIXES: Record<RoleKey, string[]> = {
  admin: ["/profile", "/pdf-viewer", "/job/", "/admin/", "/fleet-manager", "/rm-manager", "/technician", "/inventory", "/form", "/project-selector", "/buses", "/notifications", "/inspection-record", "/tyres", "/performance", "/puspakom"],
  // /rm-manager/job: "View report" from a bus history opens the job (read-only).
  fleet_manager: ["/profile", "/pdf-viewer", "/job/", "/fleet-manager-home", "/fleet-manager", "/form", "/project-selector", "/performance", "/rm-manager/job", "/puspakom", "/notifications"],
  // /technician/job-order: R&M Managers register job orders too.
  rm_manager: ["/profile", "/pdf-viewer", "/job/", "/technician/job-order", "/rm-manager-home", "/rm-manager", "/notifications", "/project-selector", "/inspection-record", "/tyres", "/inventory", "/performance", "/puspakom"],
  technician: ["/profile", "/pdf-viewer", "/job/", "/technician-home", "/technician", "/notifications", "/project-selector", "/inspection-record", "/tyres", "/puspakom"],
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

// The header is our own bar, not the native one. The bell and avatar used to
// float over the native header (native headerRight is wrapped in a "Liquid
// Glass" pill on iOS 26 with no opt-out), and because nothing reserved room for
// them they covered long titles and any button a screen put in its header. Now
// back, title, the screen's own header buttons, the bell and the avatar sit in
// one row, so nothing can overlap.

type HeaderState = { unreadCount: number; onAvatarPress: () => void };
const HeaderContext = React.createContext<HeaderState>({ unreadCount: 0, onAvatarPress: () => {} });

/** One poll for the whole app: every screen's header reads the same count. */
function useUnreadCount() {
  const { dbUser } = useSession();
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = React.useState(0);
  const canSeeNotifications = !!dbUser && NOTIFIABLE_ROLES.has(dbUser.user_role);

  const refresh = React.useCallback(async () => {
    try {
      const { count } = await api.unreadNotificationCount();
      setUnreadCount(count);
    } catch {
      // best-effort — badge just skips this refresh cycle
    }
  }, []);

  React.useEffect(() => {
    if (!canSeeNotifications) return;
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [canSeeNotifications, refresh]);

  // Coming back from Notifications, the badge should already be right.
  React.useEffect(() => {
    if (canSeeNotifications && !pathname.startsWith("/notifications")) refresh();
  }, [pathname, canSeeNotifications, refresh]);

  return unreadCount;
}

function AppHeader({ navigation, options, route, back }: any) {
  const { dbUser } = useSession();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unreadCount, onAvatarPress } = React.useContext(HeaderContext);
  const canSeeNotifications = !!dbUser && NOTIFIABLE_ROLES.has(dbUser.user_role);
  const title = typeof options.title === "string" ? options.title : route.name;
  const screenRight = options.headerRight ? options.headerRight({ canGoBack: !!back }) : null;

  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        {back ? (
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color="#111827" />
          </Pressable>
        ) : (
          <View style={{ width: 4 }} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {screenRight ? <View style={styles.screenRight}>{screenRight}</View> : null}
        {dbUser && canSeeNotifications && (
          <Pressable
            onPress={() => router.push("/notifications")}
            style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.75 }]}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={19} color="#374151" />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
              </View>
            )}
          </Pressable>
        )}
        {dbUser && (
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
        )}
      </View>
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

export default function RootLayout() {
  const { t } = useI18n();
  const [menuVisible, setMenuVisible] = React.useState(false);
  const [languageVisible, setLanguageVisible] = React.useState(false);
  const unreadCount = useUnreadCount();
  const headerState = React.useMemo(
    () => ({ unreadCount, onAvatarPress: () => setMenuVisible((v) => !v) }),
    [unreadCount],
  );

  return (
    <HeaderContext.Provider value={headerState}>
    <View style={styles.root}>
      <RouteGuard />
      {/* The keyboard's Done bar for every screen (popups render their own). */}
      <KeyboardDoneAccessory />
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
          // Our own header bar (see AppHeader): back, title, the screen's own
          // buttons, then the bell and avatar, in one row.
          header: (props) => <AppHeader {...props} />,
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
        <Stack.Screen name="pdf-viewer" options={{ title: t("pdf.viewTitle") }} />
        <Stack.Screen name="admin/records" options={{ title: t("adminRecords.title") }} />
        <Stack.Screen name="admin/record/[id]" options={{ title: t("adminRecords.title") }} />
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
    </View>
    </HeaderContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  headerRow: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 8,
    paddingRight: 16,
  },
  backBtn: { width: 32, height: 40, alignItems: "flex-start", justifyContent: "center" },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
  },
  screenRight: { flexDirection: "row", alignItems: "center" },
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
