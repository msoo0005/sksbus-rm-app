import React from "react";
import { View } from "react-native";
import type { Tyre } from "../../api/client";
import { findPosition, FRONT_POSITIONS, REAR_POSITIONS, positionKey } from "../../utils/tyrePositions";
import BusTyreDiagram from "../BusTyreDiagram";

// Where on the bus this one tyre sits, as a thumbnail of the same chassis the
// full picker draws.
//
// A tyre card away from a bus page has nothing saying where the tyre came from
// — the serial's "-FL" / "-RLO" suffix is the only clue and it is cryptic. This
// answers it without a legend.
//
// It reuses BusTyreDiagram rather than drawing a second, smaller bus: two
// drawings would drift out of shape the first time either was touched.
//
// WIDTH AND SCALE TOGETHER. The diagram's axle bars are flex: 1, so its width
// comes from whatever contains it while `scale` only drives the heights. Setting
// one without the other stretches the chassis — hence the fixed pair below,
// chosen to keep roughly the full-size aspect.
const MAP_WIDTH = 84;
const MAP_SCALE = 0.26;

const NO_IDS = new Set<number>();

/**
 * Structurally what this needs, rather than a full `Tyre`.
 *
 * Callers include the inspection-session rows, which carry the mounting columns
 * and a serial but are not TYRE rows — asking each of them to cast would spread
 * the cast around. The one below is the only place the shapes have to be
 * reconciled, and it is safe because the diagram reads exactly these fields.
 */
type TyreLike = {
  tyre_id: number;
  tyre_serial_number: string;
  axle_number?: number | null;
  axle_side?: Tyre["axle_side"];
  wheel_position?: Tyre["wheel_position"];
};

export default function TyrePositionMap({ tyre }: { tyre: TyreLike }) {
  const position = findPosition(tyre);
  // A spare is on no wheel, so there is no position to point at. An empty
  // chassis with nothing highlighted would just be a puzzle.
  if (!position) return null;

  return (
    <View style={{ width: MAP_WIDTH }} pointerEvents="none" accessible={false}>
      <BusTyreDiagram
        front={FRONT_POSITIONS}
        rear={REAR_POSITIONS}
        // Every position reports a fitted tyre, so all six draw as solid wheels
        // and the chassis reads as a bus. Returning undefined for the others
        // would render them as dashed "empty socket" placeholders, which says
        // something quite different — that the bus is missing five tyres.
        // Which one this card is about comes from selectedKey below.
        tyreAt={() => tyre as Tyre}
        flaggedTyreIds={NO_IDS}
        selectedKey={positionKey(position)}
        scale={MAP_SCALE}
        readOnly
      />
    </View>
  );
}
