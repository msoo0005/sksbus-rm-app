import { FontAwesome5 } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DropDownPicker from "react-native-dropdown-picker";
import type {
  LowTreadTyre,
  Tyre,
  TyreAxleSide,
  TyreInspectionSession,
  TyreWheelPosition,
} from "../../../api/client";
import { api } from "../../../api/client";
import ConfirmActionModal from "../../../components/ConfirmActionModal";

type Position = {
  axle_number: number;
  axle_side: TyreAxleSide;
  wheel_position: TyreWheelPosition;
  label: string;
  shortLabel: string;
};

// Matches the paper form's layout: a single-tyre front axle and a dual-wheel
// rear axle. axle_number/axle_side/wheel_position are stored flexibly server
// side, so other configurations are just a different position list — this is
// simply the default layout rendered for buses today.
const FRONT_POSITIONS: Position[] = [
  { axle_number: 1, axle_side: "left", wheel_position: "single", label: "Front Axle — Left", shortLabel: "Front L" },
  { axle_number: 1, axle_side: "right", wheel_position: "single", label: "Front Axle — Right", shortLabel: "Front R" },
];

const REAR_POSITIONS: Position[] = [
  { axle_number: 2, axle_side: "left", wheel_position: "outer", label: "Rear Axle — Left Outer", shortLabel: "Rear L Out" },
  { axle_number: 2, axle_side: "left", wheel_position: "inner", label: "Rear Axle — Left Inner", shortLabel: "Rear L In" },
  { axle_number: 2, axle_side: "right", wheel_position: "inner", label: "Rear Axle — Right Inner", shortLabel: "Rear R In" },
  { axle_number: 2, axle_side: "right", wheel_position: "outer", label: "Rear Axle — Right Outer", shortLabel: "Rear R Out" },
];

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function BusTyresScreen() {
  const router = useRouter();
  const { busId: busIdParam } = useLocalSearchParams<{ busId: string }>();
  const busId = String(busIdParam ?? "");

  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState<Tyre[]>([]);
  const [spares, setSpares] = useState<Tyre[]>([]);
  const [sessions, setSessions] = useState<TyreInspectionSession[]>([]);
  const [lowTread, setLowTread] = useState<LowTreadTyre[]>([]);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<Position | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTyreId, setAssignTyreId] = useState<number | null>(null);
  const [assignItems, setAssignItems] = useState<{ label: string; value: number }[]>([]);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<void>)>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!busId) return;
    try {
      setLoading(true);
      const [mountedRows, spareRows, sessionRows, lowTreadRes] = await Promise.all([
        api.listBusTyres(busId),
        api.listTyres({ unmounted: true }),
        api.listBusTyreInspections(busId).catch(() => []),
        api.getLowTreadTyres().catch(() => null),
      ]);
      setMounted(Array.isArray(mountedRows) ? mountedRows : []);
      setSpares(Array.isArray(spareRows) ? spareRows.filter((t) => t.tyre_status === "spare") : []);
      setSessions(Array.isArray(sessionRows) ? sessionRows : []);
      setLowTread(lowTreadRes?.low_tread_tyres ?? []);
    } catch (e: any) {
      Alert.alert("Failed to load", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [busId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const tyreAtPosition = useMemo(() => {
    const map = new Map<string, Tyre>();
    for (const t of mounted) {
      if (t.axle_number != null && t.axle_side && t.wheel_position) {
        map.set(`${t.axle_number}-${t.axle_side}-${t.wheel_position}`, t);
      }
    }
    return map;
  }, [mounted]);

  const lowTreadIds = useMemo(() => new Set(lowTread.map((t) => t.tyre_id)), [lowTread]);

  useEffect(() => {
    setAssignItems(
      spares.map((t) => ({
        label: `${t.tyre_serial_number} — ${[t.tyre_brand, t.tyre_model].filter(Boolean).join(" ") || "No details"}${t.tyre_retread_count > 0 ? ` · Retread ×${t.tyre_retread_count}` : ""}`,
        value: t.tyre_id,
      })),
    );
  }, [spares]);

  const positionKey = (p: Position) => `${p.axle_number}-${p.axle_side}-${p.wheel_position}`;

  const openPicker = (position: Position) => {
    setPickerPosition(position);
    setAssignTyreId(null);
    setAssignOpen(false);
    setPickerVisible(true);
  };

  const confirmAndRun = (message: string, action: () => Promise<void>) => {
    setConfirmMessage(message);
    setPendingAction(() => action);
    setConfirmVisible(true);
  };

  const handleAssign = (tyre: Tyre) => {
    if (!pickerPosition) return;
    const position = pickerPosition;
    setPickerVisible(false);
    const existing = tyreAtPosition.get(positionKey(position));
    confirmAndRun(
      existing
        ? `Swap out tyre ${existing.tyre_serial_number} and mount ${tyre.tyre_serial_number} at ${position.label}?`
        : `Mount tyre ${tyre.tyre_serial_number} at ${position.label}?`,
      async () => {
        await api.swapTyre({
          bus_id: busId,
          axle_number: position.axle_number,
          axle_side: position.axle_side,
          wheel_position: position.wheel_position,
          incoming_tyre_id: tyre.tyre_id,
        });
        await load();
      },
    );
  };

  const handleUnmount = (tyre: Tyre) => {
    setPickerVisible(false);
    confirmAndRun(`Unmount tyre ${tyre.tyre_serial_number} from this bus?`, async () => {
      await api.unmountTyre(tyre.tyre_id, {});
      await load();
    });
  };

  const runConfirmed = async () => {
    if (!pendingAction) return;
    try {
      setBusy(true);
      await pendingAction();
      setConfirmVisible(false);
    } catch (e: any) {
      Alert.alert("Action failed", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const pickerExisting = pickerPosition ? tyreAtPosition.get(positionKey(pickerPosition)) : undefined;

  const renderTile = (position: Position) => {
    const tyre = tyreAtPosition.get(positionKey(position));
    const lowTread = tyre ? lowTreadIds.has(tyre.tyre_id) : false;
    return (
      <Pressable
        key={positionKey(position)}
        style={[
          styles.tile,
          tyre ? (lowTread ? styles.tileLowTread : styles.tileOccupied) : styles.tileEmpty,
        ]}
        onPress={() => openPicker(position)}
      >
        <Text style={styles.tileLabel}>{position.shortLabel}</Text>
        {tyre ? (
          <>
            <Text style={styles.tileSerial} numberOfLines={1}>
              {tyre.tyre_serial_number}
            </Text>
            {tyre.tyre_retread_count > 0 && (
              <Text style={styles.tileRetread}>Retread ×{tyre.tyre_retread_count}</Text>
            )}
            {lowTread && (
              <View style={styles.tileWarningRow}>
                <FontAwesome5 name="exclamation-triangle" size={9} color="#B45309" />
                <Text style={styles.tileWarningText}>Low tread</Text>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.tileEmptyText}>Tap to assign</Text>
        )}
      </Pressable>
    );
  };

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Bus {busId}</Text>
      </View>

      <Text style={styles.sectionLabel}>TYRE POSITIONS</Text>

      <View style={styles.diagram}>
        <View style={styles.schematicRow}>
          <View style={styles.axleColumn}>
            {renderTile(FRONT_POSITIONS[0])}
            <Text style={styles.axleTickLabel}>FRONT</Text>
            {renderTile(FRONT_POSITIONS[1])}
          </View>

          <View style={styles.busLabelWrap}>
            <FontAwesome5 name="bus" size={16} color="#9CA3AF" />
            <Text style={styles.busBodyLabel}>Bus {busId}</Text>
          </View>

          <View style={styles.axleColumn}>
            <View style={styles.rearClusterRow}>
              {renderTile(REAR_POSITIONS[0])}
              {renderTile(REAR_POSITIONS[3])}
            </View>
            <Text style={styles.axleTickLabel}>REAR</Text>
            <View style={styles.rearClusterRow}>
              {renderTile(REAR_POSITIONS[1])}
              {renderTile(REAR_POSITIONS[2])}
            </View>
          </View>
        </View>
      </View>

      <Text style={[styles.sectionLabel, { marginTop: 24 }]}>INSPECTION HISTORY</Text>
      {sessions.length === 0 ? (
        <Text style={styles.emptyText}>No inspections recorded yet.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {sessions.map((s) => (
            <Pressable
              key={s.tyre_inspection_session_id}
              style={styles.sessionCard}
              onPress={() =>
                router.push(`/rm-manager/tyres/inspection/${s.tyre_inspection_session_id}` as any)
              }
            >
              <View style={styles.sessionHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.positionTyre}>{formatDateTime(s.inspection_datetime)}</Text>
                  <Text style={styles.positionMeta}>
                    {s.technician_name ?? "Unknown technician"}
                    {s.odometer_reading != null ? ` · ${s.odometer_reading} km` : ""}
                  </Text>
                </View>
                <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {/* Tyre picker modal */}
      <Modal visible={pickerVisible} animationType="slide" transparent onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={[styles.busTitle, { flex: 1 }]} numberOfLines={1}>
                {pickerPosition?.label}
              </Text>
              <Pressable onPress={() => setPickerVisible(false)} hitSlop={10} style={styles.pickerCloseBtn}>
                <FontAwesome5 name="times" size={14} color="#374151" />
              </Pressable>
            </View>

            {pickerExisting && (
              <Pressable style={styles.unmountRow} onPress={() => handleUnmount(pickerExisting)}>
                <FontAwesome5 name="times-circle" size={14} color="#DC2626" />
                <Text style={styles.unmountRowText}>
                  Unmount {pickerExisting.tyre_serial_number}
                </Text>
              </Pressable>
            )}

            <Text style={[styles.sectionLabel, { marginTop: 14, marginBottom: 8 }]}>
              ASSIGN A SPARE TYRE
            </Text>
            <View style={{ zIndex: 3000 }}>
              <DropDownPicker
                listMode="SCROLLVIEW"
                open={assignOpen}
                value={assignTyreId}
                items={assignItems}
                setOpen={setAssignOpen}
                setValue={setAssignTyreId}
                setItems={setAssignItems}
                searchable
                searchPlaceholder="Search spare tyres…"
                placeholder={spares.length ? "Select a spare tyre" : "No spare tyres available"}
                disabled={!spares.length}
                style={styles.dropdown}
                dropDownContainerStyle={styles.dropdownContainer}
                zIndex={3000}
              />
            </View>

            <Pressable
              style={[styles.submitButton, !assignTyreId && { opacity: 0.5 }]}
              disabled={!assignTyreId}
              onPress={() => {
                const tyre = spares.find((t) => t.tyre_id === assignTyreId);
                if (tyre) handleAssign(tyre);
              }}
            >
              <Text style={styles.submitButtonText}>Assign Tyre</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ConfirmActionModal
        visible={confirmVisible}
        title="Confirm"
        message={busy ? "Working…" : confirmMessage}
        confirmLabel="Confirm"
        onConfirm={runConfirmed}
        onCancel={() => !busy && setConfirmVisible(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F9FAFB" },

  busTitle: { fontSize: 20, fontWeight: "800", color: "#111827" },
  // Shared "detail page hero" card standard — matches JobDetailsView / the
  // technician job page / the tyre inspection detail page.
  hero: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 20,
    marginBottom: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  heroTitle: { fontSize: 32, fontWeight: "800", color: "#111827", letterSpacing: -0.5 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.8,
    marginTop: 18,
    marginBottom: 10,
  },
  emptyText: { color: "#9CA3AF", fontWeight: "600", fontSize: 13 },

  diagram: {
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  schematicRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  axleColumn: {
    alignItems: "center",
    gap: 8,
  },
  axleTickLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 0.6,
  },
  busLabelWrap: {
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 10,
  },
  busBodyLabel: { fontSize: 12, fontWeight: "800", color: "#6B7280" },
  rearClusterRow: {
    flexDirection: "row",
    gap: 8,
  },

  tile: {
    width: 80,
    minHeight: 80,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  tileOccupied: { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" },
  tileLowTread: { backgroundColor: "#FFFBEB", borderColor: "#FBBF24" },
  tileEmpty: { backgroundColor: "#F9FAFB", borderColor: "#E5E7EB", borderStyle: "dashed" },
  tileLabel: { fontSize: 10, fontWeight: "700", color: "#9CA3AF", letterSpacing: 0.3, marginBottom: 4 },
  tileSerial: { fontSize: 13, fontWeight: "800", color: "#111827", textAlign: "center" },
  tileRetread: { fontSize: 10, fontWeight: "600", color: "#6B7280", marginTop: 2 },
  tileEmptyText: { fontSize: 11, fontWeight: "600", color: "#D1D5DB", fontStyle: "italic" },
  tileWarningRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  tileWarningText: { fontSize: 9, fontWeight: "700", color: "#B45309" },

  positionTyre: { fontSize: 15, fontWeight: "700", color: "#111827" },
  positionMeta: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 2 },

  sessionCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
  },
  sessionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sessionDetail: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#F3F4F6", gap: 10 },
  sessionTyreRow: { gap: 2 },

  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  pickerSheet: {
    maxHeight: "85%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  pickerCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    marginLeft: 12,
  },
  unmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  unmountRowText: { fontSize: 13, fontWeight: "700", color: "#DC2626" },
  dropdown: {
    backgroundColor: "#F9FAFB",
    borderColor: "#E5E7EB",
    borderRadius: 12,
    minHeight: 48,
  },
  dropdownContainer: {
    borderColor: "#E5E7EB",
    borderRadius: 12,
  },
  submitButton: {
    marginTop: 16,
    backgroundColor: "#111827",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitButtonText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
