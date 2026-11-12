import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned under the scrolling content (e.g. Reset / Show n). */
  footer?: React.ReactNode;
  /** Let the sheet grow to most of the screen (long lists). */
  tall?: boolean;
};

/**
 * Bottom sheet over a dimmed screen. Tapping outside, the × or the system
 * back gesture closes it without applying anything.
 */
export default function Sheet({ visible, title, subtitle, onClose, children, footer, tall }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.flex}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={[s.sheet, tall && s.tall, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={s.grabber} />
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{title}</Text>
              {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={s.close} accessibilityLabel="Close">
              <FontAwesome5 name="times" size={14} color="#374151" />
            </Pressable>
          </View>
          <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer && <View style={s.footer}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(17,24,39,0.45)" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  tall: { maxHeight: "92%", minHeight: "60%" },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", marginTop: 8 },
  head: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: "#111827" },
  subtitle: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  close: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 18 },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 10 },
});
