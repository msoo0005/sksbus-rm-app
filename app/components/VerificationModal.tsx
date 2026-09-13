import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useI18n } from "../i18n/i18n-ctx";
import { LocalMedia, pickImage } from "./ImagePicker";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  submitting?: boolean;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (payload: { selfie: LocalMedia; name: string }) => void;
};

// A final identity check bolted onto report submission and job completion —
// separate from whoever is logged in, since the account holder isn't
// necessarily the person physically standing there. Requires a fresh
// front-camera selfie plus a name typed on the spot (never pre-filled from
// the account, so it can't be skimmed past without noticing).
export default function VerificationModal({
  visible,
  title,
  message,
  submitting = false,
  confirmLabel,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  const [selfie, setSelfie] = useState<LocalMedia | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (visible) {
      setSelfie(null);
      setName("");
    }
  }, [visible]);

  const takeSelfie = async () => {
    if (submitting) return;
    const result = await pickImage(true, ImagePicker.CameraType.front);
    if (result) setSelfie(result);
  };

  const canConfirm = !!selfie && name.trim().length > 0 && !submitting;

  const handleConfirm = () => {
    if (!selfie || !name.trim()) return;
    onConfirm({ selfie, name: name.trim() });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.card}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.message}>{message}</Text>

          <Pressable
            style={[s.selfieBox, submitting && s.disabled]}
            onPress={takeSelfie}
            disabled={submitting}
          >
            {selfie ? (
              <>
                <Image source={{ uri: selfie.localUri }} style={s.selfieImg} />
                <View style={s.retakeOverlay}>
                  <Ionicons name="camera-reverse-outline" size={16} color="#fff" />
                  <Text style={s.retakeText}>{t("verification.retake")}</Text>
                </View>
              </>
            ) : (
              <View style={s.selfiePlaceholder}>
                <Ionicons name="camera-outline" size={28} color="#111827" />
                <Text style={s.selfiePlaceholderText}>{t("verification.takeSelfie")}</Text>
              </View>
            )}
          </Pressable>

          <Text style={s.fieldLabel}>{t("verification.nameLabel")}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("verification.namePlaceholder")}
            placeholderTextColor="#9CA3AF"
            style={s.nameInput}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!submitting}
          />

          <View style={s.buttons}>
            <Pressable style={s.cancelBtn} onPress={onCancel} disabled={submitting}>
              <Text style={s.cancelText}>{t("common.cancel")}</Text>
            </Pressable>

            <Pressable
              style={[s.confirmBtn, !canConfirm && s.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={!canConfirm}
            >
              <Text style={s.confirmText}>
                {submitting ? t("verification.confirming") : confirmLabel ?? t("verification.confirm")}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 22,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 6,
  },
  message: {
    fontSize: 13,
    fontWeight: "500",
    color: "#6B7280",
    marginBottom: 18,
    lineHeight: 19,
  },
  disabled: { opacity: 0.6 },

  selfieBox: {
    alignSelf: "center",
    width: 140,
    height: 140,
    borderRadius: 70,
    overflow: "hidden",
    backgroundColor: "#F9FAFB",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderStyle: "dashed",
    marginBottom: 20,
  },
  selfieImg: { width: "100%", height: "100%" },
  selfiePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  selfiePlaceholderText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    paddingHorizontal: 10,
  },
  retakeOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  retakeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },

  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    backgroundColor: "#F9FAFB",
    marginBottom: 20,
  },

  buttons: {
    flexDirection: "row",
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
  },
  cancelText: {
    fontWeight: "700",
    color: "#374151",
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#111827",
  },
  confirmBtnDisabled: {
    backgroundColor: "#D1D5DB",
  },
  confirmText: {
    fontWeight: "700",
    color: "#fff",
  },
});
