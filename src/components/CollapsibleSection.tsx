import { FontAwesome5 } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

// A titled section that starts closed.
//
// Reference material that belongs on a screen but should not be the first thing
// you meet. The bus page stacked nine blocks, so the wheel diagram — the thing
// you came for — sat below the fold under two lists you rarely read.
//
// The header keeps carrying its summary while closed (`meta`), so collapsing
// hides the rows without hiding the fact that they exist or how many there are.
//
// `onFirstOpen` lets a caller defer the request that fills the section until
// someone actually asks for it, following the same shape JobTaskCard already
// uses for its lazily-loaded detail.

type Props = {
  label: string;
  /** Stays visible while closed, e.g. "12 inspections · 3 replacements". */
  meta?: string | null;
  defaultOpen?: boolean;
  onFirstOpen?: () => void;
  children: React.ReactNode;
};

export default function CollapsibleSection({
  label,
  meta,
  defaultOpen = false,
  onFirstOpen,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [hasOpened, setHasOpened] = useState(defaultOpen);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !hasOpened) {
      setHasOpened(true);
      onFirstOpen?.();
    }
  };

  return (
    <View style={s.wrap}>
      <Pressable onPress={toggle} style={s.header} hitSlop={6}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{label}</Text>
          {!!meta && <Text style={s.meta}>{meta}</Text>}
        </View>
        <FontAwesome5 name={open ? "chevron-up" : "chevron-down"} size={12} color="#9CA3AF" />
      </Pressable>
      {open && <View style={s.body}>{children}</View>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 20 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  label: { fontSize: 10, fontWeight: "800", color: "#9CA3AF", letterSpacing: 0.6 },
  meta: { fontSize: 13, fontWeight: "700", color: "#111827", marginTop: 3 },
  body: { marginTop: 10 },
});
