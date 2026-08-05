import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useI18n } from '../i18n/i18n-ctx';

type Props = {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
};

export default function DeclineReasonModal({ visible, onCancel, onSubmit }: Props) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const isValid = !!reason.trim();

  const handleSubmit = () => {
    if (!isValid) {
      setTouched(true);
      return;
    }
    onSubmit(reason.trim());
    setReason('');
    setTouched(false);
  };

  const handleCancel = () => {
    setReason('');
    setTouched(false);
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modal}>
          <Text style={styles.title}>{t('declineModal.title')}</Text>

          <TextInput
            placeholder={t('declineModal.placeholder')}
            placeholderTextColor="#9CA3AF"
            value={reason}
            onChangeText={(v) => {
              setReason(v);
              if (touched) setTouched(false);
            }}
            style={[styles.input, touched && !isValid && styles.inputError]}
            multiline
          />
          {touched && !isValid && (
            <Text style={styles.errorText}>{t('declineModal.requiredError')}</Text>
          )}

          <View style={styles.actions}>
            <Pressable style={styles.cancel} onPress={handleCancel}>
              <Text>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirm, !isValid && styles.confirmDisabled]}
              onPress={handleSubmit}
            >
              <Text style={{ color: '#fff' }}>{t('declineModal.submit')}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  inputError: { borderColor: '#E53935' },
  errorText: { color: '#E53935', fontSize: 12, fontWeight: '600', marginTop: 6 },
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
  confirmDisabled: { opacity: 0.5 },
});
