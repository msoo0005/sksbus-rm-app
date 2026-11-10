import { api, VerificationKind } from "./client";

export async function uploadReportImage(
  reportId: number,
  file: { uri: string; mimeType: string; size?: number }
) {
  // 1) presign
  const presign = await api.request<{
    uploadUrl: string;
    s3_key: string;
    s3_bucket: string;
  }>(`/reports/${reportId}/media/presign?mime=${encodeURIComponent(file.mimeType)}`);

  // 2) upload to S3
  const blob = await (await fetch(file.uri)).blob();
  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.mimeType },
    body: blob,
  });
  if (!put.ok) throw new Error("Upload to S3 failed");

  // 3) confirm
  await api.request(`/reports/${reportId}/media/confirm`, {
    method: "POST",
    body: JSON.stringify({
      s3_key: presign.s3_key,
      mime_type: file.mimeType,
      size_bytes: file.size,
    }),
  });

  return presign.s3_key;
}

// Uploads the selfie for an approve/accept sign-off and returns its S3 key,
// which the caller then sends with the approve/accept request itself.
export async function uploadVerificationSelfie(
  kind: VerificationKind,
  id: number,
  selfie: { localUri: string; mime_type: string },
) {
  const presign = await api.presignVerificationSelfie(kind, id, selfie.mime_type);
  const blob = await (await fetch(selfie.localUri)).blob();
  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": selfie.mime_type },
    body: blob,
  });
  if (!put.ok) throw new Error(`Selfie upload failed (${put.status})`);
  return presign.s3_key;
}
