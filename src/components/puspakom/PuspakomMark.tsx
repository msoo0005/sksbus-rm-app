import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { PSP_BLUE, PSP_ORANGE } from "../../utils/puspakom";

/**
 * PLACEHOLDER for the official PUSPAKOM logo (spec: every PUSPAKOM screen
 * shows it; the home row uses the mark). Swap the Svg for the real artwork
 * when the file is supplied; every screen draws it through this component.
 */
export default function PuspakomMark({ size = 36, withText = true }: { size?: number; withText?: boolean }) {
  const w = size * 1.25;
  return (
    <View style={s.wrap}>
      <Svg width={w} height={size} viewBox="0 0 50 40">
        <Path d="M6 38 L14 6 H36 C44 6 47 12 45 18 C43 25 37 28 30 28 H18 L15 38 Z" fill={PSP_ORANGE} />
        <Path d="M19 22 L22 12 H34 C38 12 39 15 38 17 C37 20 34 22 31 22 Z" fill="#fff" />
        <Path d="M26 2 H42 C48 2 50 7 49 11 L47 11 C47 8 45 6 41 6 H25 Z" fill={PSP_BLUE} />
      </Svg>
      {withText && <Text style={[s.text, { fontSize: Math.max(7, size * 0.22) }]}>PUSPAKOM</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "flex-start" },
  text: { fontWeight: "700", color: "#374151", letterSpacing: 0.3, marginTop: 1 },
});
