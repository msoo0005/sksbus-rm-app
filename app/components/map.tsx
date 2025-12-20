import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { MapPressEvent, Marker } from 'react-native-maps';

type LocationValue = {
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
  label = 'Location',
  required = false,
  value,
  onChange,
}: Props) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [region, setRegion] = useState({
    latitude: 3.157,
    longitude: 101.711 ,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const results = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });

      if (results.length > 0) {
        const p = results[0];
        return `${p.name ?? ''} ${p.street ?? ''}, ${p.city ?? ''}`;
      }
    } catch {}
  };

  const handlePress = async (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const address = await reverseGeocode(latitude, longitude);
    onChange({ latitude, longitude, address });
  };

  const useCurrentLocation = async () => {
    if (!hasPermission) {
      Alert.alert('Permission required', 'Location access is needed.');
      return;
    }

    const loc = await Location.getCurrentPositionAsync({});
    const address = await reverseGeocode(
      loc.coords.latitude,
      loc.coords.longitude
    );

    const newValue = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      address,
    };

    setRegion({
      ...region,
      latitude: newValue.latitude,
      longitude: newValue.longitude,
    });

    onChange(newValue);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label} {required && <Text style={styles.required}>*</Text>}
      </Text>

      <MapView
        style={styles.map}
        region={region}
        onPress={handlePress}
      >
        {value && (
          <Marker
            coordinate={value}
            draggable
            onDragEnd={async (e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              const address = await reverseGeocode(latitude, longitude);
              onChange({ latitude, longitude, address });
            }}
          />
        )}
      </MapView>

      <TouchableOpacity style={styles.gpsButton} onPress={useCurrentLocation}>
        <Text style={styles.gpsText}>📍 Use Current Location</Text>
      </TouchableOpacity>

      {value?.address && (
        <Text style={styles.addressText}>
          Selected: {value.address}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    marginTop: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
    color: '#111827',
  },
  required: {
    color: '#EF4444',
  },
  searchInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    height: 46,
    fontSize: 15,
    marginBottom: 8,
  },
  searchList: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  map: {
    height: 220,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  gpsButton: {
    margin: 10,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
  },
  gpsText: {
    fontSize: 14,
    fontWeight: '500',
  },
  addressText: {
    marginTop: 6,
    fontSize: 13,
    color: '#374151',
  },
});
