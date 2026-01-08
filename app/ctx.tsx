import * as SecureStore from "expo-secure-store";
import React from "react";
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

  React.useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync("accessToken");
      if (token) {
        setSession(token);
        try {
          const me = await api.me();
          setDbUser(me);
        } catch {
          await Promise.all([
            SecureStore.deleteItemAsync("accessToken"),
            SecureStore.deleteItemAsync("idToken"),
            SecureStore.deleteItemAsync("refreshToken"),
          ]);
          setSession(null);
          setDbUser(null);
        }
      }
      setLoading(false);
    })();
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
    await Promise.all([
      SecureStore.deleteItemAsync("accessToken"),
      SecureStore.deleteItemAsync("idToken"),
      SecureStore.deleteItemAsync("refreshToken"),
    ]);
    setSession(null);
    setDbUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ session, dbUser, loading, signInWithTokens, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}
