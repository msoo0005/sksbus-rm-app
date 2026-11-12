// Offline-first storage for the technician's PUSPAKOM work (spec p.41:
// "every answer, number and photo saves on the phone the moment it is entered
// and syncs to the server when online; the pit and yard may have no signal").
//
// - Each pre-inspection / re-check is a draft in AsyncStorage.
// - Photos are copied into the app's document folder, so they survive the OS
//   clearing its cache, and uploaded when there is a connection.
// - A row is sent only once all its photos are uploaded, with the phone's
//   timestamp (client_ts): the server keeps the newest write, so a phone that
//   was offline never overwrites a newer answer from someone else.
// - Nothing here needs a network-status library: syncing is retried after
//   each edit, every 20 s while a screen is open, and when the app returns to
//   the foreground. A failed fetch just means "try later".

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { ApiError } from "../api/client";
import {
  PspAnswer,
  PspDamage,
  PspDetail,
  PspFailedItem,
  puspakomApi,
  uploadPuspakomPhoto,
} from "../api/puspakom";

export type LocalPhoto = { localUri?: string | null; s3_key?: string | null; url?: string | null };

export type LocalDamage = Omit<PspDamage, "photo_s3_key" | "photo_url"> & { photo: LocalPhoto | null };

export type LocalAnswer = Omit<PspAnswer, "photo_s3_key" | "photo_url" | "damages" | "tag"> & {
  photo: LocalPhoto | null;
  damages: LocalDamage[];
  entered_at: string;
  dirty: boolean;
};

export type LocalFix = {
  check_id: string;
  fixed_text: string;
  photos: LocalPhoto[];
  client_ts: number;
  entered_at: string;
  dirty: boolean;
};

export type Draft = {
  inspectionId: number;
  busId: string;
  kind: "PRE" | "RECHECK";
  answers: Record<string, LocalAnswer>;
  fixes: Record<string, LocalFix>;
  remarks: string;
  /** The server said this is submitted / closed: stop syncing, read only. */
  locked: boolean;
  lastError: string | null;
  lastSyncedAt: number | null;
};

const KEY = (id: number) => `psp:draft:${id}`;
const DETAIL_KEY = (id: number) => `psp:detail:${id}`;
const INDEX_KEY = "psp:drafts";
const PHOTO_DIR = `${FileSystem.documentDirectory ?? ""}puspakom/`;

// ---------------------------------------------------------------------------
// In-memory copy + subscribers, so every open screen sees the same draft.

const cache = new Map<number, Draft>();
const listeners = new Map<number, Set<() => void>>();
const syncing = new Map<number, Promise<void>>();
const syncState = new Map<number, { busy: boolean }>();

function emit(id: number) {
  listeners.get(id)?.forEach((fn) => fn());
}

async function persist(d: Draft) {
  cache.set(d.inspectionId, d);
  emit(d.inspectionId);
  try {
    await AsyncStorage.setItem(KEY(d.inspectionId), JSON.stringify(d));
    const idx = await listDraftIds();
    if (!idx.includes(d.inspectionId)) await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([...idx, d.inspectionId]));
  } catch {
    // Storage full or unavailable: the in-memory copy still syncs.
  }
}

async function listDraftIds(): Promise<number[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(INDEX_KEY)) ?? "[]");
  } catch {
    return [];
  }
}

export async function loadDraft(id: number, busId: string, kind: "PRE" | "RECHECK"): Promise<Draft> {
  const hit = cache.get(id);
  // The booking screen may have opened this id before redirecting a
  // re-inspection to its re-check: an empty draft of the other kind is reused.
  if (hit && hit.kind !== kind && !Object.keys(hit.answers).length && !Object.keys(hit.fixes).length) {
    const fixed = { ...hit, kind };
    cache.set(id, fixed);
    return fixed;
  }
  if (hit) return hit;
  let d: Draft | null = null;
  try {
    const raw = await AsyncStorage.getItem(KEY(id));
    if (raw) d = JSON.parse(raw);
  } catch {
    d = null;
  }
  d = d ?? { inspectionId: id, busId, kind, answers: {}, fixes: {}, remarks: "", locked: false, lastError: null, lastSyncedAt: null };
  if (d.kind !== kind && !Object.keys(d.answers).length && !Object.keys(d.fixes).length) d = { ...d, kind };
  cache.set(id, d);
  return d;
}

/** The draft as it is right now (after a sync, say). */
export function getDraft(id: number): Draft | null {
  return cache.get(id) ?? null;
}

/** The last inspection detail fetched, so the screens open with no signal. */
export async function cachedDetail(id: number): Promise<PspDetail | null> {
  try {
    const raw = await AsyncStorage.getItem(DETAIL_KEY(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveDetail(id: number, detail: PspDetail) {
  try {
    await AsyncStorage.setItem(DETAIL_KEY(id), JSON.stringify(detail));
  } catch {
    // best effort
  }
}

/** Remove a submitted draft and its photo files. */
export async function clearDraft(id: number) {
  const d = cache.get(id);
  cache.delete(id);
  const files = d ? allPhotos(d).map((p) => p.localUri).filter((u): u is string => !!u) : [];
  for (const f of files) await FileSystem.deleteAsync(f, { idempotent: true }).catch(() => {});
  await AsyncStorage.multiRemove([KEY(id), DETAIL_KEY(id)]).catch(() => {});
  const idx = await listDraftIds();
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(idx.filter((x) => x !== id))).catch(() => {});
  emit(id);
}

// ---------------------------------------------------------------------------
// Server ⇄ phone

function photoFromServer(key: string | null | undefined, url?: string | null): LocalPhoto | null {
  return key ? { s3_key: key, url: url ?? null } : null;
}

/**
 * Bring in what the server has: answers other technicians saved, or this
 * phone's own answers after a reinstall. A row edited here and not yet sent
 * is never overwritten; otherwise the newer write wins.
 */
export async function mergeServer(d: Draft, detail: PspDetail) {
  const next: Draft = { ...d, answers: { ...d.answers }, fixes: { ...d.fixes } };
  if (d.kind === "PRE") {
    for (const a of detail.precheck?.answers ?? []) {
      const mine = next.answers[a.check_id];
      if (mine && (mine.dirty || mine.client_ts > a.client_ts)) continue;
      next.answers[a.check_id] = {
        check_id: a.check_id,
        answer: a.answer,
        ng_reason: a.ng_reason,
        note: a.note,
        tread_mm: a.tread_mm,
        pressure_psi: a.pressure_psi,
        pad_mm: a.pad_mm,
        photo: photoFromServer(a.photo_s3_key, a.photo_url) ?? (mine?.photo?.s3_key === a.photo_s3_key ? mine?.photo ?? null : null),
        damages: (a.damages ?? []).map((x) => ({
          no: x.no,
          x_pct: x.x_pct,
          y_pct: x.y_pct,
          where: x.where,
          type: x.type,
          photo: photoFromServer(x.photo_s3_key, x.photo_url),
        })),
        client_ts: a.client_ts,
        entered_at: a.entered_at ?? new Date().toISOString(),
        entered_by: a.entered_by ?? null,
        dirty: false,
      };
    }
    if (detail.precheck?.submitted_at) next.locked = true;
  } else {
    const insp = detail.inspection;
    const items: PspFailedItem[] = detail.failed_items.filter((f) => f.inspection_id === insp?.parent_inspection_id);
    for (const f of items) {
      const mine = next.fixes[f.check_id];
      if (mine && (mine.dirty || mine.client_ts > f.client_ts)) continue;
      next.fixes[f.check_id] = {
        check_id: f.check_id,
        fixed_text: f.fixed_text ?? "",
        photos: f.fix_photos.map((p) => ({ s3_key: p.s3_key, url: p.url })),
        client_ts: f.client_ts,
        entered_at: f.fixed_at ?? new Date().toISOString(),
        dirty: false,
      };
    }
    const re = detail.rechecks.find((r) => r.inspection_id === insp?.inspection_id);
    if (re?.submitted_at) next.locked = true;
  }
  if (detail.inspection?.result) next.locked = true;
  await persist(next);
  return next;
}

// ---------------------------------------------------------------------------
// Edits

/** Copy a just-taken photo into the app's own folder (the picker's file is in the cache). */
export async function keepPhoto(localUri: string): Promise<string> {
  try {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => {});
    const to = `${PHOTO_DIR}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    await FileSystem.copyAsync({ from: localUri, to });
    return to;
  } catch {
    return localUri;
  }
}

export async function updateAnswer(id: number, checkId: string, patch: Partial<LocalAnswer>) {
  const d = cache.get(id);
  if (!d || d.locked) return;
  const cur: LocalAnswer = d.answers[checkId] ?? {
    check_id: checkId,
    answer: null,
    ng_reason: null,
    note: null,
    tread_mm: null,
    pressure_psi: null,
    pad_mm: null,
    photo: null,
    damages: [],
    client_ts: 0,
    entered_at: new Date().toISOString(),
    dirty: true,
  };
  // Strictly increasing, even for two edits in the same millisecond.
  const ts = Math.max(Date.now(), cur.client_ts + 1);
  await persist({
    ...d,
    answers: { ...d.answers, [checkId]: { ...cur, ...patch, client_ts: ts, entered_at: new Date().toISOString(), dirty: true } },
  });
  scheduleSync(id);
}

export async function updateFix(id: number, checkId: string, patch: Partial<LocalFix>) {
  const d = cache.get(id);
  if (!d || d.locked) return;
  const cur: LocalFix = d.fixes[checkId] ?? {
    check_id: checkId,
    fixed_text: "",
    photos: [],
    client_ts: 0,
    entered_at: new Date().toISOString(),
    dirty: true,
  };
  const ts = Math.max(Date.now(), cur.client_ts + 1);
  await persist({
    ...d,
    fixes: { ...d.fixes, [checkId]: { ...cur, ...patch, client_ts: ts, entered_at: new Date().toISOString(), dirty: true } },
  });
  scheduleSync(id);
}

export async function setRemarks(id: number, remarks: string) {
  const d = cache.get(id);
  if (!d || d.locked) return;
  await persist({ ...d, remarks });
}

export async function markLocked(id: number) {
  const d = cache.get(id);
  if (d) await persist({ ...d, locked: true });
}

// ---------------------------------------------------------------------------
// Sync

function allPhotos(d: Draft): LocalPhoto[] {
  const out: LocalPhoto[] = [];
  for (const a of Object.values(d.answers)) {
    if (a.photo) out.push(a.photo);
    for (const x of a.damages) if (x.photo) out.push(x.photo);
  }
  for (const f of Object.values(d.fixes)) out.push(...f.photos);
  return out;
}

const uploaded = (p: LocalPhoto | null | undefined) => !p || !!p.s3_key;

/** Rows and photos still only on the phone. */
export function pendingCount(d: Draft | null): { rows: number; photos: number } {
  if (!d) return { rows: 0, photos: 0 };
  const rows =
    Object.values(d.answers).filter((a) => a.dirty).length + Object.values(d.fixes).filter((f) => f.dirty).length;
  const photos = allPhotos(d).filter((p) => !p.s3_key).length;
  return { rows, photos };
}

const isOffline = (e: unknown) => !(e instanceof ApiError);

const timers = new Map<number, ReturnType<typeof setTimeout>>();
function scheduleSync(id: number, ms = 1500) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      syncDraft(id).catch(() => {});
    }, ms),
  );
}

/**
 * Upload pending photos, then send every finished row. Safe to call any
 * time; concurrent calls share one run. Resolves even when offline.
 */
export function syncDraft(id: number): Promise<void> {
  const running = syncing.get(id);
  if (running) return running;
  const p = runSync(id).finally(() => {
    syncing.delete(id);
    syncState.set(id, { busy: false });
    emit(id);
  });
  syncing.set(id, p);
  syncState.set(id, { busy: true });
  emit(id);
  return p;
}

async function runSync(id: number) {
  let d = cache.get(id);
  if (!d || d.locked) return;

  // 1. Photos, one at a time, saving progress after each so nothing is
  //    uploaded twice if the app is closed half way.
  const upload = async (p: LocalPhoto | null, kind: "check" | "damage" | "fix") => {
    if (!p || p.s3_key || !p.localUri) return p;
    const key = await uploadPuspakomPhoto(d!.busId, kind, { localUri: p.localUri, mime_type: "image/jpeg" });
    return { ...p, s3_key: key };
  };
  try {
    for (const cid of Object.keys(d.answers)) {
      const a = d.answers[cid];
      const photo = await upload(a.photo, "check");
      const damages: LocalDamage[] = [];
      for (const x of a.damages) damages.push({ ...x, photo: await upload(x.photo, "damage") });
      if (photo !== a.photo || damages.some((x, i) => x.photo !== a.damages[i].photo)) {
        d = cache.get(id)!;
        const live = d.answers[cid];
        // Only apply if the row wasn't edited while uploading.
        if (live && live.client_ts === a.client_ts) {
          await persist({ ...d, answers: { ...d.answers, [cid]: { ...live, photo, damages } } });
          d = cache.get(id)!;
        }
      }
    }
    for (const cid of Object.keys(d.fixes)) {
      const f = d.fixes[cid];
      const photos: LocalPhoto[] = [];
      for (const p of f.photos) photos.push((await upload(p, "fix"))!);
      if (photos.some((p, i) => p !== f.photos[i])) {
        d = cache.get(id)!;
        const live = d.fixes[cid];
        if (live && live.client_ts === f.client_ts) {
          await persist({ ...d, fixes: { ...d.fixes, [cid]: { ...live, photos } } });
          d = cache.get(id)!;
        }
      }
    }
  } catch (e) {
    if (!isOffline(e)) await persist({ ...cache.get(id)!, lastError: (e as Error).message });
    return;
  }

  // 2. Rows whose photos are all uploaded.
  d = cache.get(id)!;
  try {
    if (d.kind === "PRE") {
      const ready = Object.values(d.answers).filter(
        (a) => a.dirty && uploaded(a.photo) && a.damages.every((x) => uploaded(x.photo)),
      );
      for (let i = 0; i < ready.length; i += 40) {
        const chunk = ready.slice(i, i + 40);
        await puspakomApi.saveAnswers(
          id,
          chunk.map((a) => ({
            check_id: a.check_id,
            answer: a.answer,
            ng_reason: a.ng_reason,
            note: a.note,
            tread_mm: a.tread_mm,
            pressure_psi: a.pressure_psi,
            pad_mm: a.pad_mm,
            tag: null,
            photo_s3_key: a.photo?.s3_key ?? null,
            damages: a.damages.map((x) => ({
              no: x.no,
              x_pct: x.x_pct,
              y_pct: x.y_pct,
              where: x.where,
              type: x.type,
              photo_s3_key: x.photo?.s3_key ?? null,
            })),
            client_ts: a.client_ts,
            entered_at: a.entered_at,
          })),
        );
        const now = cache.get(id)!;
        const answers = { ...now.answers };
        for (const a of chunk) if (answers[a.check_id]?.client_ts === a.client_ts) answers[a.check_id] = { ...answers[a.check_id], dirty: false };
        await persist({ ...now, answers });
      }
    } else {
      const ready = Object.values(d.fixes).filter((f) => f.dirty && f.photos.every(uploaded));
      if (ready.length) {
        await puspakomApi.saveRecheck(
          id,
          ready.map((f) => ({
            check_id: f.check_id,
            fixed_text: f.fixed_text || null,
            fix_photo_keys: f.photos.map((p) => p.s3_key!),
            client_ts: f.client_ts,
            entered_at: f.entered_at,
          })),
        );
        const now = cache.get(id)!;
        const fixes = { ...now.fixes };
        for (const f of ready) if (fixes[f.check_id]?.client_ts === f.client_ts) fixes[f.check_id] = { ...fixes[f.check_id], dirty: false };
        await persist({ ...now, fixes });
      }
    }
    await persist({ ...cache.get(id)!, lastError: null, lastSyncedAt: Date.now() });
  } catch (e) {
    if (e instanceof ApiError && (e.code === "LOCKED" || e.code === "CLOSED")) {
      await persist({ ...cache.get(id)!, locked: true, lastError: e.message });
    } else if (!isOffline(e)) {
      await persist({ ...cache.get(id)!, lastError: (e as Error).message });
    }
  }
}

/** Sync every draft still on the phone (e.g. when the technician list opens). */
export async function syncAllDrafts() {
  for (const id of await listDraftIds()) {
    try {
      const raw = await AsyncStorage.getItem(KEY(id));
      if (!raw) continue;
      const d: Draft = JSON.parse(raw);
      if (!cache.has(id)) cache.set(id, d);
      if (pendingCount(cache.get(id)!).rows || pendingCount(cache.get(id)!).photos) await syncDraft(id);
    } catch {
      // next time
    }
  }
}

// ---------------------------------------------------------------------------
// React

/**
 * The draft for one inspection, kept in step with the server while the
 * screen is open. `detail` is the latest inspection detail (cached for
 * offline use); `online` is false when the last fetch failed.
 */
export function useInspectionDraft(id: number, kind: "PRE" | "RECHECK") {
  const [detail, setDetail] = useState<PspDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(cache.get(id) ?? null);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const fn = () => {
      if (!mounted.current) return;
      setDraft(cache.get(id) ?? null);
      setBusy(!!syncState.get(id)?.busy);
    };
    const set = listeners.get(id) ?? new Set();
    set.add(fn);
    listeners.set(id, set);
    return () => {
      mounted.current = false;
      set.delete(fn);
    };
  }, [id]);

  const refresh = useCallback(async () => {
    let det: PspDetail | null = null;
    let fresh = false;
    try {
      det = await puspakomApi.inspection(id);
      fresh = true;
      setOnline(true);
      await saveDetail(id, det);
    } catch (e) {
      if (isOffline(e)) setOnline(false);
      det = await cachedDetail(id);
    }
    if (!det) return;
    if (mounted.current) setDetail(det);
    let d = await loadDraft(id, det.bus.bus_id, kind);
    // Only a fresh copy is merged: a cached one is older than the draft.
    if (fresh) d = await mergeServer(d, det);
    if (mounted.current) setDraft(d);
    syncDraft(id).catch(() => {});
  }, [id, kind]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      const d = cache.get(id);
      const p = pendingCount(d ?? null);
      if (p.rows || p.photos) syncDraft(id).catch(() => {});
    }, 20_000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [id, refresh]);

  return { detail, draft, online, busy, refresh };
}
