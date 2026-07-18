import * as SecureStore from "expo-secure-store";
import React from "react";
import { AppState, AppStateStatus } from "react-native";
import { ensureValidSession, setUnauthorizedHandler } from "./api/client";
import { api } from "./api/client";

type DbUser = {
  user_id: number;
  user_role: string;
  user_name: string;
  user_email: string;
};

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

  const clearSession = React.useCallback(() => {
    setSession(null);
    setDbUser(null);
    SecureStore.deleteItemAsync("accessToken").catch(() => {});
    SecureStore.deleteItemAsync("idToken").catch(() => {});
    SecureStore.deleteItemAsync("refreshToken").catch(() => {});
  }, []);

  // Register first so it's already wired before anything below can trigger it.
  React.useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  React.useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync("accessToken");
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
      setLoading(false);
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
      await SecureStore.setItemAsync("accessToken", tokens.accessToken);
      if (tokens.idToken) await SecureStore.setItemAsync("idToken", tokens.idToken);
      if (tokens.refreshToken) await SecureStore.setItemAsync("refreshToken", tokens.refreshToken);

      setSession(tokens.accessToken);

      const me = await api.me();
      setDbUser(me);
    },
    []
  );

  const signOut = React.useCallback(async () => {
    clearSession();
  }, [clearSession]);

  return (
    <SessionContext.Provider value={{ session, dbUser, loading, signInWithTokens, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}
