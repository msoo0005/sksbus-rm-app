// components/ImagePicker.tsx (LOCAL ONLY)
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type LocalMedia = {
  localUri: string;
  mime_type: string;
};

type Props = {
  title: string;
  required?: boolean;

  value?: LocalMedia[];
  onChange?: (media: LocalMedia[]) => void;

  readOnly?: boolean;

  captureLabel?: string;
  uploadLabel?: string;
  showUploadButton?: boolean;

  disabled?: boolean; // e.g. disable while submitting
};

function guessMime(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

export default function ImagePickerField({
  title,
  required,
  value = [],
  onChange,
  readOnly = false,
  captureLabel = "Capture Photo",
  uploadLabel = "Upload Photo",
  showUploadButton = true,
  disabled = false,
}: Props) {
  const [items, setItems] = useState<LocalMedia[]>(value);

  useEffect(() => setItems(value), [value]);

  const countText = useMemo(() => {
    const n = items.length;
    return `${n} photo${n === 1 ? "" : "s"}`;
  }, [items.length]);

  const commit = (next: LocalMedia[]) => {
    setItems(next);
    onChange?.(next);
  };

  const addImage = async (fromCamera: boolean) => {
    if (readOnly || disabled) return;

    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permission required",
        `Permission to access ${fromCamera ? "camera" : "gallery"} is required!`
      );
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({
          quality: 0.7,
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
        });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const localUri = asset.uri;
    const mime_type = asset.mimeType ?? guessMime(localUri);

    commit([...items, { localUri, mime_type }]);
  };

  const removeImage = (index: number) => {
    if (readOnly || disabled) return;
    commit(items.filter((_, i) => i !== index));
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {title} {required ? <Text style={styles.asterisk}>*</Text> : null}
        </Text>

        <View style={styles.pill}>
          <Text style={styles.pillText}>{countText}</Text>
        </View>
      </View>

      {!readOnly && (
        <Pressable
          style={[styles.bigButton, disabled && styles.disabled]}
          onPress={() => addImage(true)}
          disabled={disabled}
        >
          <Ionicons name="camera-outline" size={18} color="#111827" />
          <Text style={styles.bigButtonText}>{captureLabel}</Text>
        </Pressable>
      )}

      {!readOnly && showUploadButton && (
        <Pressable
          style={[styles.bigButton, disabled && styles.disabled]}
          onPress={() => addImage(false)}
          disabled={disabled}
        >
          <Ionicons name="cloud-upload-outline" size={18} color="#111827" />
          <Text style={styles.bigButtonText}>{uploadLabel}</Text>
        </Pressable>
      )}

      {items.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.previewRow}
          contentContainerStyle={styles.previewContent}
        >
          {items.map((m, idx) => (
            <View key={`${m.localUri}-${idx}`} style={styles.thumbWrap}>
              <View style={styles.thumbClip}>
                <Image source={{ uri: m.localUri }} style={styles.thumb} />

                {!readOnly && (
                  <Pressable
                    style={styles.deleteBtn}
                    onPress={() => removeImage(idx)}
                    hitSlop={10}
                    disabled={disabled}
                  >
                    <Text style={styles.deleteText}>×</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  asterisk: { color: "#111827" },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  pillText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  bigButton: {
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 12,
  },
  disabled: { opacity: 0.55 },
  bigButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  previewRow: { marginTop: 4 },
  previewContent: { paddingRight: 4 },
  thumbWrap: { marginRight: 10 },
  thumbClip: {
    width: 86,
    height: 86,
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  thumb: { width: "100%", height: "100%" },
  deleteBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 16,
  },
});
