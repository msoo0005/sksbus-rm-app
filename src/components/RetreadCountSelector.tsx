import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

// How many times a tyre has been retreaded, as the four buckets the yard tracks:
// never, once, twice, or three times. Three is a HARD MAXIMUM, not a "3+" — a
// casing retreaded three times is at the end of its life and cannot legitimately
// be recorded as retreaded again.
//
// Mirrors TYRE_RETREAD_COUNTS / TYRE_MAX_RETREAD_BUCKET in lambda/index.mjs,
// which rejects anything above the ceiling on write.

export const RETREAD_OPTIONS = [0, 1, 2, 3] as const;
// Legacy rows may hold a higher number (the previous scheme's top bucket was 2
// and meant "two or more"); they read back as 3 and are never written down.
export const RETREAD_MAX_BUCKET = 3;

export function retreadLabel(count: number | null | undefined): string {
  const n = Number(count ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return String(Math.min(Math.floor(n), RETREAD_MAX_BUCKET));
}

/** " · Retread ×2" for a row's meta line, or "" when never retreaded. */
export function retreadSuffix(count: number | null | undefined): string {
  const n = Number(count ?? 0);
  return Number.isFinite(n) && n > 0 ? ` · Retread ×${retreadLabel(n)}` : "";
}

/** The bucket a stored value falls into, so a legacy 5 clamps to the ceiling. */
export function toRetreadBucket(count: number | null | undefined): number {
  const n = Number(count ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), RETREAD_MAX_BUCKET);
}

/** A casing at the ceiling has no retreads left in it. */
export function isRetreadEndOfLife(count: number | null | undefined): boolean {
  return toRetreadBucket(count) >= RETREAD_MAX_BUCKET;
}

type Props = {
  value: number;
  onChange: (next: number) => void;
  /** A tyre cannot un-retread, so buckets below what's on record are locked. */
  minimum?: number;
  disabled?: boolean;
  /** Hide the end-of-life note, e.g. where space is tight. */
  showEndOfLifeNote?: boolean;
};

export default function RetreadCountSelector({
  value,
  onChange,
  minimum = 0,
  disabled,
  showEndOfLifeNote = true,
}: Props) {
  const floor = toRetreadBucket(minimum);
  const atEndOfLife = isRetreadEndOfLife(value);

  return (
    <View>
      <View style={s.row}>
        {RETREAD_OPTIONS.map((n) => {
          const active = toRetreadBucket(value) === n;
          const locked = n < floor;
          const max = n === RETREAD_MAX_BUCKET;
          return (
            <Pressable
              key={n}
              style={[s.btn, active && s.btnActive, active && max && s.btnMax, locked && s.btnLocked]}
              disabled={disabled || locked}
              onPress={() => onChange(n)}
            >
              <Text
                style={[
                  s.text,
                  active && s.textActive,
                  active && max && s.textMax,
                  locked && s.textLocked,
                ]}
              >
                {retreadLabel(n)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {showEndOfLifeNote && atEndOfLife && (
        <Text style={s.eolNote}>
          {RETREAD_MAX_BUCKET} is the maximum — this casing cannot be retreaded again.
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
  },
  btnActive: { borderColor: "#111827", backgroundColor: "#fff" },
  btnMax: { borderColor: "#B45309", backgroundColor: "#FFFBEB" },
  btnLocked: { opacity: 0.4 },
  text: { fontSize: 15, fontWeight: "800", color: "#9CA3AF" },
  textActive: { color: "#111827" },
  textLocked: { color: "#D1D5DB" },
  textMax: { color: "#B45309" },
  eolNote: { marginTop: 8, fontSize: 11, fontWeight: "700", color: "#B45309" },
});
