import { FontAwesome5 } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { LocalMedia } from "./ImagePicker";
import { pickImage } from "./ImagePicker";
import ImageViewerOverlay from "./ImageViewerOverlay";

export type PhotoSlot = { key: string; label: string };

type Props = {
  title?: string;
  slots: PhotoSlot[];
  value: Record<string, LocalMedia[]>;
  onChange: (key: string, next: LocalMedia[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  onPressReadOnly?: () => void;
};

// A compact single-card grid of fixed photo slots (e.g. one per side of a
// bus) — replaces stacking N full ImagePickerField cards, which gets tall
// fast once you have more than one or two required photos.
export default function AfterPhotoSlots({
  title = "After Photos",
  slots,
  value,
  onChange,
  disabled = false,
  readOnly = false,
  onPressReadOnly,
}: Props) {
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const filledCount = slots.filter((s) => (value[s.key]?.length ?? 0) > 0).length;

  const capture = async (slot: PhotoSlot, fromCamera: boolean) => {
    const item = await pickImage(fromCamera);
    if (item) onChange(slot.key, [item]);
  };

  const openActionSheet = (slot: PhotoSlot) => {
    if (readOnly) {
      onPressReadOnly?.();
      return;
    }
    if (disabled) return;

    const hasPhoto = (value[slot.key]?.length ?? 0) > 0;
    Alert.alert(slot.label, hasPhoto ? "Retake or replace this photo?" : "Add a photo", [
      { text: "Take Photo", onPress: () => capture(slot, true) },
      { text: "Choose from Library", onPress: () => capture(slot, false) },
      ...(hasPhoto
        ? [{ text: "Remove Photo", style: "destructive" as const, onPress: () => onChange(slot.key, []) }]
        : []),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const previewSlot = slots.find((s) => s.key === previewKey);
  const previewItem = previewSlot ? value[previewSlot.key]?.[0] : null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <View style={[styles.pill, filledCount === slots.length && styles.pillComplete]}>
          <Text style={[styles.pillText, filledCount === slots.length && styles.pillTextComplete]}>
            {filledCount}/{slots.length}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {slots.map((slot) => {
          const media = value[slot.key]?.[0];
          return (
            <View key={slot.key} style={styles.tileWrap}>
              <Text style={styles.tileLabel} numberOfLines={1}>
                {slot.label}
              </Text>
              <Pressable
                style={[styles.tile, media ? styles.tileFilled : styles.tileEmpty]}
                onPress={() => (media ? setPreviewKey(slot.key) : openActionSheet(slot))}
              >
                {media ? (
                  <>
                    <Image source={{ uri: media.localUri }} style={styles.tileImage} />
                    {!readOnly && !disabled && (
                      <Pressable
                        style={styles.tileEditBtn}
                        onPress={() => openActionSheet(slot)}
                        hitSlop={8}
                      >
                        <FontAwesome5 name="pen" size={9} color="#fff" />
                      </Pressable>
                    )}
                  </>
                ) : (
                  <FontAwesome5 name="camera" size={18} color="#9CA3AF" />
                )}
              </Pressable>
            </View>
          );
        })}
      </View>

      <ImageViewerOverlay
        visible={!!previewItem}
        imageUrls={previewItem ? [{ url: previewItem.localUri }] : []}
        startIndex={0}
        onClose={() => setPreviewKey(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontSize: 15, fontWeight: "700", color: "#111827" },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  pillComplete: { borderColor: "#86EFAC", backgroundColor: "#F0FDF4" },
  pillText: { fontSize: 12, fontWeight: "700", color: "#6B7280" },
  pillTextComplete: { color: "#16A34A" },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tileWrap: {
    width: "47%",
    alignItems: "center",
  },
  tile: {
    width: "100%",
    aspectRatio: 1.3,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tileEmpty: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  tileFilled: { backgroundColor: "#F3F4F6" },
  tileLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
    textAlign: "center",
    marginBottom: 6,
  },
  tileImage: { ...StyleSheet.absoluteFillObject },
  tileEditBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
});
