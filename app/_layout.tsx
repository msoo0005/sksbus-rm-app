import { Stack } from "expo-router";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { AuthProvider, useSession } from "./ctx";
import { ProjectProvider } from "./project-ctx";
import { SplashScreenController } from "./splash";

export default function Root() {
  return (
    <KeyboardProvider>
      <AuthProvider>
        <ProjectProvider>
          <SplashScreenController />
          <RootNavigator />
        </ProjectProvider>
      </AuthProvider>
    </KeyboardProvider>
  );
}

function RootNavigator() {
  const { session, dbUser, loading } = useSession();

  if (loading) return null;

  // ✅ only let user into (app) if we ALSO have dbUser
  const isAuthed = !!session && !!dbUser;

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
