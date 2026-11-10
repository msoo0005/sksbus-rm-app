import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n/i18n-ctx";
import { getRouteColourHex, routeColourNeedsBorder } from "../utils/routeColours";

// The fleet's route identity — a colour dot plus "Route 3 • RED • HAB
// TITIWANGSA / KL SENTRAL". The same markup had been written three times with
// three different style namespaces; this is the one copy.
//
// Renders nothing when a bus carries no route information, so callers can drop
// it in unconditionally.

type Props = {
  colour?: string | null;
  number?: string | null;
  route?: string | null;
  /** `compact` omits the route name, for tight list rows. */
  variant?: "full" | "compact";
};

export default function RouteBadge({ colour, number, route, variant = "full" }: Props) {
  // "Route"/"Laluan" — reuses the key the buses screen already translates
  // rather than hardcoding English into every tyre list.
  const { t } = useI18n();

  if (!colour && !number && !route) return null;

  const text = [
    // `number` is BUS.bus_route_number — the ROUTE ("GOKL 03"), shared by
    // every bus running it, so it reads "Route GOKL 03". The vehicle's own
    // number is bus_ev_no and belongs on the plate line (see BusIdentity).
    // `route` below is the route's name and follows on the same line.
    number ? `${t("buses.routeNumber")} ${number}` : null,
    colour,
    variant === "full" ? route : null,
  ]
    .filter(Boolean)
    .join(" • ");

  if (!text) return null;

  return (
    <View style={s.row}>
      {!!colour && (
        <View
          style={[
            s.dot,
            { backgroundColor: getRouteColourHex(colour) },
            routeColourNeedsBorder(colour) && s.dotBordered,
          ]}
        />
      )}
      <Text style={s.text} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotBordered: { borderWidth: 1, borderColor: "#D1D5DB" },
  text: { flex: 1, fontSize: 12, fontWeight: "700", color: "#374151" },
});
