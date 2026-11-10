import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { AppState } from "react-native";
import { api } from "../api/client";
import {
  isRetryableGate,
  registerForPushNotificationsAsync,
  type PushGate,
  type PushRegistrationResult,
} from "./registerPushToken";

// Keeping this device registered for push.
//
// Registration used to run exactly once, when `dbUser` became non-null, and
// swallow every failure. That mattered: POST /me/push-token was missing from
// API Gateway for a period, so every attempt during that window threw into an
// empty catch and the device was never registered again for the life of the
// session. This hook retries, records why it failed, and re-asserts
// periodically so a server-side prune or a permission granted later in
// Settings both self-heal.

const MARKER_KEY = "push.registered.v1";
const LAST_RESULT_KEY = "push.lastResult.v1";
// Re-assert rather than trusting the marker forever: a token pruned server-side
// as DeviceNotRegistered, or a restored database, must recover on its own.
const REASSERT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 60_000;
const BACKOFF_MS = [0, 5_000, 30_000, 120_000];

type Marker = { userId: number; token: string; registeredAt: number };

export type PushDiagnostic = {
  at: number;
  ok: boolean;
  gate?: PushGate | "api_register_failed";
  detail?: string;
};

async function readMarker(): Promise<Marker | null> {
  try {
    const raw = await AsyncStorage.getItem(MARKER_KEY);
    return raw ? (JSON.parse(raw) as Marker) : null;
  } catch {
    return null;
  }
}

async function writeDiagnostic(d: PushDiagnostic) {
  try {
    await AsyncStorage.setItem(LAST_RESULT_KEY, JSON.stringify(d));
  } catch {
    // Diagnostics are best-effort; never let them break registration.
  }
}

/** Read the last registration outcome, for the admin-only diagnostic line. */
export async function readPushDiagnostic(): Promise<PushDiagnostic | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_RESULT_KEY);
    return raw ? (JSON.parse(raw) as PushDiagnostic) : null;
  } catch {
    return null;
  }
}

export async function clearPushRegistrationMarker() {
  try {
    await AsyncStorage.removeItem(MARKER_KEY);
  } catch {
    // ignore
  }
}

export function usePushRegistration(
  userId: number | null,
  pushTokenRef: React.MutableRefObject<string | null>,
) {
  const inFlight = React.useRef(false);
  const lastAttemptAt = React.useRef(0);
  const attempts = React.useRef(0);

  const attempt = React.useCallback(
    async (reason: string) => {
      if (!userId) return;
      if (inFlight.current) return;
      if (Date.now() - lastAttemptAt.current < DEBOUNCE_MS) return;

      inFlight.current = true;
      lastAttemptAt.current = Date.now();
      try {
        const result: PushRegistrationResult = await registerForPushNotificationsAsync();

        if (!result.ok) {
          await writeDiagnostic({ at: Date.now(), ok: false, gate: result.gate, detail: result.detail });
          // Retry only the transient gates. permission_denied deliberately
          // isn't retried in-session but is on the next foreground — that is
          // exactly how a user grants it from Settings and comes back.
          if (isRetryableGate(result.gate) && attempts.current < BACKOFF_MS.length - 1) {
            const delay = BACKOFF_MS[++attempts.current];
            setTimeout(() => {
              lastAttemptAt.current = 0;
              attempt(`retry:${result.gate}`);
            }, delay);
          }
          return;
        }

        // Set before any short-circuit below: signOut reads this ref to
        // unregister, and if the marker skipped the POST it would otherwise be
        // null — leaving the next user on this device receiving the previous
        // user's pushes.
        pushTokenRef.current = result.token;

        const marker = await readMarker();
        const fresh =
          marker &&
          marker.userId === userId &&
          marker.token === result.token &&
          Date.now() - marker.registeredAt < REASSERT_AFTER_MS;
        if (fresh) {
          await writeDiagnostic({ at: Date.now(), ok: true, detail: "cached" });
          return;
        }

        try {
          await api.registerPushToken(result.token);
          attempts.current = 0;
          await AsyncStorage.setItem(
            MARKER_KEY,
            JSON.stringify({ userId, token: result.token, registeredAt: Date.now() } satisfies Marker),
          );
          await writeDiagnostic({ at: Date.now(), ok: true, detail: reason });
        } catch (e: any) {
          await writeDiagnostic({
            at: Date.now(),
            ok: false,
            gate: "api_register_failed",
            detail: e?.message,
          });
          if (attempts.current < BACKOFF_MS.length - 1) {
            const delay = BACKOFF_MS[++attempts.current];
            setTimeout(() => {
              lastAttemptAt.current = 0;
              attempt("retry:api_register_failed");
            }, delay);
          }
        }
      } finally {
        inFlight.current = false;
      }
    },
    [userId, pushTokenRef],
  );

  // Sign-in, and every cold start once the session is restored.
  React.useEffect(() => {
    if (!userId) return;
    attempts.current = 0;
    lastAttemptAt.current = 0;
    attempt("signin");
  }, [userId, attempt]);

  // Returning to the foreground — the recovery path for a long-lived warm
  // session, and for a user who just granted permission in Settings.
  React.useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") attempt("foreground");
    });
    return () => sub.remove();
  }, [userId, attempt]);

  // APNs/FCM can rotate a token at any time; re-register when it does.
  React.useEffect(() => {
    if (!userId) return;
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        const Notifications = await import("expo-notifications");
        sub = Notifications.addPushTokenListener(() => {
          lastAttemptAt.current = 0;
          attempt("token_rotated");
        });
      } catch {
        // Native module unavailable — already reported by the gate logging.
      }
    })();
    return () => sub?.remove();
  }, [userId, attempt]);
}
