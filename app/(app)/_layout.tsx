import { Stack, useRouter } from "expo-router";
import React from "react";
import { Button } from "react-native";
import { useSession } from "../ctx";

export default function RootLayout() {
  const router = useRouter();
  const { signOut } = useSession();

  const handleSignOut = React.useCallback(async () => {
    await signOut();                 // ✅ clears SecureStore tokens
    router.replace("/sign-in");      // ✅ forces re-auth for app
  }, [router, signOut]);

  return (
    <Stack
      screenOptions={{
        headerRight: () => <Button onPress={handleSignOut} title="Sign Out" />,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Home" }} />
      <Stack.Screen name="fleet-manager" options={{ title: "Fleet Manager" }} />
      <Stack.Screen name="rm-manager" options={{ title: "R&M Manager" }} />
      <Stack.Screen name="technician/index" options={{ title: "Technician" }} />
      <Stack.Screen name="inventory" options={{ title: "Inventory Manager" }} />
      <Stack.Screen name="form" options={{ title: "Report Form" }} />
    </Stack>
  );
}
