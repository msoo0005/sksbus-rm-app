import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

// Autosaves a form's state to the device and offers it back next time the
// form is opened.
//
// These forms are long and are filled in on the depot floor — a tyre
// inspection is six tyres of readings plus an odometer — so losing one to a
// phone lock, an incoming call or the OS killing the app is expensive. Saving
// on a debounce means a draft survives all three, which a "discard?" prompt on
// back-out cannot.
//
// Drafts are local to the device and never sync: they hold half-valid data
// that has no business in the database until the user actually submits.

const PREFIX = "draft:";
const SAVE_DEBOUNCE_MS = 800;
// A draft nobody came back to within a week is stale — a tyre's condition has
// moved on by then, and restoring it would be worse than starting fresh.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Stored<T> = { savedAt: number; value: T };

export type FormDraft<T> = {
  /** Null until the stored draft has been read, so the form can wait before rendering. */
  ready: boolean;
  /** A restorable draft found on disk, or null. Cleared once restored or discarded. */
  pending: T | null;
  savedAt: number | null;
  restore: () => T | null;
  discard: () => void;
  /** Wipe the draft — call after a successful submit so it isn't offered again. */
  clear: () => void;
};

export function useFormDraft<T>(
  key: string | null,
  value: T,
  // Drafts are only worth keeping once something has actually been typed;
  // an untouched form would otherwise overwrite a real draft with blanks.
  isDirty: boolean,
): FormDraft<T> {
  const storageKey = key ? `${PREFIX}${key}` : null;
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<T | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Set once the user restores or discards, so the saver doesn't immediately
  // re-offer what they just dismissed.
  const resolved = useRef(false);

  useEffect(() => {
    let cancelled = false;
    resolved.current = false;
    setReady(false);
    setPending(null);
    setSavedAt(null);

    if (!storageKey) {
      setReady(true);
      return;
    }

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as Stored<T>;
          if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
            await AsyncStorage.removeItem(storageKey);
          } else {
            setPending(parsed.value);
            setSavedAt(parsed.savedAt);
          }
        }
      } catch (e) {
        // A corrupt or unreadable draft must never block the form itself.
        console.warn("Failed to read draft", storageKey, e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !ready || !isDirty) return;

    const t = setTimeout(() => {
      AsyncStorage.setItem(
        storageKey,
        JSON.stringify({ savedAt: Date.now(), value } satisfies Stored<T>),
      ).catch((e) => console.warn("Failed to save draft", storageKey, e));
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(t);
  }, [storageKey, ready, isDirty, value]);

  const clear = useCallback(() => {
    resolved.current = true;
    setPending(null);
    setSavedAt(null);
    if (storageKey) {
      AsyncStorage.removeItem(storageKey).catch((e) =>
        console.warn("Failed to clear draft", storageKey, e),
      );
    }
  }, [storageKey]);

  const restore = useCallback(() => {
    resolved.current = true;
    const v = pending;
    setPending(null);
    return v;
  }, [pending]);

  return { ready, pending, savedAt, restore, discard: clear, clear };
}

/**
 * When a draft was last saved, without mounting the full hook.
 *
 * `useFormDraft` needs a live value and dirty flag to autosave; a screen that
 * only wants to say "Resume inspection — saved 20 min ago" has neither, since
 * the form it belongs to isn't on screen yet.
 */
export async function peekDraft(key: string | null): Promise<number | null> {
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<unknown>;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed.savedAt;
  } catch (e) {
    console.warn("Failed to peek draft", key, e);
    return null;
  }
}

export function formatDraftAge(savedAt: number | null): string {
  if (!savedAt) return "";
  const mins = Math.floor((Date.now() - savedAt) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
