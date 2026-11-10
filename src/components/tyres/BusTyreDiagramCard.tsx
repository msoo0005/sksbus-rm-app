import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Tyre } from "../../api/client";
import { FRONT_POSITIONS, REAR_POSITIONS, type TyrePosition } from "../../utils/tyrePositions";
import BusTyreDiagram from "../BusTyreDiagram";

// The wheel diagram in its standard card, with a section label and hint. Both
// tyre flows draw the same diagram, so the chrome around it lives here rather
// than being restyled slightly differently on each screen.

type Props = {
  label: string;
  hint?: string;
  tyreAt: (position: TyrePosition) => Tyre | undefined;
  flaggedTyreIds?: Set<number>;
  doneTyreIds?: Set<number>;
  selectedKey: string | null;
  onSelect: (position: TyrePosition) => void;
  /**
   * Print each wheel's shallowest groove beneath it.
   *
   * Off in the inspection FORM, where the diagram is a progress tracker for
   * readings being typed right now and last month's numbers would compete with
   * them. On elsewhere.
   */
  showTread?: boolean;
};

const NO_IDS = new Set<number>();

export default function BusTyreDiagramCard({
  label,
  hint,
  tyreAt,
  flaggedTyreIds,
  doneTyreIds,
  selectedKey,
  onSelect,
  showTread = true,
}: Props) {
  return (
    <>
      <Text style={s.label}>{label}</Text>
      {!!hint && <Text style={s.hint}>{hint}</Text>}
      <View style={s.card}>
        <BusTyreDiagram
          front={FRONT_POSITIONS}
          rear={REAR_POSITIONS}
          tyreAt={tyreAt}
          flaggedTyreIds={flaggedTyreIds ?? NO_IDS}
          doneTyreIds={doneTyreIds}
          selectedKey={selectedKey}
          onSelect={onSelect}
          showTread={showTread}
        />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 0.6,
    marginTop: 22,
  },
  hint: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", marginTop: 4 },
  card: {
    marginTop: 12,
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
});
