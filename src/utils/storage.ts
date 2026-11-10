import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * The one place the app reads and writes persisted key/value state.
 *
 * WHY THIS EXISTS. `expo-secure-store` has no web implementation at all — its
 * web shim is literally `export default {}`, so every call is a TypeError in a
 * browser. Five files called it directly, three of them inside unguarded async
 * effects in the provider stack, so the first call threw, `setLoading(false)`
 * never ran, and the app rendered a permanently blank page on web.
 *
 * WHERE THINGS GO ON WEB, and why it differs per key:
 *
 *   sessionStorage  the three Cognito tokens. Cleared when the tab closes, so a
 *                   shared or unattended desk machine does not stay signed in.
 *                   A browser has no keychain; this is the closest equivalent
 *                   to "the session ends when you walk away".
 *   localStorage    the selected project and the chosen language. Neither is a
 *                   secret, and making someone re-pick their project every time
 *                   they open a tab would be its own kind of broken.
 *
 * On native everything goes to SecureStore exactly as before — this changes no
 * iOS or Android behaviour.
 *
 * NOTHING HERE THROWS. Storage is unavailable in more situations than people
 * expect: Safari private mode, blocked site data, a browser with storage
 * disabled. A read failure returns null and a write failure is dropped, because
 * the alternative — as this app has already demonstrated — is a provider that
 * never finishes loading.
 */

/** Web-only: which browser store a key belongs in. Native ignores this. */
type WebScope = "session" | "local";

const WEB_SCOPE: Record<string, WebScope> = {
  accessToken: "session",
  idToken: "session",
  refreshToken: "session",
  selectedProjectV2: "local",
  appLanguage: "local",
};

// Unknown keys get the safer of the two. A key nobody declared is more likely a
// mistake than a deliberate choice to persist something forever.
const DEFAULT_SCOPE: WebScope = "session";

function webStore(key: string): Storage | null {
  try {
    const scope = WEB_SCOPE[key] ?? DEFAULT_SCOPE;
    return scope === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    // Touching `window.localStorage` itself throws when site data is blocked.
    return null;
  }
}

export async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return webStore(key)?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      webStore(key)?.setItem(key, value);
    } catch {
      // Quota exceeded, or storage blocked. Dropping the write is survivable;
      // throwing out of a sign-in handler is not.
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // ignored — see above
  }
}

export async function deleteStoredItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      webStore(key)?.removeItem(key);
    } catch {
      // ignored
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignored
  }
}
