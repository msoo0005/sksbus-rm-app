// The photos of one section as a row that scrolls left and right. With more
// than one photo each carries its place ("2/3"), and a tap opens the
// full-screen viewer on that photo, where every photo in the section can be
// swiped through.

import React, { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import ImageViewerOverlay from "./ImageViewerOverlay";

type Props = {
  /** Photo URLs; empty entries are skipped. */
  urls: (string | null | undefined)[];
  /** Thumbnail width and height. */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export default function PhotoStrip({ urls, size = 72, style }: Props) {
  const list = urls.filter((u): u is string => !!u);
  const [open, setOpen] = useState<number | null>(null);
  if (!list.length) return null;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={s.row}
      >
        {list.map((u, i) => (
          <Pressable key={`${u}-${i}`} onPress={() => setOpen(i)} accessibilityRole="imagebutton">
            <Image source={{ uri: u }} style={[s.thumb, { width: size, height: size }]} />
            <PhotoIndexBadge index={i} total={list.length} />
          </Pressable>
        ))}
      </ScrollView>
      <ImageViewerOverlay
        visible={open !== null}
        imageUrls={list.map((url) => ({ url }))}
        startIndex={open ?? 0}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

/** "2/3" in the corner of a thumbnail; nothing for a lone photo. */
export function PhotoIndexBadge({ index, total }: { index: number; total: number }) {
  if (total < 2) return null;
  return (
    <View style={s.badge} pointerEvents="none">
      <Text style={s.badgeText}>
        {index + 1}/{total}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { gap: 8, paddingRight: 4 },
  thumb: { borderRadius: 10, backgroundColor: "#F3F4F6" },
  badge: {
    position: "absolute",
    left: 5,
    bottom: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "rgba(17,24,39,0.72)",
  },
  badgeText: { color: "#fff", fontSize: 10.5, fontWeight: "800" },
});
