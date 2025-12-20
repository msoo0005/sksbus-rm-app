import { Stack } from 'expo-router';
import { Button } from 'react-native';
import { useSession } from '../ctx';

export default function RootLayout() {
  const { signOut } = useSession();
  return (
    <Stack>
      {/* You can configure global screen options here, or specific options for individual routes */}
      <Stack.Screen name="index" options={{ 
        title: 'Home', 
        headerRight:() => <Button onPress={signOut} title = "Sign Out"/>,
      }}
      />
      <Stack.Screen name="fleet-manager" options={{ title: 'Fleet Manager' }} />
      <Stack.Screen name="rm-manager" options={{ title: 'R&M Manager' }} />
      <Stack.Screen name="technician" options={{ title: 'Technician' }} />
      <Stack.Screen name="inventory" options={{ title: 'Inventory Manager' }} />
    </Stack>
  );
}
  