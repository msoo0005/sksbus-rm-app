import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Bus } from "../../api/client";
import BusIdentity from "../BusIdentity";

// One bus in a tyre list. Replaces the near-identical row markup that had been
// written separately in the inspections list, the technician bus picker and the
// replacements list.
//
// The naming itself is BusIdentity's job, so a bus reads identically in a list
// row and in the header of the screen that row opens — plate, fleet/route code,
// route name, then model and project. This row previously printed a bare
// bus_id and left the route code off entirely.

type Props = {
  bus: Bus;
  /** Extra meta shown under the model line, e.g. "Last inspected: 13 Jul 2026". */
  meta?: string | null;
  /** Trailing slot — a due badge, a "Needs change" pill, a count. */
  right?: React.ReactNode;
  onPress?: () => void;
};

export default function BusTyreListRow({ bus, meta, right, onPress }: Props) {
  return (
    <Pressable
      style={s.row}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`Bus ${bus.bus_id}`}
    >
      <View style={s.icon}>
        <FontAwesome5 name="bus" size={14} color="#111827" />
      </View>

      <View style={{ flex: 1 }}>
        <BusIdentity
          busId={bus.bus_id}
          evNumber={bus.bus_ev_no}
          routeNumber={bus.bus_route_number}
          route={bus.bus_route}
          routeColour={bus.bus_route_colour}
          model={bus.bus_model}
          project={bus.project_id}
          size="sm"
        />
        {!!meta && (
          <Text style={s.meta} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>

      {right}
      {!!onPress && <FontAwesome5 name="chevron-right" size={12} color="#9CA3AF" />}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  meta: { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 2 },
});
