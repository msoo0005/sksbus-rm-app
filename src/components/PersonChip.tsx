import { FontAwesome5 } from "@expo/vector-icons";
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  // Name typed at the sign-off (verified name). Falls back to the username.
  name?: string | null;
  // The account's username, shown as @username under the name.
  username?: string | null;
  selfieUrl?: string | null;
  size?: number;
  // Optional leading line, e.g. "Reported by".
  label?: string | null;
  onPressPhoto?: (url: string) => void;
};

// Who did something: their sign-off selfie, the name they typed, and the
// account username — shown together wherever the app says "by …", so it is
// always clear both *who was there* and *whose login was used*.
export default function PersonChip({
  name,
  username,
  selfieUrl,
  size = 32,
  label,
  onPressPhoto,
}: Props) {
  const displayName = (name ?? "").trim() || (username ?? "").trim() || "—";
  const user = (username ?? "").trim();
  const showUsername = !!user && user.toLowerCase() !== displayName.toLowerCase();
  const radius = size / 2;

  return (
    <View style={s.row}>
      <Pressable
        onPress={() => selfieUrl && onPressPhoto?.(selfieUrl)}
        disabled={!selfieUrl || !onPressPhoto}
      >
        {selfieUrl ? (
          <Image
            source={{ uri: selfieUrl }}
            style={[s.photo, { width: size, height: size, borderRadius: radius }]}
          />
        ) : (
          <View
            style={[s.photo, s.placeholder, { width: size, height: size, borderRadius: radius }]}
          >
            <FontAwesome5 name="user" size={Math.round(size * 0.42)} color="#9CA3AF" solid />
          </View>
        )}
      </Pressable>
      <View style={s.text}>
        {!!label && <Text style={s.label}>{label}</Text>}
        <Text style={s.name} numberOfLines={1}>{displayName}</Text>
        {showUsername && <Text style={s.username} numberOfLines={1}>@{user}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  photo: { borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F3F4F6" },
  placeholder: { alignItems: "center", justifyContent: "center" },
  text: { flexShrink: 1 },
  label: { fontSize: 11, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.4 },
  name: { fontSize: 14, fontWeight: "800", color: "#111827" },
  username: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
});
