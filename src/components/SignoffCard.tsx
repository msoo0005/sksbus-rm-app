import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n/i18n-ctx";
import ImageViewerOverlay from "./ImageViewerOverlay";
import PersonChip from "./PersonChip";

export type Signoff = {
  key: string;
  label: string;
  name?: string | null;
  username?: string | null;
  selfieUrl?: string | null;
  // When the stage happened; null means it hasn't yet.
  at?: string | null;
};

function formatDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Every person who signed off on this job, one row per stage — large
// selfie, the name they typed, and the account they were logged in as.
// Kept apart from the timeline so "who did what" is readable at a glance.
export default function SignoffCard({ signoffs }: { signoffs: Signoff[] }) {
  const { t } = useI18n();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  return (
    <View>
      {signoffs.map((so, idx) => {
        const done = !!so.at;
        return (
          <View key={so.key} style={[s.row, idx > 0 && s.rowBorder]}>
            <Text style={s.stage}>{so.label}</Text>
            {done ? (
              <View style={s.body}>
                <PersonChip
                  name={so.name}
                  username={so.username}
                  selfieUrl={so.selfieUrl}
                  size={56}
                  onPressPhoto={setPreviewUrl}
                />
                <Text style={s.time}>{formatDateTime(so.at)}</Text>
              </View>
            ) : (
              <Text style={s.pending}>{t("signoffs.notYet")}</Text>
            )}
          </View>
        );
      })}

      <ImageViewerOverlay
        visible={!!previewUrl}
        imageUrls={previewUrl ? [{ url: previewUrl }] : []}
        onClose={() => setPreviewUrl(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: { paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  stage: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  body: { gap: 6 },
  time: { fontSize: 12, fontWeight: "600", color: "#9CA3AF", marginLeft: 66 },
  pending: { fontSize: 13, fontWeight: "600", color: "#9CA3AF", fontStyle: "italic" },
});
