import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../../i18n/i18n-ctx";

/** "All saved" / "3 answers and 2 photos waiting for signal" under the progress. */
export default function SyncBadge({
  pending,
  busy,
  online,
  error,
}: {
  pending: { rows: number; photos: number };
  busy: boolean;
  online: boolean;
  error?: string | null;
}) {
  const { t } = useI18n();
  const waiting = pending.rows + pending.photos;
  const tone = error ? "#B91C1C" : waiting ? "#92400E" : "#15803D";
  const icon = error ? "exclamation-circle" : busy ? "sync" : waiting ? "cloud-upload-alt" : "check-circle";
  const text = error
    ? error
    : waiting
      ? t(busy ? "puspakom.tech.syncing" : online ? "puspakom.tech.waiting" : "puspakom.tech.waitingSignal", {
          rows: pending.rows,
          photos: pending.photos,
        })
      : t("puspakom.tech.allSaved");
  return (
    <View style={s.row}>
      <FontAwesome5 name={icon} size={11} color={tone} />
      <Text style={[s.text, { color: tone }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  text: { fontSize: 12, fontWeight: "700", flex: 1 },
});
