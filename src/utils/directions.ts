import { Alert, Linking, Platform } from "react-native";

/**
 * Labels are passed in rather than translated here: this is a plain util, not a
 * component, so it has no access to the i18n hook. The app names (Google Maps,
 * Waze, Apple Maps) are brands and stay as they are in every language.
 */
export type DirectionsLabels = { title: string; message: string; cancel: string };

export function openDirections(lat: number, lng: number, labels?: DirectionsLabels) {
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
    labels?.title ?? "Open Directions",
    labels?.message ?? "Choose a navigation app",
    [
      ...options.map((o) => ({ text: o.text, onPress: o.onPress })),
      { text: labels?.cancel ?? "Cancel", style: "cancel" as const },
    ],
  );
}
