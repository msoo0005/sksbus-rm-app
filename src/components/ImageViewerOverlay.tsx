// Full-screen photo viewer: swipe left and right through every photo in the
// section it was opened from, with an "n / N" counter, pinch to zoom, and
// swipe down to close.

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import ImageViewer from "react-native-image-zoom-viewer";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "@/i18n/i18n-ctx";

type Props = {
  visible: boolean;
  imageUrls: { url: string }[];
  startIndex?: number;
  onClose: () => void;
  /** A label under each photo (e.g. "Dashboard"), by position. */
  captions?: (string | null | undefined)[];
  /** Shows a Remove button for the photo on screen. */
  onRemove?: (index: number) => void;
};

function ImageViewerContent({
  imageUrls,
  startIndex = 0,
  onClose,
  captions,
  onRemove,
}: Omit<Props, "visible">) {
  const { t } = useI18n();
  const [index, setIndex] = React.useState(startIndex);

  React.useEffect(() => {
    setIndex(startIndex);
  }, [startIndex]);

  const total = imageUrls.length;
  const current = total ? Math.min(Math.max(index, 0), total - 1) + 1 : 0;
  const caption = captions?.[current - 1];

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
          <SafeAreaView
            edges={["top"]}
            pointerEvents="box-none"
            style={styles.headerSafeArea}
          >
            <View style={styles.header}>
              <Text style={styles.counter}>
                {total ? `${current} / ${total}` : ""}
              </Text>
              <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                <Text style={styles.closeText}>{t("common.close")}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        )}
      />
      {(!!caption || !!onRemove) && (
        <SafeAreaView edges={["bottom"]} pointerEvents="box-none" style={styles.footerSafeArea}>
          <View style={styles.footer} pointerEvents="box-none">
            {!!caption && <Text style={styles.caption}>{caption}</Text>}
            {!!onRemove && total > 0 && (
              <Pressable onPress={() => onRemove(current - 1)} style={styles.removeBtn}>
                <Ionicons name="trash-outline" size={18} color="#fff" />
                <Text style={styles.closeText}>{t("common.remove")}</Text>
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      )}
    </View>
  );
}

export default function ImageViewerOverlay({
  visible,
  imageUrls,
  startIndex = 0,
  onClose,
  captions,
  onRemove,
}: Props) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Modal opens a separate native window, so the app's root
          SafeAreaProvider never re-measures insets for it — nest a fresh
          one here so the header doesn't render under the status bar. */}
      <SafeAreaProvider>
        <ImageViewerContent
          imageUrls={imageUrls}
          startIndex={startIndex}
          onClose={onClose}
          captions={captions}
          onRemove={onRemove}
        />
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.95)",
    zIndex: 9999,
    elevation: 9999,
  },
  headerSafeArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10000,
  },
  header: {
    marginTop: 10,
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
  footerSafeArea: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 10000 },
  footer: { alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  caption: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: "hidden",
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: "rgba(220,38,38,0.9)",
    borderRadius: 12,
  },
});
