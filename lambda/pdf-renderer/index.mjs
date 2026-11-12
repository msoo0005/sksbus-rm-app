// pdf-renderer/index.mjs (ESM): deployed as its own Lambda, `sksbus-pdf-renderer`.
//
// Turns a report request into a PDF. Same arrangement as the push sender:
//
//   sksbus-api ──PutObject──▶ s3://<bucket>/pdf-queue/<name>.json
//   S3 "object created" ──▶ this function ──▶ s3://<bucket>/reports-pdf/...pdf
//
// sksbus-api has already gathered every field from the database, so this
// function never touches it. It runs outside the VPC, with headless Chrome
// (@sparticuz/chromium + puppeteer-core), which is what the Job Completion
// Report spec asks for.
//
// A Job Completion Report is generated once and kept: if the output file
// already exists the request is dropped, so every download is identical.
// Fleet exports are always rendered fresh.
//
// Deployed by lambda/scripts/setup_pdf_renderer.sh.

import {
  S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand,
} from "@aws-sdk/client-s3";

import { buildJobCompletionHtml } from "./templates/jobCompletion.mjs";
import { loadAssets, renderPdf } from "./lib/render.mjs";
import { buildRangeReportHtml, buildBusReportHtml } from "./templates/fleetReports.mjs";

const s3 = new S3Client({});

function log(stage, fields = {}) {
  console.log(JSON.stringify({ tag: "PDF", stage, ...fields }));
}

// ── S3 helpers ────────────────────────────────────────────────────────────
async function exists(Bucket, Key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket, Key }));
    return true;
  } catch (e) {
    const status = e?.$metadata?.httpStatusCode;
    if (status === 404 || status === 403 || e?.name === "NotFound") return false;
    throw e;
  }
}

async function getBuffer(Bucket, Key) {
  const obj = await s3.send(new GetObjectCommand({ Bucket, Key }));
  return Buffer.from(await obj.Body.transformToByteArray());
}

function mimeFor(key) {
  const k = String(key).toLowerCase();
  if (k.endsWith(".png")) return "image/png";
  if (k.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

// Photos are embedded at their stored resolution (resized to 1600 px on the
// longer side at upload), comfortably above the spec's 1200 px minimum.
async function embedPhotos(list, defaultBucket) {
  return Promise.all(
    (list ?? []).map(async (p) => {
      try {
        const buf = await getBuffer(p.bucket || defaultBucket, p.key);
        return { ...p, src: `data:${mimeFor(p.key)};base64,${buf.toString("base64")}` };
      } catch (e) {
        log("photo.fail", { key: p.key, message: e?.message });
        return { ...p, src: null };
      }
    })
  );
}

export async function buildHtml(job) {
  const assets = loadAssets();
  if (job.kind === "job") {
    const bucket = job.out_bucket;
    const data = {
      ...job,
      report_photos: await embedPhotos(job.report_photos, bucket),
      after_photos: await embedPhotos(job.after_photos, bucket),
      tasks: await Promise.all((job.tasks ?? []).map(async (t) => ({ ...t, photos: await embedPhotos(t.photos, bucket) }))),
    };
    return buildJobCompletionHtml(data, { ...assets, generatedAt: new Date() });
  }
  if (job.kind === "range") return buildRangeReportHtml(job, assets);
  if (job.kind === "bus") return buildBusReportHtml(job, assets);
  throw new Error(`Unknown report kind: ${job.kind}`);
}

async function handleOne(Bucket, Key) {
  const job = JSON.parse((await getBuffer(Bucket, Key)).toString("utf8"));
  const outBucket = job.out_bucket || Bucket;
  if (!job.out_key) throw new Error("out_key missing");

  if (job.kind === "job" && (await exists(outBucket, job.out_key))) {
    log("skip.exists", { key: Key, out: job.out_key });
    return;
  }

  const started = Date.now();
  const html = await buildHtml(job);
  const { pdf, pages } = await renderPdf(html);
  await s3.send(
    new PutObjectCommand({
      Bucket: outBucket,
      Key: job.out_key,
      Body: pdf,
      ContentType: "application/pdf",
    })
  );
  log("rendered", { key: Key, out: job.out_key, pages, bytes: pdf.length, ms: Date.now() - started });
}

export const handler = async (event) => {
  for (const record of event?.Records ?? []) {
    const Bucket = record?.s3?.bucket?.name;
    const Key = decodeURIComponent(String(record?.s3?.object?.key ?? "").replace(/\+/g, " "));
    if (!Bucket || !Key) continue;
    try {
      await handleOne(Bucket, Key);
    } catch (e) {
      log("fail", { key: Key, errName: e?.name, errMessage: e?.message });
    } finally {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket, Key }));
      } catch (e) {
        log("delete.fail", { key: Key, errMessage: e?.message });
      }
    }
  }
  return { ok: true };
};
