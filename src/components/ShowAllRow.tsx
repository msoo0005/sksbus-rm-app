import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

export default function ShowAllRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={s.row} onPress={onPress}>
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { paddingVertical: 12, alignItems: "center" },
  text: { fontSize: 12, fontWeight: "700", color: "#4F46E5" },
});
