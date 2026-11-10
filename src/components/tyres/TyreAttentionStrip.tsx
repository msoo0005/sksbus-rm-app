import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n/i18n-ctx";

// What needs doing, before anything else on the screen.
//
// The tyre section used to open on a menu of three cards, so the two facts that
// actually start work — buses past their inspection interval, tyres past the
// tread limit — were two screens away and had to be gone looking for.
//
// Each item routes to the tab whose noun it counts: overdue counts BUSES, past
// limit counts TYRES. Sending both to the bus list would make the second one
// lie — tap "5 tyres past limit" and get 3 bus rows back.
//
// Renders nothing when both are zero. A permanently pinned bar reading "all
// clear" is density with no payload, and each panel's own subtitle already says
// so in words.

type Props = {
  overdueBuses: number;
  pastLimitTyres: number;
  onOverdue: () => void;
  onPastLimit: () => void;
};

export default function TyreAttentionStrip({
  overdueBuses,
  pastLimitTyres,
  onOverdue,
  onPastLimit,
}: Props) {
  const { t } = useI18n();
  if (!overdueBuses && !pastLimitTyres) return null;

  return (
    <View style={s.row}>
      {overdueBuses > 0 && (
        <Pressable
          style={({ pressed }) => [s.item, s.warn, pressed && s.pressed]}
          onPress={onOverdue}
        >
          <FontAwesome5 name="clock" size={11} color="#B45309" />
          <Text style={[s.text, s.warnText]} numberOfLines={1}>
            {t("tyres.section.attentionOverdue", { count: overdueBuses })}
          </Text>
          <FontAwesome5 name="chevron-right" size={9} color="#B45309" />
        </Pressable>
      )}
      {pastLimitTyres > 0 && (
        <Pressable
          style={({ pressed }) => [s.item, s.danger, pressed && s.pressed]}
          onPress={onPastLimit}
        >
          <FontAwesome5 name="exclamation-triangle" size={11} color="#DC2626" />
          <Text style={[s.text, s.dangerText]} numberOfLines={1}>
            {t("tyres.section.attentionPastLimit", { count: pastLimitTyres })}
          </Text>
          <FontAwesome5 name="chevron-right" size={9} color="#DC2626" />
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  item: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  pressed: { opacity: 0.75 },
  warn: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  danger: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  text: { flex: 1, fontSize: 12, fontWeight: "800" },
  warnText: { color: "#B45309" },
  dangerText: { color: "#DC2626" },
});
