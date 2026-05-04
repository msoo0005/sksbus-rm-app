// components/ImagePicker.tsx (LOCAL ONLY)
import { Ionicons } from "@expo/vector-icons";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
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

  // ✅ NEW: when readOnly, allow UI to guide user (e.g. scroll to odometer)
  onPressReadOnly?: () => void;

  captureLabel?: string;
  uploadLabel?: string;
  showUploadButton?: boolean;

  disabled?: boolean; // e.g. disable while submitting
};


export default function ImagePickerField({
  title,
  required,
  value = [],
  onChange,
  readOnly = false,
  onPressReadOnly,
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
    // ✅ if readOnly, guide user (don’t silently do nothing)
    if (readOnly) {
      onPressReadOnly?.();
      return;
    }
    if (disabled) return;

    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permission required",
        `Permission to access ${fromCamera ? "camera" : "gallery"} is required!`,
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

    const MAX_DIM = 1920;
    const needsResize =
      (asset.width ?? 0) > MAX_DIM || (asset.height ?? 0) > MAX_DIM;

    const ctx = ImageManipulator.manipulate(asset.uri);
    if (needsResize) ctx.resize({ width: MAX_DIM });
    const ref = await ctx.renderAsync();
    const manipulated = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });

    commit([...items, { localUri: manipulated.uri, mime_type: "image/jpeg" }]);
  };

  const removeImage = (index: number) => {
    if (readOnly) {
      onPressReadOnly?.();
      return;
    }
    if (disabled) return;
    commit(items.filter((_, i) => i !== index));
  };

  const buttonDisabled = disabled || readOnly;

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

      {/* ✅ Always show buttons. If readOnly, they're visually disabled but still tappable to guide user */}
      <Pressable
        style={[
          styles.bigButton,
          buttonDisabled && styles.disabled,
          readOnly && styles.readOnlyButton,
        ]}
        onPress={() => addImage(true)}
        disabled={disabled} // keep disabled true only when truly disabled; readOnly still allows press to trigger onPressReadOnly
      >
        <Ionicons name="camera-outline" size={18} color="#111827" />
        <Text style={styles.bigButtonText}>{captureLabel}</Text>
      </Pressable>

      {showUploadButton && (
        <Pressable
          style={[
            styles.bigButton,
            buttonDisabled && styles.disabled,
            readOnly && styles.readOnlyButton,
          ]}
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

                <Pressable
                  style={[
                    styles.deleteBtn,
                    (disabled || readOnly) && styles.deleteBtnDisabled,
                  ]}
                  onPress={() => removeImage(idx)}
                  hitSlop={10}
                  disabled={disabled} // allow press in readOnly to guide
                >
                  <Text style={styles.deleteText}>×</Text>
                </Pressable>
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
  // existing visual disable
  disabled: { opacity: 0.55 },
  // extra hint that button is “locked”, still pressable
  readOnlyButton: {
    backgroundColor: "#F9FAFB",
  },
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
  deleteBtnDisabled: {
    opacity: 0.65,
  },
  deleteText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 16,
  },
});
