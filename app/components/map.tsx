import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
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

  const [region, setRegion] = useState({
    latitude: 3.157,
    longitude: 101.711,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  const mapRef = useRef<MapView | null>(null);

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

    mapRef.current?.animateToRegion(
      {
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      350,
    );
  };

  const handlePress = async (e: MapPressEvent) => {
    if (!mapInteractive) return;
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
          style={styles.map}
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
              onDragEnd={async (e) => {
                const { latitude, longitude } = e.nativeEvent.coordinate;
                const address = await reverseGeocode(latitude, longitude);
                await moveTo(latitude, longitude);
                onChange({ latitude, longitude, address });
              }}
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
      </View>

      <Pressable style={styles.gpsButton} onPress={useCurrentLocation}>
        <Text style={styles.gpsText}>📍 Use Current Location</Text>
      </Pressable>

      {value?.address ? (
        <Text style={styles.addressText}>Selected: {value.address}</Text>
      ) : null}
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
    height: 220,
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
});
