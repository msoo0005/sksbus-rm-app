import { FontAwesome5 } from "@expo/vector-icons";
import { useI18n } from "../i18n/i18n-ctx";
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
import { formatBusLabel } from "../utils/busLabel";
import { useProjectFilter } from "../hooks/useProjectFilter";

type BusRow = {
  bus_id: string;
  bus_ev_no?: string | null;
  bus_route_number?: string | null;
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
  const { t } = useI18n();
  const projectId = useProjectFilter();
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
        const rows = await api.buses(projectId ? { project_id: projectId } : undefined);
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
  }, [visible, busId, projectId]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <FontAwesome5 name="bus" size={16} color="#111827" />
            </View>
            <Text style={styles.title}>
              {t("busDetails.title", { value: formatBusLabel(busId, bus?.bus_ev_no) })}
            </Text>
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
              {t("busDetails.noDetails")}
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t("busDetails.evNo")}</Text>
                <Text style={styles.rowValue}>{bus?.bus_ev_no || "—"}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t("buses.routeNumber")}</Text>
                <Text style={styles.rowValue}>{bus?.bus_route_number || "—"}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t("busDetails.route")}</Text>
                <Text style={[styles.rowValue, styles.rowValueWrap]} numberOfLines={2}>
                  {bus?.bus_route || "—"}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t("buses.model")}</Text>
                <Text style={styles.rowValue}>{bus?.bus_model || "—"}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t("common.project")}</Text>
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
  rowValueWrap: { flexShrink: 1, textAlign: "right", marginLeft: 16 },
});
