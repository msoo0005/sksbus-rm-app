import { deleteStoredItem, getStoredItem, setStoredItem } from "./utils/storage";
import React from "react";
import { AppState, AppStateStatus } from "react-native";
import { api, DbMe, ensureValidSession, setUnauthorizedHandler } from "./api/client";
import {
  clearPushRegistrationMarker,
  usePushRegistration,
} from "./notifications/usePushRegistration";

type DbUser = DbMe;

type SessionContextType = {
  session: string | null; // accessToken
  dbUser: DbUser | null;
  loading: boolean;
  signInWithTokens: (tokens: {
    accessToken: string;
    idToken?: string;
    refreshToken?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>; // ✅ clears local tokens only (no browser)
  /** Replace the signed-in user's record, e.g. after saving My profile. */
  setDbUser: (u: DbUser) => void;
  /** Re-read /me (name, username, avatar). */
  refreshMe: () => Promise<void>;
};

const SessionContext = React.createContext<SessionContextType | null>(null);

export function useSession() {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = React.useState(true);
  const [session, setSession] = React.useState<string | null>(null);
  const [dbUser, setDbUser] = React.useState<DbUser | null>(null);
  const pushTokenRef = React.useRef<string | null>(null);

  // Registering this device for push: on sign-in, on every return to the
  // foreground, and whenever the OS rotates the token. See the hook for why
  // one-shot registration wasn't enough.
  usePushRegistration(dbUser?.user_id ?? null, pushTokenRef);

  const clearSession = React.useCallback(() => {
    setSession(null);
    setDbUser(null);
    deleteStoredItem("accessToken");
    deleteStoredItem("idToken");
    deleteStoredItem("refreshToken");
  }, []);

  // Register first so it's already wired before anything below can trigger it.
  React.useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  React.useEffect(() => {
    (async () => {
      try {
      const token = await getStoredItem("accessToken");
      if (token) {
        setSession(token);

        // Proactively refresh/validate rather than waiting for a failed request.
        const valid = await ensureValidSession();
        if (!valid) {
          clearSession();
          setLoading(false);
          return;
        }

        try {
          const me = await api.me();
          setDbUser(me);
        } catch {
          clearSession();
        }
      }
      } finally {
        // Unconditional: whatever went wrong above, the app must stop showing
        // a blank screen. This is what the web build was stuck on.
        setLoading(false);
      }
    })();
  }, [clearSession]);

  // Re-validate whenever the app comes back to the foreground, so an
  // expired-while-away session bounces the user to sign-in immediately
  // instead of waiting for them to trigger a request that then fails.
  React.useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        if (state === "active") {
          ensureValidSession();
        }
      },
    );
    return () => sub.remove();
  }, []);

  const signInWithTokens = React.useCallback(
    async (tokens: { accessToken: string; idToken?: string; refreshToken?: string }) => {
      await setStoredItem("accessToken", tokens.accessToken);
      if (tokens.idToken) await setStoredItem("idToken", tokens.idToken);
      if (tokens.refreshToken) await setStoredItem("refreshToken", tokens.refreshToken);

      setSession(tokens.accessToken);

      const me = await api.me();
      setDbUser(me);
    },
    []
  );

  const signOut = React.useCallback(async () => {
    if (pushTokenRef.current) {
      try {
        await api.unregisterPushToken(pushTokenRef.current);
      } catch {
        // best-effort — a stray token just means this device may still
        // receive push for the outgoing user until the next login rebinds it
      }
      pushTokenRef.current = null;
    }
    // Drop the marker too, so the next user on this device registers from
    // scratch rather than being skipped as already-registered.
    await clearPushRegistrationMarker();
    clearSession();
  }, [clearSession]);

  const refreshMe = React.useCallback(async () => {
    try {
      setDbUser(await api.me());
    } catch {
      // Keep what we have; the next screen load retries.
    }
  }, []);

  return (
    <SessionContext.Provider value={{ session, dbUser, loading, signInWithTokens, signOut, setDbUser, refreshMe }}>
      {children}
    </SessionContext.Provider>
  );
}
