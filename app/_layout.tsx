import { Stack, useRouter } from "expo-router";
import React from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { AuthProvider, useSession } from "./ctx";
import { LanguageProvider } from "./i18n/i18n-ctx";
import { ProjectProvider } from "./project-ctx";
import { SplashScreenController } from "./splash";

export default function Root() {
  return (
    <KeyboardProvider>
      <LanguageProvider>
        <AuthProvider>
          <ProjectProvider>
            <SplashScreenController />
            <RootNavigator />
          </ProjectProvider>
        </AuthProvider>
      </LanguageProvider>
    </KeyboardProvider>
  );
}

function RootNavigator() {
  const { session, dbUser, loading } = useSession();
  const router = useRouter();

  // ✅ only let user into (app) if we ALSO have dbUser
  const isAuthed = !!session && !!dbUser;

  // Tapping a push notification (foreground, backgrounded, or killed-and-
  // relaunched) should land on the in-app notifications list — it already
  // knows how to route each notification type/role to the right screen, so
  // this avoids duplicating that logic here.
  //
  // expo-notifications is imported dynamically (not at module scope) because
  // its native module throws immediately on import when the running binary
  // predates the package (e.g. an old dev client build) — a static top-level
  // import would crash the entire app on launch instead of just disabling
  // this listener for that session.
  React.useEffect(() => {
    if (!isAuthed) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;

    import("expo-notifications")
      .then((Notifications) => {
        if (cancelled) return;
        sub = Notifications.addNotificationResponseReceivedListener(() => {
          router.push("/notifications");
        });
      })
      .catch((e) => {
        console.error("expo-notifications native module unavailable", e);
      });

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [isAuthed, router]);

  if (loading) return null;

  return (
    <Stack>
      <Stack.Protected guard={isAuthed}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={!isAuthed}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
