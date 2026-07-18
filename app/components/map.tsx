import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import MapView, { MapPressEvent, Marker } from "react-native-maps";

export type LocationValue = {
  latitude: number;
  longitude: number;
  address?: string;
};

type Props = {
  label?: string;
  required?: boolean;
  value: LocationValue | null;
  onChange: (value: LocationValue) => void;
};

export default function MapSelector({
  label = "Location",
  required = false,
  value,
  onChange,
}: Props) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [mapInteractive, setMapInteractive] = useState(false);
  const [fullScreenVisible, setFullScreenVisible] = useState(false);

  const { height: windowHeight } = useWindowDimensions();

  // Scale the inline map with the device instead of a fixed pixel height —
  // clamped so it's never cramped on small phones or absurdly tall on tablets.
  const compactMapHeight = useMemo(
    () => Math.round(Math.min(340, Math.max(180, windowHeight * 0.28))),
    [windowHeight],
  );

  const [region, setRegion] = useState({
    latitude: 3.157,
    longitude: 101.711,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  const mapRef = useRef<MapView | null>(null);
  const fullMapRef = useRef<MapView | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  useEffect(() => {
    if (!value) return;
    setRegion((r) => ({
      ...r,
      latitude: value.latitude,
      longitude: value.longitude,
    }));
  }, [value?.latitude, value?.longitude]);

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const results = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });

      if (results.length > 0) {
        const p = results[0];

        // Build street line: "123 Jalan Ampang" or just "Jalan Ampang"
        const streetLine = [p.streetNumber, p.street]
          .filter(Boolean)
          .join(" ")
          .trim() || null;

        // name is only useful if it's a distinct POI (not the street itself)
        // Normalize by stripping punctuation/spaces before comparing so
        // "21, Jalan Raja Alang" and "21 Jalan Raja Alang" are treated as equal
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const nameNorm = norm(p.name ?? "");
        const streetNorm = norm(streetLine ?? "");
        const nameIsStreet =
          !nameNorm ||
          nameNorm === streetNorm ||
          streetNorm.includes(nameNorm) ||
          nameNorm.includes(streetNorm);

        const parts: string[] = [];
        if (!nameIsStreet && p.name) parts.push(p.name.trim());
        if (streetLine) parts.push(streetLine);
        if (p.city) parts.push(p.city.trim());

        // Only add region if it differs from city
        if (p.region && p.region.trim().toLowerCase() !== (p.city ?? "").trim().toLowerCase()) {
          parts.push(p.region.trim());
        }

        if (p.postalCode) parts.push(p.postalCode.trim());
        if (p.country) parts.push(p.country.trim());

        // Final dedup: drop any part already covered by an earlier part (normalized)
        const seen: string[] = [];
        for (const part of parts) {
          const partNorm = norm(part);
          const alreadyCovered = seen.some((s) => {
            const sNorm = norm(s);
            return sNorm.includes(partNorm) || partNorm.includes(sNorm);
          });
          if (!alreadyCovered) seen.push(part);
        }

        return seen.join(", ") || undefined;
      }
    } catch {
      // ignore
    }
    return undefined;
  };

  const moveTo = async (latitude: number, longitude: number) => {
    setRegion((r) => ({
      ...r,
      latitude,
      longitude,
    }));

    const nextRegion = {
      latitude,
      longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };

    mapRef.current?.animateToRegion(nextRegion, 350);
    fullMapRef.current?.animateToRegion(nextRegion, 350);
  };

  const handlePress = async (e: MapPressEvent) => {
    if (!mapInteractive) return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const address = await reverseGeocode(latitude, longitude);

    await moveTo(latitude, longitude);
    onChange({ latitude, longitude, address });
  };

  // The full-screen map is always interactive — opening it is the deliberate
  // "let me interact with the map" action, so there's no tap-to-activate gate.
  const handleFullScreenPress = async (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const address = await reverseGeocode(latitude, longitude);

    await moveTo(latitude, longitude);
    onChange({ latitude, longitude, address });
  };

  const handleMarkerDragEnd = async (e: {
    nativeEvent: { coordinate: { latitude: number; longitude: number } };
  }) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const address = await reverseGeocode(latitude, longitude);
    await moveTo(latitude, longitude);
    onChange({ latitude, longitude, address });
  };

  const useCurrentLocation = async () => {
    if (!hasPermission) {
      Alert.alert("Permission required", "Location access is needed.");
      return;
    }

    try {
      const loc = await Location.getCurrentPositionAsync({});
      const latitude = loc.coords.latitude;
      const longitude = loc.coords.longitude;

      const address = await reverseGeocode(latitude, longitude);

      await moveTo(latitude, longitude);
      onChange({ latitude, longitude, address });
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to get current location.");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label} {required && <Text style={styles.required}>*</Text>}
      </Text>

      <View style={styles.mapWrapper}>
        <MapView
          ref={(r) => {
            mapRef.current = r;
          }}
          style={[styles.map, { height: compactMapHeight }]}
          region={region}
          onPress={handlePress}
          scrollEnabled={mapInteractive}
          zoomEnabled={mapInteractive}
          rotateEnabled={mapInteractive}
          pitchEnabled={false}
        >
          {value && (
            <Marker
              coordinate={value}
              draggable={mapInteractive}
              onDragEnd={handleMarkerDragEnd}
            />
          )}
        </MapView>

        {/* Overlay: shown when not interactive */}
        {!mapInteractive && (
          <Pressable
            style={styles.mapOverlay}
            onPress={() => setMapInteractive(true)}
          >
            <View style={styles.mapOverlayPill}>
              <Text style={styles.mapOverlayText}>Tap to interact with map</Text>
            </View>
          </Pressable>
        )}

        {/* Done button: shown when interactive */}
        {mapInteractive && (
          <Pressable
            style={styles.mapDoneBtn}
            onPress={() => setMapInteractive(false)}
          >
            <Text style={styles.mapDoneText}>Done</Text>
          </Pressable>
        )}

        {/* Expand to full screen */}
        <Pressable
          style={styles.expandBtn}
          onPress={() => setFullScreenVisible(true)}
          hitSlop={8}
        >
          <Ionicons name="expand-outline" size={18} color="#fff" />
        </Pressable>
      </View>

      <Pressable style={styles.gpsButton} onPress={useCurrentLocation}>
        <Text style={styles.gpsText}>📍 Use Current Location</Text>
      </Pressable>

      {value?.address ? (
        <Text style={styles.addressText}>Selected: {value.address}</Text>
      ) : null}

      <Modal
        visible={fullScreenVisible}
        animationType="slide"
        onRequestClose={() => setFullScreenVisible(false)}
      >
        {/* Modal opens a separate native window, so the app's root
            SafeAreaProvider never re-measures insets for it — nest a fresh
            one here so the header doesn't render under the status bar. */}
        <SafeAreaProvider>
          <SafeAreaView style={styles.fullScreen} edges={["top", "bottom"]}>
            <View style={styles.fullScreenHeader}>
              <Text style={styles.fullScreenTitle}>{label}</Text>
              <Pressable
                style={styles.closeBtn}
                onPress={() => setFullScreenVisible(false)}
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color="#111827" />
              </Pressable>
            </View>

            <View style={styles.fullMapWrapper}>
              {fullScreenVisible && (
                <MapView
                  ref={(r) => {
                    fullMapRef.current = r;
                  }}
                  style={styles.fullMap}
                  region={region}
                  onPress={handleFullScreenPress}
                  scrollEnabled
                  zoomEnabled
                  rotateEnabled
                  pitchEnabled={false}
                >
                  {value && (
                    <Marker
                      coordinate={value}
                      draggable
                      onDragEnd={handleMarkerDragEnd}
                    />
                  )}
                </MapView>
              )}
            </View>

            <View style={styles.fullScreenFooter}>
              <Pressable style={styles.gpsButton} onPress={useCurrentLocation}>
                <Text style={styles.gpsText}>📍 Use Current Location</Text>
              </Pressable>

              {value?.address ? (
                <Text style={styles.addressText}>Selected: {value.address}</Text>
              ) : null}

              <Pressable
                style={styles.confirmBtn}
                onPress={() => setFullScreenVisible(false)}
              >
                <Text style={styles.confirmText}>Done</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16 },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
    color: "#111827",
  },
  required: { color: "#EF4444" },

  mapWrapper: {
    position: "relative",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  map: {
    width: "100%",
  },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  mapOverlayPill: {
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  mapOverlayText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  mapDoneBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "#111827",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  mapDoneText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  expandBtn: {
    position: "absolute",
    top: 10,
    left: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(17,24,39,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },

  gpsButton: {
    margin: 10,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
  },
  gpsText: { fontSize: 14, fontWeight: "500" },
  addressText: { margin: 6, fontSize: 13, color: "#374151" },

  // Full screen
  fullScreen: { flex: 1, backgroundColor: "#fff" },
  fullScreenHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  fullScreenTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  fullMapWrapper: { flex: 1 },
  fullMap: { flex: 1 },
  fullScreenFooter: {
    paddingHorizontal: 10,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  confirmBtn: {
    marginHorizontal: 10,
    marginTop: 4,
    marginBottom: 10,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
  },
  confirmText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
