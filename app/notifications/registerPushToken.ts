import Constants from "expo-constants";
import { Platform } from "react-native";

// expo-notifications/expo-device are imported dynamically (not at module
// scope) because their native modules throw immediately on import when the
// running binary predates these packages (e.g. an old dev client build) —
// a static top-level import would crash the entire app on launch instead of
// just disabling push for that session. Once a new dev/production build is
// made with these packages included, these imports succeed as normal.

let handlerRegistered = false;

async function ensureNotificationHandler() {
  if (handlerRegistered) return;
  try {
    const Notifications = await import("expo-notifications");
    // Foreground notifications still show a banner/sound instead of silently
    // arriving — otherwise a push received while the app is open would be
    // invisible until the user backgrounds and reopens it.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    handlerRegistered = true;
  } catch (e) {
    console.error("expo-notifications native module unavailable", e);
  }
}

export async function registerForPushNotificationsAsync(): Promise<
  string | null
> {
  try {
    const [Device, Notifications] = await Promise.all([
      import("expo-device"),
      import("expo-notifications"),
    ]);

    // Push tokens require a real device — the simulator/emulator has no
    // APNs/FCM channel to receive them on.
    if (!Device.isDevice) return null;

    await ensureNotificationHandler();

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== "granted") return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return null;

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (e) {
    console.error("Failed to get push token", e);
    return null;
  }
}
