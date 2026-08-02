import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../../api/client";

type BusRow = { bus_id: string; bus_route?: string | null; bus_model?: string | null };

export default function TechnicianTyresScreen() {
  const router = useRouter();
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async (opts?: { refreshing?: boolean }) => {
    try {
      if (opts?.refreshing) setRefreshing(true);
      else setLoading(true);
      const rows = await api.buses();
      setBuses(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      Alert.alert("Failed to load buses", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return buses;
    return buses.filter(
      (b) =>
        String(b.bus_id).toLowerCase().includes(q) ||
        (b.bus_route ?? "").toLowerCase().includes(q) ||
        (b.bus_model ?? "").toLowerCase().includes(q),
    );
  }, [buses, query]);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refreshing: true })} />}
    >
      <Text style={styles.title}>Select a Bus</Text>
      <Text style={styles.subtitle}>Choose a bus to submit a tyre inspection for.</Text>

      <View style={styles.searchWrap}>
        <FontAwesome5 name="search" size={13} color="#9CA3AF" style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search buses…"
          placeholderTextColor="#9CA3AF"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : filtered.length === 0 ? (
        <Text style={styles.emptyText}>No buses found.</Text>
      ) : (
        <View style={{ gap: 10, marginTop: 4 }}>
          {filtered.map((b) => (
            <Pressable
              key={String(b.bus_id)}
              style={styles.busRow}
              onPress={() => router.push(`/technician/tyre-inspection/${b.bus_id}` as any)}
            >
              <View style={styles.busIconWrap}>
                <FontAwesome5 name="bus" size={16} color="#EA580C" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.busTitle}>{b.bus_id}</Text>
                <Text style={styles.busMeta}>
                  {[b.bus_route, b.bus_model].filter(Boolean).join(" · ") || "No details"}
                </Text>
              </View>
              <FontAwesome5 name="chevron-right" size={13} color="#9CA3AF" />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  title: { fontSize: 20, fontWeight: "800", color: "#111827" },
  subtitle: { fontSize: 13, fontWeight: "500", color: "#6B7280", marginTop: 4 },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#fff",
  },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },

  emptyText: { color: "#9CA3AF", fontWeight: "600", marginTop: 24, textAlign: "center" },

  busRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
  },
  busIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#FFF7ED",
    alignItems: "center",
    justifyContent: "center",
  },
  busTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  busMeta: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 2 },
});
