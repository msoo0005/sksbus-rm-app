import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Tyre } from "../api/client";
import { treadBandColour } from "../utils/tyreFormat";
import type { TyrePosition } from "./TyreReplacementModal";

// Top-down plan view of the chassis — twin frame rails, two cross-members and
// two axles, with a single tyre each side at the front and dual tyres each
// side at the rear. Tapping a tyre selects it, so the diagram is how you pick
// which wheel position to look at rather than a grid of labelled boxes.
//
// Drawn from plain Views: the whole thing is rectangles and outlines, so SVG
// would buy nothing (and react-native-svg is only a transitive dep here).
//
// SCALED, NOT REDRAWN. Every dimension goes through makeStyles(scale) so the
// same component serves the full-size picker and the little position minimap
// on a tyre card. The alternative — a second, smaller drawing of a bus — would
// drift out of shape from this one the first time either was touched. At
// scale 1 the factory returns exactly the numbers this file used to hard-code,
// so the full-size diagram is unchanged.

type Props = {
  front: TyrePosition[];
  // Left outer, left inner, right inner, right outer — outboard first on the
  // left, so the array reads left-to-right across the axle.
  rear: TyrePosition[];
  tyreAt: (position: TyrePosition) => Tyre | undefined;
  flaggedTyreIds: Set<number>;
  // Wheels already dealt with in the current task — used by the inspection
  // form, where the diagram doubles as a progress tracker across the six
  // tyres rather than just a picker.
  doneTyreIds?: Set<number>;
  selectedKey: string | null;
  onSelect?: (position: TyrePosition) => void;
  /** 1 for the full picker; ~0.28 for the minimap. */
  scale?: number;
  /** No tapping, no accessibility button role — the minimap only shows where. */
  readOnly?: boolean;
  /** Each wheel's shallowest groove, printed beneath it. Off on the minimap. */
  showTread?: boolean;
};

const INK = "#111827";

export const positionKey = (p: TyrePosition) => `${p.axle_number}-${p.axle_side}-${p.wheel_position}`;

export default function BusTyreDiagram({
  front,
  rear,
  tyreAt,
  flaggedTyreIds,
  doneTyreIds,
  selectedKey,
  onSelect,
  scale = 1,
  readOnly = false,
  showTread = false,
}: Props) {
  const s = React.useMemo(() => makeStyles(scale, showTread), [scale, showTread]);
  const px = (n: number) => n * scale;

  const renderTyre = (position: TyrePosition) => {
    const key = positionKey(position);
    const tyre = tyreAt(position);
    const flagged = tyre ? flaggedTyreIds.has(tyre.tyre_id) : false;
    const done = tyre ? !!doneTyreIds?.has(tyre.tyre_id) : false;
    const selected = selectedKey === key;
    const tread = tyre?.latest_min_tread_mm ?? null;

    const body = (
      <>
        <View
          style={[
            s.tyre,
            !tyre && s.tyreEmpty,
            flagged && s.tyreFlagged,
            done && s.tyreDone,
            selected && s.tyreSelected,
            selected && !tyre && s.tyreEmptySelected,
          ]}
        >
          {/* Tread ribs, purely to read as a tyre rather than a black box. */}
          {tyre ? (
            [0, 1, 2].map((i) => <View key={i} style={[s.tread, selected && s.treadSelected]} />)
          ) : (
            <Text style={[s.tyreEmptyMark, selected && s.tyreEmptyMarkSelected]}>+</Text>
          )}
        </View>

        {done ? (
          <View style={[s.flagBadge, s.doneBadge]}>
            <FontAwesome5 name="check" size={px(7)} color="#fff" />
          </View>
        ) : flagged ? (
          <View style={s.flagBadge}>
            <FontAwesome5 name="exclamation" size={px(7)} color="#fff" />
          </View>
        ) : null}

        {/* Absolutely positioned so adding it cannot shift the axles: the rows
            align on the tyre's centre, and a label in normal flow would grow
            the row and pull the axle bars out of line with the front track. */}
        {showTread && tread != null && (
          <Text style={[s.treadLabel, { color: treadBandColour(tread) ?? "#6B7280" }]}>
            {tread}
          </Text>
        )}
      </>
    );

    if (readOnly) {
      return (
        <View key={key} style={s.tyreHit}>
          {body}
        </View>
      );
    }

    return (
      <Pressable
        key={key}
        onPress={() => onSelect?.(position)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={
          tyre ? `${position.label}, ${tyre.tyre_serial_number}` : `${position.label}, empty`
        }
        accessibilityState={{ selected }}
        style={s.tyreHit}
      >
        {body}
      </Pressable>
    );
  };

  const axle = (children: React.ReactNode) => <View style={s.axleRow}>{children}</View>;

  const axleShaft = (
    <>
      <View style={s.hubStub} />
      <View style={s.axleBar} />
      <View style={s.diffHousing} />
      <View style={s.axleBar} />
      <View style={s.hubStub} />
    </>
  );

  return (
    <View style={s.wrap}>
      {/* Frame rails sit behind the axles, running the length of the bus. */}
      <View pointerEvents="none" style={s.chassisLayer}>
        <View style={s.chassis}>
          <View style={[s.rail, s.railLeft]} />
          <View style={[s.rail, s.railRight]} />
          <View style={[s.crossMember, { top: "30%" }]} />
          <View style={[s.crossMember, { top: "66%" }]} />
        </View>
      </View>

      {axle(
        <>
          {renderTyre(front[0])}
          {axleShaft}
          {renderTyre(front[1])}
        </>,
      )}

      {/* Open span of chassis between the axles — the bus is already named in
          the page header, so nothing is drawn over the frame rails here. */}
      <View style={s.span} />

      {axle(
        <>
          <View style={s.dual}>
            {renderTyre(rear[0])}
            {renderTyre(rear[1])}
          </View>
          {axleShaft}
          <View style={s.dual}>
            {renderTyre(rear[2])}
            {renderTyre(rear[3])}
          </View>
        </>,
      )}
    </View>
  );
}

function makeStyles(scale: number, showTread: boolean) {
  const p = (n: number) => n * scale;
  const TYRE_W = p(34);
  const TYRE_H = p(76);
  const CHASSIS_W = p(78);

  return StyleSheet.create({
    wrap: {
      alignItems: "center",
      paddingVertical: p(4),
      // Room for the labels hanging below the rear axle.
      paddingBottom: showTread ? p(26) : p(4),
    },

    chassisLayer: {
      position: "absolute",
      top: TYRE_H / 2,
      bottom: (showTread ? p(26) : 0) + TYRE_H / 2 - p(14),
      left: 0,
      right: 0,
      alignItems: "center",
    },
    chassis: { width: CHASSIS_W, flex: 1 },
    rail: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: p(7),
      borderWidth: p(2),
      borderColor: INK,
      backgroundColor: "#fff",
    },
    railLeft: { left: 0 },
    railRight: { right: 0 },
    crossMember: {
      position: "absolute",
      left: 0,
      right: 0,
      height: p(9),
      borderWidth: p(2),
      borderColor: INK,
      backgroundColor: "#fff",
    },

    axleRow: { flexDirection: "row", alignItems: "center", alignSelf: "stretch", zIndex: 1 },
    // The bars flex, so the outermost tyres land on the row edges at both axles
    // and the front track lines up with the rear outers.
    axleBar: { flex: 1, height: p(11), borderWidth: p(2), borderColor: INK, backgroundColor: "#fff" },
    diffHousing: {
      width: p(54),
      height: p(38),
      borderWidth: p(2.5),
      borderColor: INK,
      borderRadius: p(12),
      backgroundColor: "#fff",
    },
    hubStub: { width: p(10), height: p(26), borderRadius: p(2), backgroundColor: INK },

    dual: { flexDirection: "row", gap: p(4) },

    span: { height: p(132) },

    tyreHit: { paddingHorizontal: p(2) },
    tyre: {
      width: TYRE_W,
      height: TYRE_H,
      borderRadius: p(7),
      backgroundColor: INK,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-evenly",
      borderWidth: p(2.5),
      borderColor: INK,
    },
    tread: {
      width: p(2),
      height: TYRE_H * 0.72,
      borderRadius: p(1),
      backgroundColor: "rgba(255,255,255,0.5)",
    },
    tyreEmpty: {
      backgroundColor: "#fff",
      borderColor: "#D1D5DB",
      borderStyle: "dashed",
      justifyContent: "center",
    },
    tyreEmptyMark: { fontSize: p(18), fontWeight: "700", color: "#D1D5DB" },
    tyreEmptySelected: { backgroundColor: "#EEF2FF", borderColor: "#6366F1", borderStyle: "solid" },
    tyreEmptyMarkSelected: { color: "#4F46E5" },
    tyreFlagged: { borderColor: "#F59E0B", borderWidth: p(3.5) },
    tyreDone: { borderColor: "#16A34A", borderWidth: p(3.5) },
    // Selection has to win against a black tyre on a white card, where a
    // same-width border in a different colour barely registers. Four things
    // stack up so it reads at a glance without shifting the layout: a thicker
    // bright frame, a lifted interior so the whole shape changes (not just its
    // outline), a coloured glow, and a slight scale — the last two cost no
    // layout at all, and borders in RN draw inside the box so the tyre keeps
    // its size.
    tyreSelected: {
      borderWidth: p(4),
      borderColor: "#6366F1",
      backgroundColor: "#312E81",
      transform: [{ scale: 1.08 }],
      shadowColor: "#4F46E5",
      shadowOpacity: 0.5,
      shadowRadius: p(8),
      shadowOffset: { width: 0, height: p(2) },
      elevation: 8,
    },
    // Ribs lighten with the body so they stay legible inside the selection.
    treadSelected: { backgroundColor: "rgba(255,255,255,0.85)" },

    treadLabel: {
      position: "absolute",
      top: TYRE_H + p(4),
      left: 0,
      right: 0,
      textAlign: "center",
      fontSize: p(13),
      fontWeight: "800",
    },

    flagBadge: {
      position: "absolute",
      top: p(-3),
      right: p(-1),
      width: p(15),
      height: p(15),
      borderRadius: p(8),
      backgroundColor: "#D97706",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: p(1.5),
      borderColor: "#fff",
    },
    doneBadge: { backgroundColor: "#16A34A" },
  });
}
