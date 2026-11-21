// A "Done" bar on top of the iPhone keyboard for boxes that can't close it
// themselves: number pads have no return key, and in a multi-line box return
// adds a new line. Without this, the only way out was a tap somewhere else.
//
// Built on InputAccessoryView, which iOS treats as part of the keyboard, so
// every screen and popup that already moves out of the keyboard's way clears
// this bar too. Android keyboards have their own close key and back gesture.
//
// Use: give the TextInput inputAccessoryViewID={KEYBOARD_DONE_ID}, and render
// <KeyboardDoneAccessory /> once in the same window: the app layout covers the
// screens, and every popup (Modal) renders its own.

import React from "react";
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/i18n/i18n-ctx";

export const KEYBOARD_DONE_ID = "keyboard-done";

export function KeyboardDoneAccessory() {
  const { t } = useI18n();
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View style={s.bar}>
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10} style={s.btn} accessibilityRole="button">
          <Text style={s.text}>{t("common.done")}</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    height: 44,
    paddingHorizontal: 16,
    backgroundColor: "#F3F4F6",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#D1D5DB",
  },
  btn: { paddingVertical: 6, paddingHorizontal: 4 },
  text: { fontSize: 16, fontWeight: "700", color: "#2563EB" },
});
