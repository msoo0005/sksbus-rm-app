// In-app PDF viewer. usePdfDownload downloads a report to the cache and opens
// it here, so it can be read before anything is saved. Save / Share hands the
// same file to the system share sheet (Files, Drive, WhatsApp, email, print).

import { FontAwesome5 } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "@/i18n/i18n-ctx";
import { filePath, getBlobUtil } from "@/utils/blobUtil";

// Only used when this app build has the viewer's native code. On an older
// build (or the dev client running new JS without a rebuild) react-native-pdf
// doesn't throw: it draws an empty view that never reports "loaded". So check
// for the native module first, and otherwise send the file to the share sheet.
let Pdf: any = null;
if (getBlobUtil()) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Pdf = require("react-native-pdf").default;
  } catch {
    Pdf = null;
  }
}

// A PDF that hasn't drawn by now isn't going to: offer Save / Share instead.
const LOAD_TIMEOUT_MS = 15000;

export default function PdfViewerScreen() {
  const { uri, name } = useLocalSearchParams<{ uri: string; name?: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | false>(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);

  const title = name || t("pdf.viewTitle");

  const share = useCallback(async () => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title });
      } else {
        await Linking.openURL(uri);
      }
    } catch (e: any) {
      Alert.alert(t("pdf.failedTitle"), e?.message ?? t("common.unknownError"));
    }
  }, [uri, title, t]);

  useEffect(() => {
    if (!Pdf || !loading || failed) return;
    const h = setTimeout(() => {
      setLoading(false);
      setFailed("timeout");
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(h);
  }, [loading, failed]);

  // Android: hand the file to the phone's own PDF app (Drive, a PDF reader).
  const openElsewhere = useCallback(async () => {
    try {
      await getBlobUtil()?.android?.actionViewIntent(filePath(uri), "application/pdf");
    } catch (e: any) {
      Alert.alert(t("pdf.failedTitle"), e?.message ?? t("common.unknownError"));
    }
  }, [uri, t]);

  // Old build without the viewer: today's behaviour, then back.
  useEffect(() => {
    if (Pdf || !uri) return;
    share().finally(() => router.back());
  }, [share, router, uri]);

  const header = (
    <Stack.Screen
      options={{
        title,
        headerRight: () => (
          <Pressable onPress={share} hitSlop={10} style={s.headerBtn} accessibilityLabel={t("pdf.share")}>
            <FontAwesome5 name="share-square" size={15} color="#111827" />
            <Text style={s.headerBtnText}>{t("pdf.share")}</Text>
          </Pressable>
        ),
      }}
    />
  );

  if (!Pdf || !uri) {
    return (
      <View style={s.center}>
        {header}
        <ActivityIndicator />
      </View>
    );
  }

  if (failed) {
    return (
      <View style={s.center}>
        {header}
        <FontAwesome5 name="file-pdf" size={40} color="#9CA3AF" />
        <Text style={s.failed}>{t("pdf.openFailed")}</Text>
        {failed !== "timeout" && <Text style={s.failedDetail}>{failed}</Text>}
        <Pressable style={s.bigBtn} onPress={share}>
          <FontAwesome5 name="share-square" size={15} color="#fff" />
          <Text style={s.bigBtnText}>{t("pdf.share")}</Text>
        </Pressable>
        {Platform.OS === "android" && (
          <Pressable style={s.secondBtn} onPress={openElsewhere}>
            <FontAwesome5 name="external-link-alt" size={13} color="#111827" />
            <Text style={s.secondBtnText}>{t("pdf.openInApp")}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={s.page}>
      {header}
      <Pdf
        source={{ uri }}
        style={s.pdf}
        fitPolicy={0}
        spacing={8}
        minScale={1}
        maxScale={5}
        enablePaging={false}
        trustAllCerts={false}
        onLoadComplete={(n: number) => {
          setPages(n);
          setLoading(false);
        }}
        onPageChanged={(n: number, total: number) => {
          setPage(n);
          setPages(total);
        }}
        onError={(e: any) => {
          console.warn("[pdf-viewer] render failed", e?.message ?? e);
          setLoading(false);
          setFailed(String(e?.message ?? e ?? "error"));
        }}
        renderActivityIndicator={() => <ActivityIndicator />}
      />
      {loading && (
        <View style={s.overlay} pointerEvents="none">
          <ActivityIndicator size="large" />
        </View>
      )}
      {pages > 0 && (
        <View style={[s.pageTag, { bottom: Math.max(insets.bottom, 12) + 8 }]} pointerEvents="none">
          <Text style={s.pageTagText}>{t("pdf.page", { n: page, total: pages })}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#E5E7EB" },
  pdf: { flex: 1, width: "100%", backgroundColor: "#E5E7EB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24, backgroundColor: "#F9FAFB" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  headerBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  headerBtnText: { fontSize: 14, fontWeight: "800", color: "#111827" },
  failed: { fontSize: 14, color: "#4B5563", textAlign: "center", lineHeight: 20 },
  failedDetail: { fontSize: 11.5, color: "#9CA3AF", textAlign: "center" },
  bigBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: "#111827",
  },
  bigBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  secondBtnText: { color: "#111827", fontSize: 14, fontWeight: "800" },
  pageTag: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(17,24,39,0.75)",
  },
  pageTagText: { color: "#fff", fontSize: 12.5, fontWeight: "700" },
});
