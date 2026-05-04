import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "./ctx";

WebBrowser.maybeCompleteAuthSession();

const region = (process.env.EXPO_PUBLIC_COGNITO_REGION || "").trim();
const domainPrefix = (process.env.EXPO_PUBLIC_COGNITO_DOMAIN || "").trim();
const clientId = (process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || "").trim();

if (!region) throw new Error("Missing EXPO_PUBLIC_COGNITO_REGION");
if (!domainPrefix) throw new Error("Missing EXPO_PUBLIC_COGNITO_DOMAIN (domain prefix only)");
if (!clientId) throw new Error("Missing EXPO_PUBLIC_COGNITO_CLIENT_ID");

const issuer = `https://${domainPrefix}.auth.${region}.amazoncognito.com`;

const discovery = {
  authorizationEndpoint: `${issuer}/oauth2/authorize`,
  tokenEndpoint: `${issuer}/oauth2/token`,
  revocationEndpoint: `${issuer}/oauth2/revoke`,
};

export default function SignIn() {
  const { signInWithTokens, signOut } = useSession();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "sksbusrmapp",
    path: "redirect",
  });

  const logoutUrl =
    `${issuer}/logout` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&logout_uri=${encodeURIComponent(redirectUri)}`;

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["openid", "email", "profile"],
      usePKCE: true,
    },
    discovery,
  );

  React.useEffect(() => {
    (async () => {
      if (!response) return;

      if (response.type !== "success") {
        if (response.type === "error") {
          setError(
            (response.params?.error_description as string) ||
              (response.params?.error as string) ||
              "Login error",
          );
        }
        return;
      }

      try {
        setBusy(true);
        setError(null);

        const code = response.params.code;
        if (!code) throw new Error("Missing auth code");
        if (!request?.codeVerifier) throw new Error("Missing code verifier");

        const tokenRes = await AuthSession.exchangeCodeAsync(
          {
            clientId,
            code,
            redirectUri,
            extraParams: { code_verifier: request.codeVerifier },
          },
          discovery,
        );

        if (!tokenRes.accessToken) throw new Error("No access token returned");
        if (!tokenRes.idToken) throw new Error("No id token returned (required)");

        await signInWithTokens({
          accessToken: tokenRes.accessToken,
          idToken: tokenRes.idToken,
          refreshToken: tokenRes.refreshToken,
        });
      } catch (e: any) {
        setError(e?.message ?? "Sign in failed");
      } finally {
        setBusy(false);
      }
    })();
  }, [response, request, redirectUri, signInWithTokens]);

  const handleSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await signOut();
      await promptAsync();
    } catch (e: any) {
      setError(e?.message ?? "Failed to open login");
    } finally {
      setBusy(false);
    }
  };

  const handleHardResetAuth = async () => {
    setError(null);
    setBusy(true);
    try {
      await signOut();
      await WebBrowser.openAuthSessionAsync(logoutUrl, redirectUri);
    } catch (e: any) {
      setError(e?.message ?? "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Logo area */}
      <View style={styles.logoSection}>
        <Image
          source={require("../assets/images/sksbus-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>R&amp;M System</Text>
          <View style={styles.dividerLine} />
        </View>
      </View>

      {/* Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Welcome back</Text>
        <Text style={styles.cardSub}>
          Sign in with your SKSBUS account to continue.
        </Text>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={[styles.signInBtn, (!request || busy) && styles.signInBtnDisabled]}
          onPress={handleSignIn}
          disabled={!request || busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.signInBtnText}>Sign In</Text>
          )}
        </Pressable>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Having trouble signing in?{" "}
        </Text>
        <Pressable onPress={handleHardResetAuth} disabled={busy}>
          <Text style={[styles.resetLink, busy && { opacity: 0.5 }]}>Reset auth session</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#fff",
    justifyContent: "center",
    paddingHorizontal: 28,
  },

  logoSection: {
    alignItems: "center",
    marginBottom: 40,
  },
  logo: {
    width: 280,
    height: 66,
    marginBottom: 20,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
    maxWidth: 340,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E5E7EB",
  },
  dividerText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },

  card: {
    backgroundColor: "#F9FAFB",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 28,
    gap: 8,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
  },
  cardSub: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6B7280",
    marginBottom: 8,
    lineHeight: 20,
  },

  errorBox: {
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FECACA",
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#DC2626",
  },

  signInBtn: {
    marginTop: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  signInBtnDisabled: { opacity: 0.55 },
  signInBtnText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.3,
  },

  footer: {
    marginTop: 28,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },
  footerText: {
    fontSize: 13,
    color: "#9CA3AF",
    fontWeight: "500",
  },
  resetLink: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6B7280",
    textDecorationLine: "underline",
  },
});
