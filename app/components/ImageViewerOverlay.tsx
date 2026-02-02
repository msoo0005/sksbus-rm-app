import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import ImageViewer from "react-native-image-zoom-viewer";

type Props = {
  visible: boolean;
  imageUrls: { url: string }[];
  startIndex?: number;
  onClose: () => void;
};

export default function ImageViewerOverlay({
  visible,
  imageUrls,
  startIndex = 0,
  onClose,
}: Props) {
  const [index, setIndex] = React.useState(startIndex);

  React.useEffect(() => {
    if (visible) setIndex(startIndex);
  }, [visible, startIndex]);

  if (!visible) return null;

  const total = imageUrls.length;
  const current = total ? Math.min(Math.max(index, 0), total - 1) + 1 : 0;

  return (
    <View style={styles.overlay}>
      <ImageViewer
        imageUrls={imageUrls}
        index={startIndex}
        onChange={(i) => typeof i === "number" && setIndex(i)}
        enableSwipeDown
        onSwipeDown={onClose}
        onCancel={onClose}
        saveToLocalByLongPress={false}
        renderHeader={() => (
          <View style={styles.header}>
            <Text style={styles.counter}>
              {total ? `${current} / ${total}` : ""}
            </Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.95)",
    zIndex: 9999,
    elevation: 9999,
  },
  header: {
    position: "absolute",
    top: 44,
    left: 0,
    right: 0,
    zIndex: 10000,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  counter: {
    color: "#fff",
    fontWeight: "700",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  closeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
  },
  closeText: { color: "#fff", fontWeight: "700" },
});
