import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type ImagePickerFieldProps = {
  value?: string[]; // multiple photo URIs
  onChange: (uris: string[]) => void;
};

export default function ImagePickerField({ value = [], onChange }: ImagePickerFieldProps) {
  const [images, setImages] = useState<string[]>(value);

  const addImage = async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Permission required', `Permission to access ${fromCamera ? 'camera' : 'gallery'} is required!`);
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images });

    if (!result.canceled) {
      const newUri = result.assets[0].uri;
      const updated = [...images, newUri];
      setImages(updated);
      onChange(updated);
    }
  };

  const removeImage = (index: number) => {
    const updated = images.filter((_, i) => i !== index);
    setImages(updated);
    onChange(updated);
  };

  return (
    <View style={styles.card}>
      {/* Header with count */}
      <View style={styles.header}>
        <Text style={styles.headerText}>{images.length} photo{images.length !== 1 ? 's' : ''} attached</Text>
      </View>

      {/* Image preview with delete */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewContainer}>
        {images.map((uri, index) => (
          <View key={index} style={styles.imageWrapper}>
            <Image source={{ uri }} style={styles.image} />
            <TouchableOpacity style={styles.deleteButton} onPress={() => removeImage(index)}>
              <Text style={styles.deleteText}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {/* Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.button} onPress={() => addImage(true)}>
          <Text style={styles.buttonText}>Capture Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => addImage(false)}>
          <Text style={styles.buttonText}>Upload Photo</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 10,
  },
  headerText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  previewContainer: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  imageWrapper: {
    position: 'relative',
    marginRight: 8,
  },
  image: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  deleteButton: {
    position: 'absolute',
    top: 4,      // inside the image
    right: 4,
    backgroundColor: '#EF4444',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    },
  deleteText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  button: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
});
