import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import ImageViewer from "react-native-image-zoom-viewer";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  imageUrls: { url: string }[];
  startIndex?: number;
  onClose: () => void;
};

function ImageViewerContent({
  imageUrls,
  startIndex = 0,
  onClose,
}: Omit<Props, "visible">) {
  const [index, setIndex] = React.useState(startIndex);

  React.useEffect(() => {
    setIndex(startIndex);
  }, [startIndex]);

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
          <SafeAreaView
            edges={["top"]}
            pointerEvents="box-none"
            style={styles.headerSafeArea}
          >
            <View style={styles.header}>
              <Text style={styles.counter}>
                {total ? `${current} / ${total}` : ""}
              </Text>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        )}
      />
    </View>
  );
}

export default function ImageViewerOverlay({
  visible,
  imageUrls,
  startIndex = 0,
  onClose,
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
});
