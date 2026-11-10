import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n/i18n-ctx";
import { getRouteColourHex, routeColourNeedsBorder } from "../utils/routeColours";
import { detailLine } from "../utils/tyreFormat";

// A bus named the way the fleet names it:
//
//   VHG3340 (EV006)
//   ● Route GOKL 03 · HAB TITIWANGSA / KL SENTRAL
//   ELC-10M (229 kWh) · GOKL
//
// Line 1 identifies the VEHICLE: its plate and its own fleet number. Line 2 is
// where that vehicle goes, and is the part that wraps on a narrow screen. Line
// 3 says what the vehicle actually is. This is the one
// format every tyre screen uses to name a bus — headers and list rows alike —
// so a bus reads the same wherever it appears. RouteBadge joins the route parts
// into a single "•"-separated line and cannot produce this shape; it stays in
// use only where a row has no room for three lines.
//
// THE BRACKET HOLDS bus_ev_no, NOT bus_route_number. It used to hold the route
// number, on the mistaken belief that no fleet-code column existed. One does:
// bus_ev_no is unique per vehicle (83 buses, 83 values) and is what the depot
// and the paper inspection form use — "EV004 - VHG 3294". bus_route_number is
// the ROUTE: 16 values across those same 83 buses, shared by 3 to 9 vehicles
// each, so two different buses on one route showed the same code and read as
// the same vehicle. The route number moved to the route line, where it belongs.

type Props = {
  busId: string | number;
  /** The vehicle's own fleet number, bus_ev_no — "EV006". Shown in brackets. */
  evNumber?: string | null;
  /** The ROUTE it runs, bus_route_number — "GOKL 03". Shown on the route line. */
  routeNumber?: string | null;
  route?: string | null;
  routeColour?: string | null;
  /**
   * The third line: what the vehicle is. Omit both and the line is not drawn,
   * which is what a row that is already inside one bus's screen wants.
   */
  model?: string | null;
  project?: string | null;
  /**
   * Drop the plate line, for a row whose own title already names the vehicle.
   * Every tyre serial in this fleet is PLATE-POSITION ("BQM6423-RLO"), so a
   * tyre row that names its tyre has already said the plate, and printing it
   * again a line later just reads as a stutter.
   *
   * This takes the route code with it, since the code sits on the plate line.
   * A caller that hides the plate is responsible for showing the code on its
   * own title — TyreListRow renders "BQM6423-RLO (EV069)" for exactly that
   * reason.
   */
  showPlate?: boolean;
  /** "lg" for a detail-page hero, "md" for a header, "sm" for a list row. */
  size?: "sm" | "md" | "lg";
  align?: "left" | "center";
};

export default function BusIdentity({
  busId,
  evNumber,
  routeNumber,
  route,
  routeColour,
  model,
  project,
  showPlate = true,
  size = "md",
  align = "left",
}: Props) {
  const { t } = useI18n();
  const centred = align === "center";
  const plateStyle = size === "lg" ? s.plateLg : size === "sm" ? s.plateSm : s.plateMd;

  return (
    <View style={centred ? s.centred : undefined}>
      {showPlate && (
        <Text style={[plateStyle, centred && s.textCentred]}>
          {String(busId)}
          {evNumber ? <Text style={s.evNumber}>{` (${evNumber})`}</Text> : null}
        </Text>
      )}

      {(!!route || !!routeNumber) && (
        <View style={[s.routeRow, centred && s.routeRowCentred]}>
          {!!routeColour && (
            <View
              style={[
                s.dot,
                { backgroundColor: getRouteColourHex(routeColour) },
                routeColourNeedsBorder(routeColour) && s.dotBordered,
              ]}
            />
          )}
          <Text style={s.routeText} numberOfLines={2}>
            {t("buses.routeNumber")} {[routeNumber, route].filter(Boolean).join(" · ")}
          </Text>
        </View>
      )}

      {(!!model || !!project) && (
        <Text style={[s.metaText, centred && s.textCentred]} numberOfLines={1}>
          {detailLine([model, project])}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  centred: { alignItems: "center" },
  textCentred: { textAlign: "center" },

  plateSm: { fontSize: 14, fontWeight: "800", color: "#111827", letterSpacing: 0.2 },
  plateMd: { fontSize: 20, fontWeight: "800", color: "#111827", letterSpacing: 0.2 },
  plateLg: { fontSize: 30, fontWeight: "800", color: "#111827", letterSpacing: 0.2 },
  // Lighter than the plate: same line, secondary information.
  evNumber: { fontWeight: "700", color: "#6B7280" },

  routeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  routeRowCentred: { justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotBordered: { borderWidth: 1, borderColor: "#D1D5DB" },
  routeText: { flexShrink: 1, fontSize: 13, fontWeight: "700", color: "#374151" },
  metaText: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginTop: 3 },
});
