import { Alert, Linking, Platform } from "react-native";

export function openDirections(lat: number, lng: number) {
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const wazeUrl = `waze://ul?ll=${lat},${lng}&navigate=yes`;
  const wazeFallback = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  const appleUrl = `maps://maps.apple.com/?daddr=${lat},${lng}`;

  const options: { text: string; onPress: () => void }[] = [
    {
      text: "Google Maps",
      onPress: () => Linking.openURL(googleUrl),
    },
    {
      text: "Waze",
      onPress: () =>
        Linking.openURL(wazeUrl).catch(() => Linking.openURL(wazeFallback)),
    },
  ];

  if (Platform.OS === "ios") {
    options.push({
      text: "Apple Maps",
      onPress: () => Linking.openURL(appleUrl),
    });
  }

  Alert.alert(
    "Open Directions",
    "Choose a navigation app",
    [
      ...options.map((o) => ({ text: o.text, onPress: o.onPress })),
      { text: "Cancel", style: "cancel" as const },
    ],
  );
}
