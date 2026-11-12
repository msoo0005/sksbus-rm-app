import React from "react";
import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line, Rect } from "react-native-svg";

// PLACEHOLDER drawings of an ELC 10M bus, one view per walk-around stop.
// Swap for the official drawings when supplied; pins are placed in % of the
// drawing, so the pin config (PUSPAKOM_CHECK_DEF.pin_x_pct/pin_y_pct) keeps
// working with any artwork of the same view.

export type DrawingView = "cab" | "saloon" | "front" | "left" | "rear" | "right" | "top";

export function viewForStop(stopNo: number): DrawingView | null {
  return ({ 1: "cab", 2: "saloon", 3: "front", 4: "left", 5: "rear", 6: "right" } as Record<number, DrawingView>)[stopNo] ?? null;
}

const RATIO: Record<DrawingView, number> = { cab: 2.6, saloon: 2.6, top: 2.6, left: 2.7, right: 2.7, front: 1.15, rear: 1.15 };

export type Pin = { key: string; label: string; x: number; y: number; color: string; ring?: boolean };

const STROKE = "#4B5563";

function Side({ mirror }: { mirror?: boolean }) {
  // Side view: front of the bus on the left for the left (door) side, on the
  // right for the right side, as the technician sees it walking round.
  const g = (
    <G>
      <Rect x={4} y={10} width={262} height={70} rx={10} fill="#F9FAFB" stroke={STROKE} strokeWidth={1.5} />
      <Rect x={30} y={4} width={160} height={8} rx={3} fill="#E5E7EB" stroke={STROKE} strokeWidth={1} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Rect key={i} x={40 + i * 34} y={20} width={28} height={24} rx={2} fill="#DBEAFE" stroke={STROKE} strokeWidth={1} />
      ))}
      <Rect x={8} y={18} width={24} height={34} rx={4} fill="#DBEAFE" stroke={STROKE} strokeWidth={1} />
      <Rect x={14} y={48} width={18} height={30} fill="#fff" stroke={STROKE} strokeWidth={1} />
      <Rect x={118} y={48} width={20} height={30} fill="#fff" stroke={STROKE} strokeWidth={1} />
      <Circle cx={55} cy={82} r={13} fill="#374151" />
      <Circle cx={55} cy={82} r={5} fill="#9CA3AF" />
      <Circle cx={212} cy={82} r={13} fill="#374151" />
      <Circle cx={212} cy={82} r={5} fill="#9CA3AF" />
    </G>
  );
  return mirror ? <G transform="translate(270,0) scale(-1,1)">{g}</G> : g;
}

function Face({ rear }: { rear?: boolean }) {
  return (
    <G>
      <Rect x={6} y={6} width={98} height={84} rx={10} fill="#F9FAFB" stroke={STROKE} strokeWidth={1.5} />
      {rear ? (
        <Rect x={22} y={14} width={66} height={22} rx={3} fill="#DBEAFE" stroke={STROKE} strokeWidth={1} />
      ) : (
        <Rect x={14} y={12} width={82} height={40} rx={5} fill="#DBEAFE" stroke={STROKE} strokeWidth={1} />
      )}
      <Rect x={12} y={rear ? 60 : 62} width={14} height={10} rx={2} fill={rear ? "#FCA5A5" : "#FEF3C7"} stroke={STROKE} strokeWidth={1} />
      <Rect x={84} y={rear ? 60 : 62} width={14} height={10} rx={2} fill={rear ? "#FCA5A5" : "#FEF3C7"} stroke={STROKE} strokeWidth={1} />
      <Rect x={38} y={rear ? 66 : 74} width={34} height={10} rx={1} fill="#fff" stroke={STROKE} strokeWidth={1} />
      <Rect x={14} y={90} width={14} height={6} fill="#374151" />
      <Rect x={82} y={90} width={14} height={6} fill="#374151" />
    </G>
  );
}

function Inside({ cab }: { cab?: boolean }) {
  return (
    <G>
      <Rect x={4} y={4} width={262} height={92} rx={14} fill="#F9FAFB" stroke={STROKE} strokeWidth={1.5} />
      <Line x1={40} y1={6} x2={40} y2={94} stroke={STROKE} strokeWidth={1} strokeDasharray="3 3" />
      <Rect x={12} y={60} width={20} height={20} rx={4} fill={cab ? "#FED7AA" : "#E5E7EB"} stroke={STROKE} strokeWidth={1} />
      {Array.from({ length: 7 }).map((_, i) => (
        <G key={i}>
          <Rect x={56 + i * 29} y={10} width={20} height={16} rx={3} fill={cab ? "#E5E7EB" : "#DBEAFE"} stroke={STROKE} strokeWidth={0.8} />
          <Rect x={56 + i * 29} y={74} width={20} height={16} rx={3} fill={cab ? "#E5E7EB" : "#DBEAFE"} stroke={STROKE} strokeWidth={0.8} />
        </G>
      ))}
      <Rect x={44} y={82} width={22} height={12} fill="#fff" stroke={STROKE} strokeWidth={1} />
      <Rect x={148} y={82} width={22} height={12} fill="#fff" stroke={STROKE} strokeWidth={1} />
    </G>
  );
}

const VIEWBOX: Record<DrawingView, string> = {
  cab: "0 0 270 100",
  saloon: "0 0 270 100",
  top: "0 0 270 100",
  left: "0 0 270 100",
  right: "0 0 270 100",
  front: "0 0 110 100",
  rear: "0 0 110 100",
};

/**
 * The drawing for a stop, with numbered pins. `onPlace` turns it into a
 * "tap where the damage is" surface, reporting the tap in % of the drawing.
 */
export default function BusDrawing({
  view,
  pins = [],
  onPin,
  onPlace,
  caption,
}: {
  view: DrawingView;
  pins?: Pin[];
  onPin?: (key: string) => void;
  onPlace?: (x: number, y: number) => void;
  caption?: string;
}) {
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const tap = (e: GestureResponderEvent) => {
    if (!onPlace || !size.w) return;
    const { locationX, locationY } = e.nativeEvent;
    onPlace(Math.max(0, Math.min(100, (locationX / size.w) * 100)), Math.max(0, Math.min(100, (locationY / size.h) * 100)));
  };
  const narrow = view === "front" || view === "rear";
  return (
    <View style={s.wrap}>
      <Pressable
        disabled={!onPlace}
        onPress={tap}
        style={[s.canvas, narrow && { width: "45%" }, { aspectRatio: RATIO[view] }]}
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <Svg width="100%" height="100%" viewBox={VIEWBOX[view]} preserveAspectRatio="xMidYMid meet">
          {view === "left" && <Side />}
          {view === "right" && <Side mirror />}
          {view === "front" && <Face />}
          {view === "rear" && <Face rear />}
          {(view === "cab" || view === "top") && <Inside cab />}
          {view === "saloon" && <Inside />}
        </Svg>
        {pins.map((p) => (
          <Pressable
            key={p.key}
            disabled={!onPin}
            onPress={() => onPin?.(p.key)}
            hitSlop={6}
            style={[
              s.pin,
              { left: `${p.x}%`, top: `${p.y}%`, backgroundColor: p.color },
              p.ring && { borderColor: p.color, backgroundColor: "#fff" },
            ]}
          >
            <Text style={[s.pinText, p.ring && { color: p.color }]}>{p.label}</Text>
          </Pressable>
        ))}
      </Pressable>
      {!!caption && <Text style={s.caption}>{caption}</Text>}
    </View>
  );
}

/** Default pin spots when the config has none: spread across the drawing. */
export function defaultPinSpot(index: number, count: number, view: DrawingView): { x: number; y: number } {
  const x = count <= 1 ? 50 : 10 + (80 * index) / (count - 1);
  const y = view === "front" || view === "rear" ? 30 + (index % 3) * 20 : index % 2 === 0 ? 40 : 65;
  return { x, y };
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 6 },
  canvas: { width: "100%", position: "relative" },
  pin: {
    position: "absolute",
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  pinText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  caption: { fontSize: 11, color: "#9CA3AF", marginTop: 4 },
});
