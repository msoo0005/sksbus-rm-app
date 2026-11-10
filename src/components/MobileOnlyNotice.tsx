import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../i18n/i18n-ctx";

/**
 * Stands in for a screen that only makes sense on a phone.
 *
 * Some flows are shop-floor work: they photograph a physical vehicle, capture a
 * verification selfie at the moment the work happens, or pin a location on a
 * map. A desk browser can open a file picker, but a file picker is not a camera
 * standing in front of a bus, and the evidence rules in those forms exist for
 * audit reasons. Rather than ship a half-working version, the web build says so
 * plainly and points the user at the app.
 *
 * This also does real technical work. Metro resolves `.web.tsx` ahead of
 * `.tsx`, so a route that renders this on web never imports its native
 * counterpart — which is how `react-native-maps` stays out of the web bundle
 * entirely. Without that, the web build does not compile at all: `MapMarker`
 * imports `react-native/Libraries/Utilities/codegenNativeCommands`, and Metro
 * refuses native internals on web.
 */

type Props = {
  /** What the screen does, e.g. "Filing a report". */
  title: string;
  /** Why it needs a phone — one sentence, specific rather than generic. */
  reason: string;
};

export default function MobileOnlyNotice({ title, reason }: Props) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <View style={s.page}>
      <View style={s.card}>
        <View style={s.iconWrap}>
          <FontAwesome5 name="mobile-alt" size={26} color="#4F46E5" />
        </View>

        <Text style={s.title}>{title}</Text>
        <Text style={s.reason}>{reason}</Text>
        <Text style={s.hint}>{t("mobileOnly.hint")}</Text>

        {router.canGoBack() && (
          <Pressable style={s.btn} onPress={() => router.back()}>
            <FontAwesome5 name="arrow-left" size={12} color="#fff" />
            <Text style={s.btnText}>{t("mobileOnly.back")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: 18,
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
  },
  reason: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 19,
  },
  hint: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: "700",
    color: "#4F46E5",
    textAlign: "center",
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 22,
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
