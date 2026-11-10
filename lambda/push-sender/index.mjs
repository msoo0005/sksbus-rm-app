// push-sender/index.mjs (ESM) — deployed as its own Lambda, `sksbus-push-sender`.
//
// Why this exists: sksbus-api runs inside a VPC (to reach RDS) with no NAT
// gateway, so it has no internet access and every call to Expo's push API
// timed out. A NAT gateway costs ~US$35/month. Instead:
//
//   sksbus-api  ──PutObject──▶  s3://<bucket>/push-queue/<id>.json
//               (free S3 gateway endpoint, no internet needed)
//
//   S3 "object created" event ──▶ this function (NOT in a VPC, so it has
//   internet) ──▶ exp.host ──▶ Apple / Google ──▶ phones
//
// It never touches the database: sksbus-api has already turned user ids into
// push tokens, so each queued file is a ready-to-send list of Expo messages.
//
// Each file is deleted once handled, sent or not, so the prefix stays empty.
//
// Logs use the same {"tag":"PUSH", stage, ...} shape as sksbus-api, so one
// Logs Insights query reads both: filter @message like /"tag":"PUSH"/
//
// Deployed and wired up by lambda/scripts/setup_push_sender.sh, which embeds
// a copy of this file: re-run that script after changing it.

import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
// Needed only if "Enhanced Security for Push Notifications" is on in Expo.
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN || null;
const EXPO = "https://exp.host/--/api/v2/push";
const SEND_TIMEOUT_MS = 10_000;
// Receipts (Apple's/Google's actual verdict) are usually ready within seconds.
// One check here catches project-level faults like InvalidCredentials, which
// never show up in the send response.
const RECEIPT_DELAY_MS = 5_000;

function plog(stage, fields = {}) {
  console.log(JSON.stringify({ tag: "PUSH", stage, ...fields }));
}

const maskToken = (t) =>
  typeof t === "string" && t.length > 12 ? `${t.slice(0, 18)}…${t.slice(-7)}` : String(t);

const headers = {
  Accept: "application/json",
  "Accept-Encoding": "gzip, deflate",
  "Content-Type": "application/json",
  ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
};

async function expo(path, body) {
  const res = await fetch(`${EXPO}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function sendJob(job, key) {
  const messages = Array.isArray(job?.messages) ? job.messages : [];
  if (!messages.length) {
    plog("sender.skip", { key, reason: "no_messages" });
    return;
  }

  const ticketIds = [];
  let ok = 0;
  const errors = [];

  // Expo accepts at most 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const { data: tickets = [] } = await expo("send", chunk);
      tickets.forEach((t, idx) => {
        if (t?.status === "ok") {
          ok += 1;
          if (t.id) ticketIds.push(t.id);
        } else {
          errors.push({ token: maskToken(chunk[idx]?.to), message: t?.message, detail: t?.details?.error });
        }
      });
    } catch (e) {
      errors.push({ chunk: i / 100 + 1, errName: e?.name, errMessage: e?.message });
    }
  }

  plog("sender.sent", { key, title: job.title, messages: messages.length, ticketsOk: ok, errors });

  if (!ticketIds.length) return;

  await new Promise((r) => setTimeout(r, RECEIPT_DELAY_MS));
  try {
    const { data: receipts = {} } = await expo("getReceipts", { ids: ticketIds });
    const failed = Object.entries(receipts)
      .filter(([, r]) => r?.status !== "ok")
      .map(([id, r]) => ({ id, message: r?.message, detail: r?.details?.error }));
    plog("sender.receipts", {
      key,
      checked: ticketIds.length,
      ready: Object.keys(receipts).length,
      delivered: Object.values(receipts).filter((r) => r?.status === "ok").length,
      failed,
    });
  } catch (e) {
    plog("sender.receipts.fail", { key, errName: e?.name, errMessage: e?.message });
  }
}

export const handler = async (event) => {
  for (const record of event?.Records ?? []) {
    const Bucket = record?.s3?.bucket?.name;
    // S3 event keys are URL-encoded, with spaces as "+".
    const Key = decodeURIComponent(String(record?.s3?.object?.key ?? "").replace(/\+/g, " "));
    if (!Bucket || !Key) continue;

    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket, Key }));
      const job = JSON.parse(await obj.Body.transformToString());
      await sendJob(job, Key);
    } catch (e) {
      plog("sender.fail", { key: Key, errName: e?.name, errMessage: e?.message });
    } finally {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket, Key }));
      } catch (e) {
        plog("sender.delete.fail", { key: Key, errMessage: e?.message });
      }
    }
  }
  return { ok: true };
};
