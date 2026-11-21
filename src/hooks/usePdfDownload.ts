import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Linking, Platform } from "react-native";
import type { PdfStatus } from "../api/client";
import { useI18n } from "../i18n/i18n-ctx";
import { filePath, getBlobUtil } from "../utils/blobUtil";

const POLL_MS = 2500;
// The first PDF after a quiet spell waits for the renderer to start Chrome.
const TIMEOUT_MS = 90_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * PDFs are made on the server (sksbus-pdf-renderer). This asks for one, waits
 * while it is "pending", downloads it, and shows it before anything is saved:
 *  - iPhone: iOS's own document preview (as in Mail and Files), with zoom,
 *    pages and its share button for Save to Files, WhatsApp, email or print.
 *  - Android: the in-app viewer (app/(app)/pdf-viewer.tsx), with Save / Share.
 * A build without the viewer's native code goes to the share sheet as before.
 *
 * `run` takes the request to make: e.g. () => api.jobReportPdf(jobId).
 */
export function usePdfDownload() {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(
    async (getStatus: () => Promise<PdfStatus>) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      try {
        const deadline = Date.now() + TIMEOUT_MS;
        let st = await getStatus();
        while (st.status !== "ready") {
          if (Date.now() > deadline) throw new Error(t("pdf.timeout"));
          await sleep(POLL_MS);
          st = await getStatus();
        }

        const name = (st.filename || "report.pdf").replace(/[^A-Za-z0-9_.-]+/g, "_");
        const dir = FileSystem.cacheDirectory;
        if (!dir) {
          await Linking.openURL(st.url);
          return;
        }
        const { uri } = await FileSystem.downloadAsync(st.url, `${dir}${name}`);
        const blob = getBlobUtil();
        if (Platform.OS === "ios" && blob?.ios?.presentPreview) {
          await blob.ios.presentPreview(filePath(uri));
          return;
        }
        router.push({ pathname: "/pdf-viewer", params: { uri, name } } as any);
      } catch (e: any) {
        Alert.alert(t("pdf.failedTitle"), e?.message ?? t("common.unknownError"));
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [t, router],
  );

  return { busy, run };
}
