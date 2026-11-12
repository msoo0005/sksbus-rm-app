import React from "react";
import Svg, { Circle } from "react-native-svg";

type Props = { size?: number; color?: string };

/**
 * A tyre seen side-on: the band, the rim, and five wheel nuts around the hub.
 * Used for Tyre Management, where the old target icon read as "aim", not tyre.
 */
export default function TyreIcon({ size = 18, color = "#111827" }: Props) {
  const nuts = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    return { cx: 12 + Math.cos(a) * 3.6, cy: 12 + Math.sin(a) * 3.6 };
  });
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={2.4} />
      <Circle cx={12} cy={12} r={6} stroke={color} strokeWidth={1.6} />
      <Circle cx={12} cy={12} r={1.4} fill={color} />
      {nuts.map((n, i) => (
        <Circle key={i} cx={n.cx} cy={n.cy} r={0.9} fill={color} />
      ))}
    </Svg>
  );
}
