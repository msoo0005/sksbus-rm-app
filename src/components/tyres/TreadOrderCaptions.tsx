import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n/i18n-ctx";
import { readingStartsAtOuterEdge, type AxleSide } from "../../utils/tyreWear";

/**
 * Captions under a row of groove-thickness inputs, naming what box 1 and box N
 * are physically measuring ON THIS WHEEL.
 *
 * The instruction is the same at every wheel — always start from the kerb-side
 * edge — because that is something a technician can follow without working out
 * which face of the tyre points outward. What CHANGES with the side is what
 * that edge is: on a left-hand wheel the kerb side is the outboard shoulder, on
 * a right-hand wheel it is the inboard one. So the captions flip while the
 * instruction does not, and classifyUnevenWear undoes the flip using the same
 * READING_ANCHOR constant these captions read.
 *
 * That matters because toe-in and toe-out are the same gradient with opposite
 * signs: a wheel captioned the wrong way round does not produce a vaguer
 * answer, it produces the opposite one.
 *
 * Lives here rather than inline because the inspection form and the replacement
 * form both capture groove readings, and the two drifting apart on the
 * convention would silently corrupt the classification in one of them. Same
 * reasoning as tyrePositions.ts.
 *
 * Captions attach to the first and last index, so 3-groove tyres (LM 668) work
 * without a special case.
 */
export default function TreadOrderCaptions({
  count,
  axleSide,
  gap = 8,
}: {
  count: number;
  axleSide?: AxleSide | null;
  gap?: number;
}) {
  const { t } = useI18n();
  if (count < 2) return null;

  const startsOuter = readingStartsAtOuterEdge(axleSide);
  const first = startsOuter ? "grooveOuter" : "grooveInner";
  const last = startsOuter ? "grooveInner" : "grooveOuter";

  return (
    <>
      <View style={[s.row, { gap }]}>
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={s.cell}>
            <Text style={s.caption}>
              {i === 0
                ? t(`tyres.inspectionForm.${first}`)
                : i === count - 1
                  ? t(`tyres.inspectionForm.${last}`)
                  : ""}
            </Text>
          </View>
        ))}
      </View>
      <Text style={s.hint}>{t("tyres.inspectionForm.grooveOrderHint")}</Text>
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row" },
  cell: { flex: 1, alignItems: "center", marginTop: 4 },
  caption: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, color: "#6B7280" },
  hint: { fontSize: 11, color: "#6B7280", marginTop: 6, lineHeight: 15 },
});
