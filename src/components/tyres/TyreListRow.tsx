import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Tyre } from "../../api/client";
import { isRetreadEndOfLife, retreadSuffix } from "../RetreadCountSelector";
import { detailLine } from "../../utils/tyreFormat";
import { positionLabelFor } from "../../utils/tyrePositions";
import BusIdentity from "../BusIdentity";
import TyreWearPill from "./TyreWearPill";
import TyreStatusPill from "./TyreStatusPill";
import { useI18n } from "../../i18n/i18n-ctx";

// One tyre in a list — inventory, spares, low-tread, or the tyres fitted to a
// bus. A mounted tyre additionally shows where it is, using the same BusIdentity
// block that names a bus on every other tyre screen, plus the wheel it sits on.

type Props = {
  tyre: Tyre;
  /** Trailing value, e.g. a low-tread reading. Replaces the status pill when given. */
  right?: React.ReactNode;
  /** Hide the "where is it" line on screens that are already about one bus. */
  showLocation?: boolean;
  onPress?: () => void;
};

export default function TyreListRow({ tyre, right, showLocation = true, onPress }: Props) {
  const { t } = useI18n();
  const mounted = !!tyre.current_bus_id;

  return (
    <Pressable
      style={s.row}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`Tyre ${tyre.tyre_serial_number}`}
    >
      <View style={s.icon}>
        <FontAwesome5 name="dot-circle" size={14} color={mounted ? "#111827" : "#6B7280"} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={s.titleRow}>
          {/* Serial then the bus's own fleet number, the same shape
              BusIdentity gives a bus: "BQM6423-RLO (EV069)". It used to show
              the ROUTE number here, which is shared by every bus on that
              route — so two tyres on two different buses read identically.
              The serial already encodes the plate; the EV number is the part
              it does not spell out. */}
          <Text style={s.title}>
            {tyre.tyre_serial_number}
            {mounted && tyre.current_bus_ev_no ? (
              <Text style={s.titleBusCode}>{` (${tyre.current_bus_ev_no})`}</Text>
            ) : null}
          </Text>
          {/* A casing at the retread ceiling has no lives left in it — worth
              seeing in the stock list, before someone picks it to fit. */}
          {isRetreadEndOfLife(tyre.tyre_retread_count) && (
            <View style={s.eolPill}>
              <Text style={s.eolPillText}>{t("tyres.detail.endOfLifeShort")}</Text>
            </View>
          )}
        </View>
        <Text style={s.meta} numberOfLines={1}>
          {detailLine([
            [tyre.tyre_brand, tyre.tyre_model].filter(Boolean).join(" ") || null,
            `${tyre.tyre_tread_count || 4} grooves`,
            retreadSuffix(tyre.tyre_retread_count).replace(" · ", "") || null,
          ])}
        </Text>

        {/* The wear classification, on its own line and impossible to miss.
            `latest_inspection_datetime` is what distinguishes "inspected and
            wearing evenly" from "never inspected" — both arrive here with a
            null wear type, and they mean opposite things. */}
        <View style={s.wearRow}>
          <TyreWearPill
            wear={tyre.latest_uneven_wear_type ?? null}
            inspected={tyre.latest_inspection_datetime != null}
            spreadMm={tyre.latest_tread_spread_mm ?? null}
            axleSide={tyre.axle_side ?? null}
            size="sm"
          />
        </View>

        {/* Where the tyre is. The plate line is suppressed because this row's
            title is the tyre serial, and serials here are PLATE-POSITION —
            printing the plate again directly under "VKC7684-RLO" just stutters.
            The bus code has already gone up to the title with it; what is left
            here is the route, model and project, none of which the serial
            says. */}
        {showLocation && mounted && (
          <View style={s.location}>
            <BusIdentity
              busId={tyre.current_bus_id as string}
              evNumber={tyre.current_bus_ev_no}
              routeNumber={tyre.current_bus_route_number}
              route={tyre.current_bus_route}
              routeColour={tyre.current_bus_route_colour}
              model={tyre.current_bus_model}
              project={tyre.current_project_id}
              showPlate={false}
              size="sm"
            />
            <Text style={s.meta} numberOfLines={1}>
              {positionLabelFor(tyre, "short")}
            </Text>
          </View>
        )}
      </View>

      {right ?? <TyreStatusPill status={tyre.tyre_status} />}
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
  title: { fontSize: 15, fontWeight: "800", color: "#111827" },
  // Lighter than the serial: same line, secondary information. Matches
  // BusIdentity's treatment of the code beside a plate.
  titleBusCode: { fontWeight: "700", color: "#6B7280" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  eolPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: "#FEF2F2",
  },
  eolPillText: { fontSize: 8, fontWeight: "800", color: "#DC2626", letterSpacing: 0.4 },
  meta: { fontSize: 11, fontWeight: "600", color: "#6B7280", marginTop: 2 },
  location: { marginTop: 6 },
  wearRow: { marginTop: 6 },
});
