import { FontAwesome5 } from "@expo/vector-icons";
import { useI18n } from "../i18n/i18n-ctx";
import React, { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { LocalMedia } from "./ImagePicker";
import { pickImage, pickImages } from "./ImagePicker";
import ImageViewerOverlay from "./ImageViewerOverlay";
import { PhotoIndexBadge } from "./PhotoStrip";

export type PhotoSlot = {
  key: string;
  label: string;
  // FontAwesome5 glyph name, used for the plain directional slots.
  icon?: string;
  // Custom icon element (e.g. a lucide/SVG icon), takes priority over `icon`
  // when a slot needs something FontAwesome5 doesn't have, like the
  // instrument-cluster glyph.
  iconElement?: React.ReactNode;
};

type Props = {
  title?: string;
  slots: PhotoSlot[];
  value: Record<string, LocalMedia[]>;
  // May return a promise (an upload): several slots filled at once from the
  // gallery are then saved one after another, not all at the same moment.
  onChange: (key: string, next: LocalMedia[]) => void | Promise<void>;
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
  const { t } = useI18n();
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const filledCount = slots.filter((s) => (value[s.key]?.length ?? 0) > 0).length;

  const capture = async (slot: PhotoSlot, fromCamera: boolean) => {
    const labels = {
      title: t("common.permissionRequired"),
      cameraBody: t("common.cameraPermissionBody"),
      galleryBody: t("common.galleryPermissionBody"),
    };
    if (fromCamera) {
      const item = await pickImage(true, undefined, labels);
      if (item) await onChange(slot.key, [item]);
      return;
    }
    // From the gallery, several photos fill this slot and then the empty
    // slots after it, in the order they were picked.
    const targets = [
      slot,
      ...slots.slice(slots.indexOf(slot) + 1).filter((x) => !(value[x.key]?.length)),
      ...slots.slice(0, slots.indexOf(slot)).filter((x) => !(value[x.key]?.length)),
    ];
    const picked = await pickImages(labels, { limit: targets.length });
    for (let i = 0; i < picked.length && i < targets.length; i++) {
      await onChange(targets[i].key, [picked[i]]);
    }
  };

  const openActionSheet = (slot: PhotoSlot) => {
    if (readOnly) {
      onPressReadOnly?.();
      return;
    }
    if (disabled) return;

    const hasPhoto = (value[slot.key]?.length ?? 0) > 0;
    Alert.alert(slot.label, hasPhoto ? t("photoSlots.retakeOrReplace") : t("photoSlots.addAPhoto"), [
      { text: t("photoSlots.takePhoto"), onPress: () => capture(slot, true) },
      { text: t("photoSlots.chooseLibrary"), onPress: () => capture(slot, false) },
      ...(hasPhoto
        ? [{ text: t("photoSlots.removePhoto"), style: "destructive" as const, onPress: () => onChange(slot.key, []) }]
        : []),
      { text: t("common.cancel"), style: "cancel" as const },
    ]);
  };

  // Every filled slot, in order, so the full-screen view swipes through them.
  const filled = slots.filter((x) => !!value[x.key]?.[0]);
  const previewIndex = filled.findIndex((x) => x.key === previewKey);

  // An odd slot count can't tile evenly into pairs — pull the first slot out
  // as a full-width "featured" tile so the remainder always forms a clean
  // symmetric grid (e.g. 5 slots → 1 featured + a 2x2 grid, instead of
  // 2 + 2 + 1 with a lone tile dangling on the last row).
  const isOdd = slots.length % 2 !== 0;
  const featuredSlot = isOdd ? slots[0] : null;
  const gridSlots = isOdd ? slots.slice(1) : slots;

  const renderTile = (slot: PhotoSlot, featured: boolean) => {
    const media = value[slot.key]?.[0];
    return (
      <View key={slot.key} style={featured ? styles.featuredTileWrap : styles.tileWrap}>
        <Text style={styles.tileLabel} numberOfLines={1}>
          {slot.label}
        </Text>
        <Pressable
          style={[
            styles.tile,
            featured && styles.tileFeatured,
            media ? styles.tileFilled : styles.tileEmpty,
          ]}
          onPress={() => (media ? setPreviewKey(slot.key) : openActionSheet(slot))}
        >
          {media ? (
            <>
              <Image source={{ uri: media.localUri }} style={styles.tileImage} />
              <PhotoIndexBadge index={filled.indexOf(slot)} total={filled.length} />
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
          ) : slot.iconElement ? (
            slot.iconElement
          ) : (
            <FontAwesome5 name={(slot.icon ?? "camera") as any} size={18} color="#9CA3AF" />
          )}
        </Pressable>
      </View>
    );
  };

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

      {featuredSlot && <View style={styles.featuredRow}>{renderTile(featuredSlot, true)}</View>}

      <View style={styles.grid}>
        {gridSlots.map((slot) => renderTile(slot, false))}
      </View>

      <ImageViewerOverlay
        visible={previewIndex >= 0}
        imageUrls={filled.map((x) => ({ url: value[x.key][0].localUri }))}
        captions={filled.map((x) => x.label)}
        startIndex={Math.max(previewIndex, 0)}
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

  featuredRow: {
    marginBottom: 10,
  },
  featuredTileWrap: {
    width: "100%",
    alignItems: "center",
  },
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
  tileFeatured: {
    aspectRatio: 2.4,
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
