import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { useI18n } from "../i18n/i18n-ctx";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDraftAge } from "../hooks/useFormDraft";

// Offered at the top of a form when an unfinished draft is found on the
// device. Deliberately a bar rather than a modal: restoring is the likely
// choice, but it shouldn't block someone who just wants to start over.

type Props = {
  savedAt: number | null;
  onRestore: () => void;
  onDiscard: () => void;
};

export default function DraftRestoreBar({ savedAt, onRestore, onDiscard }: Props) {
  const { t } = useI18n();
  return (
    <View style={s.bar}>
      <FontAwesome5 name="history" size={13} color="#1D4ED8" />
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{t("draftBar.unfinished")}</Text>
        <Text style={s.meta}>Saved {formatDraftAge(savedAt)}</Text>
      </View>
      <Pressable onPress={onDiscard} hitSlop={8} style={s.discardBtn}>
        <Text style={s.discardText}>{t("draftBar.discard")}</Text>
      </Pressable>
      <Pressable onPress={onRestore} hitSlop={8} style={s.restoreBtn}>
        <Text style={s.restoreText}>{t("draftBar.restore")}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  title: { fontSize: 13, fontWeight: "800", color: "#1E3A8A" },
  meta: { fontSize: 11, fontWeight: "600", color: "#3B82F6", marginTop: 1 },
  discardBtn: { paddingHorizontal: 10, paddingVertical: 7 },
  discardText: { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  restoreBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#1D4ED8",
  },
  restoreText: { fontSize: 12, fontWeight: "800", color: "#fff" },
});
