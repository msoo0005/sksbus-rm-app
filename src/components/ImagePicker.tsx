import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/i18n-ctx";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Dimensions,
  Image,
  Modal,
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

// Shared by ImagePickerField and any compact/custom photo pickers (e.g. the
// fixed-slot after-photo grid) — permission request, capture/pick, and the
// resize/compress step, without any of ImagePickerField's own UI or state.
// `cameraType` only applies when capturing (ignored for the gallery) — used
// by the identity-verification selfie step to open straight to the front
// camera instead of whichever one the device last used.
export type PermissionLabels = { title: string; cameraBody: string; galleryBody: string };

// How big an uploaded photo may be. Every photo in the app passes through
// pickImage, so this is the one place that sets what S3 stores.
//
// A 12MP phone photo is ~3–5MB as taken. Longest side 1600px at JPEG 0.6
// comes out around 150–350KB, still sharp enough to read a plate, an
// odometer or a tyre sidewall when zoomed. A selfie only has to show a face,
// so it goes much smaller.
export type ImageSize = { maxDim: number; quality: number };
export const PHOTO_SIZE: ImageSize = { maxDim: 1600, quality: 0.6 };
export const SELFIE_SIZE: ImageSize = { maxDim: 720, quality: 0.6 };

export async function pickImage(
  fromCamera: boolean,
  cameraType?: ImagePicker.CameraType,
  labels?: PermissionLabels,
  size: ImageSize = PHOTO_SIZE,
): Promise<LocalMedia | null> {
  const permission = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    // Labels are passed in: this is a standalone function, not a component, so
    // it cannot reach the i18n hook. Callers inside a component supply them.
    Alert.alert(
      labels?.title ?? "Permission required",
      (fromCamera ? labels?.cameraBody : labels?.galleryBody) ??
        `Permission to access ${fromCamera ? "camera" : "gallery"} is required!`,
    );
    return null;
  }

  const result = fromCamera
    ? await ImagePicker.launchCameraAsync({ quality: 0.7, cameraType })
    : await ImagePicker.launchImageLibraryAsync({
        quality: 0.7,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];

  // Scale by the LONGER side. This used to always set the width to 1920, so
  // an upright (portrait) photo — narrower than it is tall — was stretched
  // UP to ~1920×3400 and uploaded bigger than it was taken.
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (Math.max(w, h) > size.maxDim) {
    ctx.resize(w >= h ? { width: size.maxDim } : { height: size.maxDim });
  }
  const ref = await ctx.renderAsync();
  const manipulated = await ref.saveAsync({ compress: size.quality, format: SaveFormat.JPEG });

  return { localUri: manipulated.uri, mime_type: "image/jpeg" };
}

type Props = {
  title: string;
  required?: boolean;

  // Small icon shown next to the title, e.g. a dashboard/bus/camera glyph,
  // so a stack of these cards is scannable without reading every label.
  // The icon element carries its own color; this only tints its circle backdrop.
  icon?: React.ReactNode;
  iconAccentLight?: string;

  value?: LocalMedia[];
  onChange?: (media: LocalMedia[]) => void;

  readOnly?: boolean;
  onPressReadOnly?: () => void;

  captureLabel?: string;
  uploadLabel?: string;
  showUploadButton?: boolean;

  disabled?: boolean;

  // When set, selecting a new photo once this many are already present
  // replaces the existing one(s) instead of appending — used for fixed
  // single-photo "slots" (e.g. one photo per side of a vehicle).
  maxItems?: number;
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;

export default function ImagePickerField({
  title,
  required,
  icon,
  iconAccentLight = "#F3F4F6",
  value = [],
  onChange,
  readOnly = false,
  onPressReadOnly,
  captureLabel = "Capture Photo",
  uploadLabel = "Upload Photo",
  showUploadButton = true,
  disabled = false,
  maxItems,
}: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<LocalMedia[]>(value);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

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
    if (readOnly) {
      onPressReadOnly?.();
      return;
    }
    if (disabled) return;

    const newItem = await pickImage(fromCamera, undefined, {
      title: t("common.permissionRequired"),
      cameraBody: t("common.cameraPermissionBody"),
      galleryBody: t("common.galleryPermissionBody"),
    });
    if (!newItem) return;

    commit(
      maxItems && items.length >= maxItems ? [newItem] : [...items, newItem],
    );
  };

  const removeImage = (index: number) => {
    if (readOnly) {
      onPressReadOnly?.();
      return;
    }
    if (disabled) return;
    if (previewIndex !== null) setPreviewIndex(null);
    commit(items.filter((_, i) => i !== index));
  };

  const buttonDisabled = disabled || readOnly;

  const previewItem = previewIndex !== null ? items[previewIndex] : null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          {icon && (
            <View style={[styles.iconBox, { backgroundColor: iconAccentLight }]}>
              {icon}
            </View>
          )}
          <Text style={styles.title}>
            {title} {required ? <Text style={styles.asterisk}>*</Text> : null}
          </Text>
        </View>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{countText}</Text>
        </View>
      </View>

      <Pressable
        style={[
          styles.bigButton,
          buttonDisabled && styles.disabled,
          readOnly && styles.readOnlyButton,
        ]}
        onPress={() => addImage(true)}
        disabled={disabled}
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
              <Pressable
                style={styles.thumbClip}
                onPress={() => setPreviewIndex(idx)}
              >
                <Image source={{ uri: m.localUri }} style={styles.thumb} />
                <View style={styles.thumbOverlay}>
                  <Ionicons name="expand-outline" size={16} color="#fff" />
                </View>
              </Pressable>

              <Pressable
                style={[
                  styles.deleteBtn,
                  (disabled || readOnly) && styles.deleteBtnDisabled,
                ]}
                onPress={() => removeImage(idx)}
                hitSlop={10}
                disabled={disabled}
              >
                <Text style={styles.deleteText}>×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Full-screen photo preview modal */}
      <Modal
        visible={previewItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewIndex(null)}
      >
        <View style={styles.previewModal}>
          {/* Close button */}
          <Pressable
            style={styles.previewClose}
            onPress={() => setPreviewIndex(null)}
            hitSlop={12}
          >
            <Text style={styles.previewCloseText}>✕</Text>
          </Pressable>

          {/* Counter */}
          {items.length > 1 && previewIndex !== null && (
            <View style={styles.previewCounter}>
              <Text style={styles.previewCounterText}>
                {previewIndex + 1} / {items.length}
              </Text>
            </View>
          )}

          {/* Image */}
          {previewItem && (
            <Image
              source={{ uri: previewItem.localUri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}

          {/* Prev / Next navigation */}
          {items.length > 1 && previewIndex !== null && (
            <View style={styles.previewNav}>
              <Pressable
                style={[styles.navBtn, previewIndex === 0 && styles.navBtnDisabled]}
                onPress={() => setPreviewIndex((i) => Math.max(0, (i ?? 1) - 1))}
                disabled={previewIndex === 0}
              >
                <Text style={styles.navBtnText}>‹</Text>
              </Pressable>

              <Pressable
                style={[styles.navBtn, previewIndex === items.length - 1 && styles.navBtnDisabled]}
                onPress={() => setPreviewIndex((i) => Math.min(items.length - 1, (i ?? 0) + 1))}
                disabled={previewIndex === items.length - 1}
              >
                <Text style={styles.navBtnText}>›</Text>
              </Pressable>
            </View>
          )}

          {/* Delete from preview */}
          {!readOnly && !disabled && previewIndex !== null && (
            <Pressable
              style={styles.previewDeleteBtn}
              onPress={() => removeImage(previewIndex)}
            >
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={styles.previewDeleteText}>{t("common.remove")}</Text>
            </Pressable>
          )}
        </View>
      </Modal>
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
    gap: 10,
  },
  titleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flexShrink: 1,
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
  readOnlyButton: { backgroundColor: "#F9FAFB" },
  bigButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  previewRow: { marginTop: 4 },
  previewContent: { paddingRight: 4 },
  thumbWrap: { marginRight: 10, position: "relative" },
  thumbClip: {
    width: 86,
    height: 86,
    borderRadius: 14,
    overflow: "hidden",
  },
  thumb: { width: "100%", height: "100%" },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtnDisabled: { opacity: 0.65 },
  deleteText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 15,
  },

  // Preview modal
  previewModal: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewClose: {
    position: "absolute",
    top: 54,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  previewCloseText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  previewCounter: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  previewCounterText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
  previewImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.72,
  },
  previewNav: {
    position: "absolute",
    bottom: 110,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  navBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  navBtnDisabled: { opacity: 0.25 },
  navBtnText: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "300",
    lineHeight: 36,
  },
  previewDeleteBtn: {
    position: "absolute",
    bottom: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.85)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
  },
  previewDeleteText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
