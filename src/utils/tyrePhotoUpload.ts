import { api } from "../api/client";
import type { LocalMedia } from "../components/ImagePicker";

// Presign-and-PUT for the tyre forms' photos.
//
// The tyre flows have no separate /confirm step, unlike job and report media:
// the returned key is passed straight into swapTyre() or
// createTyreInspectionSession(), which is what ties the photo to its record. So
// the upload has to happen BEFORE the record is created, and this is the shared
// half of that. It lived privately inside TyreReplacementModal until the
// inspection form needed it too.

export type TyrePhotoKind = "install" | "retread_sticker" | "sidewall";

async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return await res.blob();
}

/** Uploads and returns the S3 key. Throws if the PUT fails. */
export async function uploadTyrePhoto(media: LocalMedia, kind: TyrePhotoKind): Promise<string> {
  const presign = await api.presignTyrePhoto(media.mime_type, kind);
  const blob = await uriToBlob(media.localUri);
  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": media.mime_type },
    body: blob,
  });
  if (!put.ok) throw new Error(`Photo upload failed (${put.status})`);
  return presign.s3_key;
}

// NOTE: there was an uploadTyrePhotoBestEffort() here, which swallowed upload
// failures and returned undefined. It existed for sidewall damage photos while
// those were optional. They are now mandatory on both the inspection and the
// replacement form — and the server rejects an NC sidewall without one — so a
// swallowed failure would just move the error to the server and strip it of the
// context needed to say which tyre was at fault. Do not bring it back for this
// purpose.
