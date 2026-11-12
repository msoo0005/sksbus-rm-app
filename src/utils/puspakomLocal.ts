// Rules applied to the phone's draft rows (photos may be local, not uploaded).

import type { PspCheckDef, PspSettings, PspTag } from "../api/puspakom";
import type { LocalAnswer } from "../offline/puspakomDrafts";
import { ATTENTION_TAGS, answerDone, answerTag } from "./puspakom";

const hasPhoto = (p: { localUri?: string | null; s3_key?: string | null } | null | undefined) => !!(p?.localUri || p?.s3_key);

function asAnswer(a: LocalAnswer | undefined) {
  if (!a) return undefined;
  return {
    ...a,
    photo_s3_key: hasPhoto(a.photo) ? "local" : null,
    damages: a.damages.map((d) => ({ ...d, photo_s3_key: hasPhoto(d.photo) ? "local" : null })),
  };
}

export function localDone(def: PspCheckDef, a: LocalAnswer | undefined): boolean {
  return answerDone(def.answer_type, asAnswer(a) as any);
}

export function localTag(def: PspCheckDef, a: LocalAnswer | undefined, s: PspSettings): PspTag | null {
  return answerTag(def.answer_type, asAnswer(a) as any, s);
}

export function needsAttention(def: PspCheckDef, a: LocalAnswer | undefined, s: PspSettings): boolean {
  return ATTENTION_TAGS.includes(localTag(def, a, s) as PspTag);
}

export function photoUri(p: { localUri?: string | null; url?: string | null } | null | undefined): string | null {
  return p?.localUri || p?.url || null;
}

export { hasPhoto };
