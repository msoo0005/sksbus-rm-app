import { FontAwesome5 } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api } from "../api/client";

type BusRow = {
  bus_id: string;
  bus_route?: string | null;
  bus_model?: string | null;
  project_id?: string | null;
};

type Props = {
  visible: boolean;
  busId: string | null;
  onClose: () => void;
};

export default function BusDetailsModal({ visible, busId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [bus, setBus] = useState<BusRow | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!visible || !busId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      setBus(null);
      try {
        const rows = await api.buses();
        const match = (Array.isArray(rows) ? rows : []).find(
          (b: BusRow) => String(b.bus_id) === String(busId),
        );
        if (!alive) return;
        if (match) setBus(match);
        else setNotFound(true);
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, busId]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <FontAwesome5 name="bus" size={16} color="#111827" />
            </View>
            <Text style={styles.title}>Bus {busId}</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <FontAwesome5 name="times" size={14} color="#374151" />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : notFound ? (
            <Text style={styles.emptyText}>
              No further details available for this bus.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Route</Text>
                <Text style={styles.rowValue}>{bus?.bus_route || "—"}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Model</Text>
                <Text style={styles.rowValue}>{bus?.bus_model || "—"}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Project</Text>
                <Text style={styles.rowValue}>{bus?.project_id || "—"}</Text>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: "#111827" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  center: { paddingVertical: 20, alignItems: "center" },
  emptyText: { color: "#9CA3AF", fontWeight: "600", fontSize: 13 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  rowLabel: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  rowValue: { fontSize: 14, fontWeight: "600", color: "#111827" },
});
