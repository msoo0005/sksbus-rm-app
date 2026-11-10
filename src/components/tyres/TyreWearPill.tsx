import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { FontAwesome5 } from "@expo/vector-icons";
import {
  wearForDisplay,
  wearLabelKey,
  WEAR_TONE,
  wearToneFor,
  type AxleSide,
  type UnevenWearType,
} from "../../utils/tyreWear";
import { useI18n } from "../../i18n/i18n-ctx";

// The wear classification, stated plainly, wherever a tyre is named.
//
// It used to live only inside TyreTreadProfile's own little pill, which means
// it was invisible in every LIST — and a list is where someone scans a fleet
// looking for the tyre to deal with. Every other rendering of it (the report
// badge, the history row pill) was also its own hand-rolled markup with its own
// colours, so the same finding looked different on three screens.
//
// `wear === null` is a real answer, not an absence: it means the tread was
// measured and found even. That is why the pill still draws, in green. Only an
// UNINSPECTED tyre has nothing to say, which `inspected={false}` renders as a
// neutral grey "Not inspected" rather than silently implying a clean bill.

type Props = {
  /** The STORED classification. Null is ambiguous — see wearForDisplay. */
  wear: UnevenWearType | null;
  /** false when this tyre has no inspection on record at all. */
  inspected?: boolean;
  /** The measured spread, appended when there is one. */
  spreadMm?: number | null;
  /**
   * The readings on screen beside this pill, when the caller has them. Used to
   * check a null classification rather than trusting it: a pre-014 inspection
   * stores null however uneven it actually was, and this pill must not turn
   * that into a claim of even wear.
   */
  readings?: (string | number | null | undefined)[];
  /** Needed with `readings`, or a re-derived toe direction is a coin flip. */
  axleSide?: AxleSide | null;
  size?: "sm" | "md";
};

export default function TyreWearPill({
  wear,
  inspected = true,
  spreadMm,
  readings,
  axleSide,
  size = "md",
}: Props) {
  const { t } = useI18n();

  if (!inspected) {
    return (
      <View style={[s.pill, size === "sm" && s.pillSm, { backgroundColor: "#F3F4F6" }]}>
        <FontAwesome5 name="minus-circle" size={size === "sm" ? 9 : 10} color="#6B7280" />
        <Text style={[s.text, size === "sm" && s.textSm, { color: "#6B7280" }]} numberOfLines={1}>
          {t("tyres.wear.notInspected")}
        </Text>
      </View>
    );
  }

  const label = wearForDisplay(wear, { readings, axleSide, spreadMm });

  // "Uneven, but the cause was never recorded" — a legacy row. Amber, because it
  // is a finding; no cause named, because none can be trusted.
  const tone =
    label.kind === "uneven" ? WEAR_TONE.flagged : wearToneFor(label.kind === "known" ? label.type : null);
  const flagged = label.kind !== "even";

  return (
    <View style={[s.pill, size === "sm" && s.pillSm, { backgroundColor: tone.bg }]}>
      <FontAwesome5
        name={flagged ? "exclamation-triangle" : "check-circle"}
        size={size === "sm" ? 9 : 10}
        color={tone.fg}
      />
      <Text style={[s.text, size === "sm" && s.textSm, { color: tone.fg }]} numberOfLines={1}>
        {label.kind === "uneven"
          ? t("tyres.wear.unclassified")
          : t(wearLabelKey(label.kind === "known" ? label.type : null))}
        {flagged && spreadMm != null ? ` · ${spreadMm}mm` : ""}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillSm: { paddingHorizontal: 7, paddingVertical: 3, gap: 4 },
  text: { flexShrink: 1, fontSize: 11, fontWeight: "800", letterSpacing: 0.2 },
  textSm: { fontSize: 10 },
});
