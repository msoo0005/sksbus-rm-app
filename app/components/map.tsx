// components/map.tsx
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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

  const [region, setRegion] = useState({
    latitude: 3.157,
    longitude: 101.711,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  // Search state
  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);

  const mapRef = useRef<MapView | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  // Keep map region synced with selected value
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

        const parts = [
          p.name,
          p.street,
          p.city,
          p.region,
          p.postalCode,
          p.country,
        ].filter(Boolean);

        return parts.join(", ");
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

  // Forward geocode search -> move pin + map
  const searchAddress = async () => {
    const q = searchText.trim();
    if (!q) return;

    try {
      setSearching(true);
      Keyboard.dismiss();

      const results = await Location.geocodeAsync(q);

      if (!results?.length) {
        Alert.alert("Not found", "No results found for that search.");
        return;
      }

      const { latitude, longitude } = results[0];
      const address = await reverseGeocode(latitude, longitude);

      await moveTo(latitude, longitude);
      onChange({ latitude, longitude, address });
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Failed to search this address.");
    } finally {
      setSearching(false);
    }
  };

  const handlePress = async (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const address = await reverseGeocode(latitude, longitude);

    // nice UX: snap camera to the tapped location too
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

      {/* Search row */}
      <View style={styles.searchRow}>
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search address or place…"
          placeholderTextColor="#9CA3AF"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={searchAddress}
          editable={!searching}
        />

        <Pressable
          onPress={searchAddress}
          disabled={searching}
          style={({ pressed }) => [
            styles.searchBtn,
            pressed && !searching && { opacity: 0.85 },
            searching && { opacity: 0.6 },
          ]}
        >
          <Text style={styles.searchBtnText}>{searching ? "…" : "Search"}</Text>
        </Pressable>
      </View>

      <MapView
        ref={(r) => {
          mapRef.current = r;
        }}
        style={styles.map}
        region={region}
        onPress={handlePress}
        scrollEnabled={false} // ✅ IMPORTANT: stops MapView stealing scroll
        zoomEnabled={false} // optional
        rotateEnabled={false} // optional
        pitchEnabled={false} // optional
      >
        {value && (
          <Marker
            coordinate={value}
            draggable
            onDragEnd={async (e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              const address = await reverseGeocode(latitude, longitude);

              await moveTo(latitude, longitude);

              onChange({ latitude, longitude, address });
            }}
          />
        )}
      </MapView>

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
  label: { fontSize: 14, fontWeight: "500", marginBottom: 6, color: "#111827" },
  required: { color: "#EF4444" },

  searchRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    height: 46,
    fontSize: 15,
    color: "#111827",
  },
  searchBtn: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  searchBtnText: { color: "#fff", fontWeight: "700" },

  map: {
    height: 220,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
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
