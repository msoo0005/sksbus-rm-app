import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { roleColorsFor } from "@/utils/roles";

/** First letter of the name (A6: "No photo = the name's initial"). */
export function nameInitial(name?: string | null) {
  const n = (name ?? "").trim();
  return n ? n[0].toUpperCase() : "?";
}

type Props = {
  name?: string | null;
  photoUrl?: string | null;
  role?: string | null;
  size?: number;
};

// The user's My profile photo, or their initial on the role colour. Used in
// the header, the account menu and My profile so all three always agree.
export default function UserAvatar({ name, photoUrl, role, size = 34 }: Props) {
  const color = roleColorsFor(role);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={[s.img, box]} />;
  }
  return (
    <View style={[s.initialBox, box, { backgroundColor: color.accent }]}>
      <Text style={[s.initial, { fontSize: Math.round(size * 0.42) }]}>{nameInitial(name)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  img: { backgroundColor: "#E5E7EB" },
  initialBox: { alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontWeight: "800" },
});
