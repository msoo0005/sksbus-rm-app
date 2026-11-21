// react-native-blob-util, only when this app build has its native code.
//
// It isn't imported statically: on a build from before the PDF viewer the JS
// would load but every call would fail, since the native module is missing.
// The TurboModule lookup is the reliable test for "is it in this build".

import { NativeModules, TurboModuleRegistry } from "react-native";

let cached: any | null | undefined;

export function getBlobUtil(): any | null {
  if (cached !== undefined) return cached;
  try {
    const native = TurboModuleRegistry.get("ReactNativeBlobUtil") ?? (NativeModules as any).ReactNativeBlobUtil;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = native ? require("react-native-blob-util").default : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** A plain filesystem path from a file:// URI, as blob-util expects. */
export function filePath(uri: string) {
  return decodeURIComponent(String(uri).replace(/^file:\/\//i, ""));
}
