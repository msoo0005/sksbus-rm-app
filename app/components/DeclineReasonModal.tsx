import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Props = {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
};

export default function DeclineReasonModal({ visible, onCancel, onSubmit }: Props) {
  const [reason, setReason] = useState('');

  const handleSubmit = () => {
    if (!reason.trim()) return;
    onSubmit(reason.trim());
    setReason('');
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Decline Report</Text>

          <TextInput
            placeholder="Enter reason for declining"
            placeholderTextColor="#9CA3AF"
            value={reason}
            onChangeText={setReason}
            style={styles.input}
            multiline
          />

          <View style={styles.actions}>
            <Pressable style={styles.cancel} onPress={onCancel}>
              <Text>Cancel</Text>
            </Pressable>
            <Pressable style={styles.confirm} onPress={handleSubmit}>
              <Text style={{ color: '#fff' }}>Submit</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancel: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  confirm: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#E53935',
    alignItems: 'center',
  },
});
