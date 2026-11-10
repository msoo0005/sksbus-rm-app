import Constants from "expo-constants";
import { Platform } from "react-native";

// expo-notifications/expo-device are imported dynamically (not at module
// scope) because their native modules throw immediately on import when the
// running binary predates these packages (e.g. an old dev client build) —
// a static top-level import would crash the entire app on launch instead of
// just disabling push for that session. Once a new dev/production build is
// made with these packages included, these imports succeed as normal.

let handlerRegistered = false;

/**
 * Where registration stopped.
 *
 * Every one of these used to be a bare `return null`, so a device that never
 * registered was indistinguishable from one that did — which is how push came
 * to be silently broken for everyone. Naming the gate is the whole point.
 */
export type PushGate =
  | "native_module_missing"
  | "not_device"
  | "permission_denied"
  | "no_project_id"
  | "token_fetch_failed";

export type PushRegistrationResult =
  | { ok: true; token: string }
  | { ok: false; gate: PushGate; detail?: string };

/** Whether it's worth trying again later in this session. */
export function isRetryableGate(gate: PushGate): boolean {
  return gate === "token_fetch_failed";
}

function log(fields: Record<string, unknown>) {
  console.log("[PUSH]", JSON.stringify(fields));
}

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
  } catch (e: any) {
    log({ gate: "native_module_missing", where: "handler", detail: e?.message });
  }
}

export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  let Device: typeof import("expo-device");
  let Notifications: typeof import("expo-notifications");
  try {
    [Device, Notifications] = await Promise.all([
      import("expo-device"),
      import("expo-notifications"),
    ]);
  } catch (e: any) {
    const r = { ok: false as const, gate: "native_module_missing" as const, detail: e?.message };
    log(r);
    return r;
  }

  try {
    // Push tokens require a real device — the simulator/emulator has no
    // APNs/FCM channel to receive them on.
    if (!Device.isDevice) {
      const r = { ok: false as const, gate: "not_device" as const };
      log(r);
      return r;
    }

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
    if (status !== "granted") {
      const r = { ok: false as const, gate: "permission_denied" as const, detail: status };
      log(r);
      return r;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    if (!projectId) {
      const r = { ok: false as const, gate: "no_project_id" as const };
      log(r);
      return r;
    }

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    log({ ok: true, tokenSuffix: data.slice(-8) });
    return { ok: true, token: data };
  } catch (e: any) {
    const r = { ok: false as const, gate: "token_fetch_failed" as const, detail: e?.message };
    log(r);
    return r;
  }
}
