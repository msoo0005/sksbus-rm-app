import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n/i18n-ctx";

/**
 * Web stand-in for the map location picker.
 *
 * THIS FILE IS WHAT MAKES THE WEB BUILD COMPILE. `react-native-maps` has no web
 * implementation: `MapMarker` imports
 * `react-native/Libraries/Utilities/codegenNativeCommands`, and Metro refuses
 * React Native internals on web, so the bundle fails outright with
 * `map.tsx → form.tsx` in the import stack. Metro resolves `.web.tsx` ahead of
 * `.tsx` for ordinary imports, so this file keeps the native map out of the
 * web bundle entirely.
 *
 * Note it could NOT be fixed by stubbing the route instead. Expo Router
 * enumerates routes with `require.context`, which bundles every matching file —
 * so `form.web.tsx` does not stop `form.tsx` being pulled in, and the map came
 * with it. Platform resolution only prunes normal imports, which is what this
 * is.
 *
 * The interface mirrors the native component exactly so `form.tsx` type-checks
 * on both platforms. It deliberately never calls `onChange`: there is no map to
 * pick from, so a web caller can never satisfy a `required` location. That is
 * correct rather than unfortunate — the report form is mobile-only on web for
 * exactly this reason, and `form.web.tsx` is what users actually see.
 */

export type LocationValue = {
  latitude: number;
  longitude: number;
  address?: string;
};

type Props = {
  label?: string;
  required?: boolean;
  value: LocationValue | null;
  onChange: (value: LocationValue) => void;
};

export default function MapSelector({ label = "Location", required = false }: Props) {
  const { t } = useI18n();

  return (
    <View style={s.wrap}>
      <Text style={s.label}>
        {label}
        {required ? <Text style={s.required}> *</Text> : null}
      </Text>
      <View style={s.box}>
        <Ionicons name="map-outline" size={22} color="#9CA3AF" />
        <Text style={s.text}>{t("mobileOnly.mapUnavailable")}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 14 },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6 },
  required: { color: "#EF4444" },
  box: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 28,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#D1D5DB",
    backgroundColor: "#F9FAFB",
  },
  text: { fontSize: 12, fontWeight: "600", color: "#6B7280", textAlign: "center" },
});
