import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as React from "react";
import { Pressable, Text, View } from "react-native";
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
    discovery
  );

  React.useEffect(() => {
    (async () => {
      if (!response) return;

      console.log("[Auth] issuer:", issuer);
      console.log("[Auth] redirectUri:", redirectUri);
      console.log("[Auth] response:", response);

      if (response.type !== "success") {
        // If Cognito returns an error, surface it
        if (response.type === "error") {
          setError(
            (response.params?.error_description as string) ||
              (response.params?.error as string) ||
              "Login error"
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
          discovery
        );

        console.log("[Auth] token response:", {
          hasAccessToken: !!tokenRes.accessToken,
          hasIdToken: !!tokenRes.idToken,
          hasRefreshToken: !!tokenRes.refreshToken,
          tokenType: tokenRes.tokenType,
          expiresIn: tokenRes.expiresIn,
        });

        if (!tokenRes.accessToken) throw new Error("No access token returned");
        if (!tokenRes.idToken) throw new Error("No id token returned (required)");

        await signInWithTokens({
          accessToken: tokenRes.accessToken,
          idToken: tokenRes.idToken,
          refreshToken: tokenRes.refreshToken,
        });
      } catch (e: any) {
        console.log("[Auth] exchange error:", e);
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

      // ✅ No options: compatible across expo-auth-session versions
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
      setError(e?.message ?? "Hard reset failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20, gap: 12 }}>
      <Pressable
        disabled={!request || busy}
        onPress={handleSignIn}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 18,
          borderRadius: 10,
          borderWidth: 1,
          opacity: !request || busy ? 0.6 : 1,
          minWidth: 180,
          alignItems: "center",
        }}
      >
        <Text>{busy ? "Signing in..." : "Sign In"}</Text>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={handleHardResetAuth}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 18,
          borderRadius: 10,
          borderWidth: 1,
          opacity: busy ? 0.6 : 1,
          minWidth: 180,
          alignItems: "center",
        }}
      >
        <Text>{busy ? "Please wait..." : "Hard Reset Auth"}</Text>
      </Pressable>

      {!!error && <Text style={{ marginTop: 6 }}>{error}</Text>}

      <Text style={{ marginTop: 6, fontSize: 12, opacity: 0.7, textAlign: "center" }}>
        Redirect URI: {redirectUri}
      </Text>

      <Text style={{ marginTop: 6, fontSize: 12, opacity: 0.7, textAlign: "center" }}>
        Issuer: {issuer}
      </Text>
    </View>
  );
}
