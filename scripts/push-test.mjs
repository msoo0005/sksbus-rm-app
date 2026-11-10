#!/usr/bin/env node
// Sends one test push straight to Expo (bypassing the app's server) and waits
// for the delivery receipt, so you can see exactly what Apple/Google said.
//
//   node scripts/push-test.mjs                       # token 37 (user 3)
//   node scripts/push-test.mjs "ExponentPushToken[…]"
//
// If "Enhanced push security" is on in the Expo project, also set
//   EXPO_ACCESS_TOKEN=… node scripts/push-test.mjs
//
// This puts a real notification on the device that owns the token.

const TOKEN = process.argv[2] ?? "ExponentPushToken[c32EP4IPi_sBveJSqVX0Ne]"; // PUSH_TOKEN row 37
const EXPO = "https://exp.host/--/api/v2/push";
const POLL_EVERY_MS = 5_000;
const GIVE_UP_AFTER_MS = 3 * 60_000;

// What each Expo error means for this app, and what to do about it.
const EXPLAIN = {
  DeviceNotRegistered:
    "The token is dead (app deleted/reinstalled, or notifications revoked). Open the app on that phone so it registers a new token.",
  InvalidCredentials:
    "Apple/Google rejected the project's push credentials. iPhone: run `eas credentials` → iOS → Push Notifications and make sure a push key is assigned to com.anonymous.sksbus-rm-app, then rebuild and reinstall.",
  MessageTooBig: "The payload is over 4KB — not expected for a test message.",
  MessageRateExceeded: "Too many pushes to this device too quickly. Wait a minute and retry.",
  MismatchSenderId: "Android only: the FCM credentials don't match the build. Check FCM V1 credentials in `eas credentials`.",
  ExpoError: "Expo-side failure — the message field has details.",
};

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
};

async function post(path, body) {
  const res = await fetch(`${EXPO}/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null; the raw text is printed below
  }
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status} from ${path}:\n${text}`);
    if (res.status === 401) {
      console.error("\n→ Enhanced push security is on. Re-run with EXPO_ACCESS_TOKEN set (the same value the Lambda needs).");
    }
    process.exit(1);
  }
  return json;
}

function explain(details, message) {
  const code = details?.error;
  console.log(`  error:   ${code ?? "(none given)"}`);
  if (message) console.log(`  message: ${message}`);
  console.log(`\n→ ${EXPLAIN[code] ?? "Unrecognised error — see https://docs.expo.dev/push-notifications/sending-notifications/#individual-errors"}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`Sending test push to ${TOKEN}${headers.Authorization ? " (with access token)" : ""}…`);

// 1. Send. The ticket only says Expo accepted the message.
const sent = await post("send", {
  to: TOKEN,
  title: "SKS Bus push test",
  body: `Test sent ${new Date().toLocaleTimeString()} — if you can read this, push works on this phone.`,
  sound: "default",
  priority: "high",
  data: { type: "push_test" },
});

const ticket = Array.isArray(sent?.data) ? sent.data[0] : sent?.data;
console.log("\nTicket:", JSON.stringify(ticket));

if (ticket?.status !== "ok") {
  console.log("\n✗ Expo refused the message before trying to deliver it.");
  explain(ticket?.details, ticket?.message);
  process.exit(1);
}

// 2. Receipt. This is Apple's/Google's actual answer — credential problems
// show up here, not in the ticket.
console.log(`\n✓ Accepted by Expo (ticket ${ticket.id}). Waiting for the delivery receipt…`);

const started = Date.now();
while (Date.now() - started < GIVE_UP_AFTER_MS) {
  await sleep(POLL_EVERY_MS);
  const receipts = await post("getReceipts", { ids: [ticket.id] });
  const receipt = receipts?.data?.[ticket.id];
  if (!receipt) {
    process.stdout.write(".");
    continue;
  }

  console.log(`\n\nReceipt: ${JSON.stringify(receipt)}`);
  if (receipt.status === "ok") {
    console.log(
      "\n✓ Apple/Google accepted it for delivery.\n" +
        "→ If the phone still showed nothing: check Focus / Do Not Disturb, Settings → sksbus-rm-app → Notifications\n" +
        "  (Allow, Banners, Lock Screen), and Notification Summary. Then the problem is on the phone, not the server.",
    );
    process.exit(0);
  }
  console.log("\n✗ Delivery failed.");
  explain(receipt.details, receipt.message);
  process.exit(1);
}

console.log(
  `\n\n? No receipt after ${GIVE_UP_AFTER_MS / 60_000} minutes. Receipts can take up to 15 minutes —\n` +
    `  check later with:\n` +
    `  curl -s -X POST ${EXPO}/getReceipts -H "Content-Type: application/json" -d '{"ids":["${ticket.id}"]}'`,
);
process.exit(2);
