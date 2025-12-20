import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

type Props = {
  title: string;
  required?: boolean;

  value?: string[];
  onChange?: (uris: string[]) => void;

  readOnly?: boolean;

  captureLabel?: string;
  uploadLabel?: string;
  showUploadButton?: boolean;
};

export default function ImagePickerField({
  title,
  required,
  value = [],
  onChange,
  readOnly = false,
  captureLabel = 'Capture Photo',
  uploadLabel = 'Upload Photo',
  showUploadButton = true,
}: Props) {
  const [images, setImages] = useState<string[]>(value);

  useEffect(() => setImages(value), [value]);

  const countText = useMemo(() => {
    const n = images.length;
    return `${n} photo${n === 1 ? '' : 's'}`;
  }, [images.length]);

  const commit = (next: string[]) => {
    setImages(next);
    onChange?.(next);
  };

  const addImage = async (fromCamera: boolean) => {
    if (readOnly) return;

    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Permission required',
        `Permission to access ${fromCamera ? 'camera' : 'gallery'} is required!`
      );
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({
          quality: 0.7,
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
        });

    if (!result.canceled && result.assets?.length) {
      commit([...images, result.assets[0].uri]);
    }
  };

  const removeImage = (index: number) => {
    if (readOnly) return;
    commit(images.filter((_, i) => i !== index));
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
        <Pressable style={styles.bigButton} onPress={() => addImage(true)}>
          <Ionicons name="camera-outline" size={18} color="#111827" />
          <Text style={styles.bigButtonText}>{captureLabel}</Text>
        </Pressable>
      )}

      {!readOnly && showUploadButton && (
        <Pressable style={styles.bigButton} onPress={() => addImage(false)}>
          <Ionicons name="cloud-upload-outline" size={18} color="#111827" />
          <Text style={styles.bigButtonText}>{uploadLabel}</Text>
        </Pressable>
      )}

      {images.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.previewRow}
          contentContainerStyle={styles.previewContent}
        >
          {images.map((uri, idx) => (
            <View key={`${uri}-${idx}`} style={styles.thumbWrap}>
              {/* ✅ Clip everything to the rounded thumbnail so delete stays INSIDE */}
              <View style={styles.thumbClip}>
                <Image source={{ uri }} style={styles.thumb} />

                {!readOnly && (
                  <Pressable
                    style={styles.deleteBtn}
                    onPress={() => removeImage(idx)}
                    hitSlop={10}
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
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  asterisk: { color: '#111827' },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  bigButton: {
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
  },
  bigButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  previewRow: {
    marginTop: 4,
  },

  // ✅ Gives the row a bit of breathing space so nothing touches edges
  previewContent: {
    paddingRight: 4,
  },

  thumbWrap: {
    marginRight: 10,
  },

  // ✅ This is the key: a clipping container with same radius
  thumbClip: {
    width: 86,
    height: 86,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },

  thumb: {
    width: '100%',
    height: '100%',
  },

  // ✅ Put it INSIDE (positive inset), not outside (negative)
  deleteBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 16,
  },
});
