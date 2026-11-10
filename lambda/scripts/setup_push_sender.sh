#!/usr/bin/env bash
#
# Sets up push notifications for a VPC-bound sksbus-api with NO NAT gateway,
# for (almost) free. Run it in AWS CloudShell (Singapore region):
#
#   bash setup_push_sender.sh
#
# What it does — each step is safe to re-run:
#   1. Reads sksbus-api's VPC, subnets, role and S3 bucket.
#   2. Adds a free S3 *gateway* endpoint to that VPC, so sksbus-api can write to
#      S3 without internet access.
#   3. Lets sksbus-api write to s3://<bucket>/push-queue/*.
#   4. Creates (or updates) the sksbus-push-sender Lambda — NOT in a VPC, so it
#      can reach Expo — with read/delete access to push-queue/*.
#   5. Triggers sksbus-push-sender for every new file under push-queue/.
#   6. Self-test: drops an empty job in the queue and checks it gets consumed.
#
# Cost: the gateway endpoint is free; each push is one S3 PUT/GET/DELETE and
# one short Lambda run — fractions of a cent per thousand.
#
# Afterwards, deploy the updated lambda/index.mjs to sksbus-api.
#
# The sender's code below is a copy of lambda/push-sender/index.mjs. After
# changing that file, regenerate this script (or paste the new code here) and
# re-run it.
set -euo pipefail

R="${AWS_REGION:-ap-southeast-1}"
API_FN="${API_FN:-sksbus-api}"
SENDER="sksbus-push-sender"
SENDER_ROLE="sksbus-push-sender-role"
PREFIX="push-queue/"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
py() { python3 -c "$1"; }

ACCT=$(aws sts get-caller-identity --query Account --output text)

say "1. Reading $API_FN configuration"
CFG=$(aws lambda get-function-configuration --function-name "$API_FN" --region "$R")
VPC=$(echo "$CFG" | py 'import json,sys; print((json.load(sys.stdin).get("VpcConfig") or {}).get("VpcId") or "")')
SUBNETS=$(echo "$CFG" | py 'import json,sys; print(" ".join((json.load(sys.stdin).get("VpcConfig") or {}).get("SubnetIds") or []))')
API_ROLE=$(echo "$CFG" | py 'import json,sys; print(json.load(sys.stdin)["Role"].split("/")[-1])')
RUNTIME=$(echo "$CFG" | py 'import json,sys; print(json.load(sys.stdin)["Runtime"])')
BUCKET=$(echo "$CFG" | py 'import json,sys; print(((json.load(sys.stdin).get("Environment") or {}).get("Variables") or {}).get("S3_BUCKET",""))')
EXPO_TOKEN=$(echo "$CFG" | py 'import json,sys; print(((json.load(sys.stdin).get("Environment") or {}).get("Variables") or {}).get("EXPO_ACCESS_TOKEN",""))')
[ -n "$BUCKET" ] || { echo "S3_BUCKET is not set on $API_FN — stopping."; exit 1; }
echo "VPC: ${VPC:-none}  subnets: ${SUBNETS:-none}  role: $API_ROLE  runtime: $RUNTIME  bucket: $BUCKET"

BREG=$(aws s3api get-bucket-location --bucket "$BUCKET" --query LocationConstraint --output text)
[ "$BREG" = "None" ] && BREG="us-east-1"
if [ "$BREG" != "$R" ]; then
  echo "Bucket $BUCKET is in $BREG, not $R — an S3 gateway endpoint only reaches same-region buckets. Stopping."
  exit 1
fi

say "2. S3 gateway endpoint (free)"
if [ -z "$VPC" ]; then
  echo "$API_FN is not in a VPC, so it already has internet access and needs no endpoint."
  echo "(Pushes failing in that case is NOT a network problem — check the PUSH logs.)"
else
  RTS=""
  for s in $SUBNETS; do
    rt=$(aws ec2 describe-route-tables --region "$R" --filters "Name=association.subnet-id,Values=$s" \
          --query 'RouteTables[].RouteTableId' --output text)
    if [ -z "$rt" ] || [ "$rt" = "None" ]; then
      rt=$(aws ec2 describe-route-tables --region "$R" --filters "Name=vpc-id,Values=$VPC" "Name=association.main,Values=true" \
            --query 'RouteTables[].RouteTableId' --output text)
    fi
    RTS="$RTS $rt"
  done
  RTS=$(echo $RTS | tr ' ' '\n' | sort -u | tr '\n' ' ')
  echo "Route tables used by its subnets: $RTS"

  EP=$(aws ec2 describe-vpc-endpoints --region "$R" \
        --filters "Name=vpc-id,Values=$VPC" "Name=service-name,Values=com.amazonaws.$R.s3" "Name=vpc-endpoint-type,Values=Gateway" \
        --query 'VpcEndpoints[0].VpcEndpointId' --output text)
  if [ "$EP" = "None" ] || [ -z "$EP" ]; then
    EP=$(aws ec2 create-vpc-endpoint --region "$R" --vpc-endpoint-type Gateway --vpc-id "$VPC" \
          --service-name "com.amazonaws.$R.s3" --route-table-ids $RTS --query 'VpcEndpoint.VpcEndpointId' --output text)
    echo "Created $EP"
  else
    HAVE=$(aws ec2 describe-vpc-endpoints --region "$R" --vpc-endpoint-ids "$EP" --query 'VpcEndpoints[0].RouteTableIds' --output text)
    MISSING=""
    for rt in $RTS; do echo "$HAVE" | grep -qw "$rt" || MISSING="$MISSING $rt"; done
    if [ -n "$MISSING" ]; then
      aws ec2 modify-vpc-endpoint --region "$R" --vpc-endpoint-id "$EP" --add-route-table-ids $MISSING >/dev/null
      echo "Existing $EP — added route tables:$MISSING"
    else
      echo "Existing $EP already covers them."
    fi
  fi
fi

say "3. Allow $API_FN to write the queue"
aws iam put-role-policy --role-name "$API_ROLE" --policy-name sksbus-push-queue-write --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{ \"Effect\": \"Allow\", \"Action\": \"s3:PutObject\",
                   \"Resource\": \"arn:aws:s3:::$BUCKET/${PREFIX}*\" }]
}"
echo "ok"

say "4. $SENDER (outside the VPC)"
if ! aws iam get-role --role-name "$SENDER_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$SENDER_ROLE" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" }, "Action": "sts:AssumeRole" }]
  }' >/dev/null
  aws iam attach-role-policy --role-name "$SENDER_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "Created role $SENDER_ROLE (waiting for it to propagate)"
  sleep 12
fi
aws iam put-role-policy --role-name "$SENDER_ROLE" --policy-name sksbus-push-queue-read --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{ \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:DeleteObject\"],
                   \"Resource\": \"arn:aws:s3:::$BUCKET/${PREFIX}*\" }]
}"

WORK=$(mktemp -d)
cat > "$WORK/index.mjs" <<'SENDER_JS_EOF'
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
SENDER_JS_EOF
( cd "$WORK" && zip -q sender.zip index.mjs )

ENV_JSON="{\"Variables\":{\"EXPO_ACCESS_TOKEN\":\"$EXPO_TOKEN\"}}"
if aws lambda get-function --function-name "$SENDER" --region "$R" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$SENDER" --region "$R" --zip-file "fileb://$WORK/sender.zip" >/dev/null
  aws lambda wait function-updated --function-name "$SENDER" --region "$R"
  aws lambda update-function-configuration --function-name "$SENDER" --region "$R" \
    --environment "$ENV_JSON" --timeout 30 >/dev/null
  echo "Updated $SENDER"
else
  for i in 1 2 3 4 5; do
    if aws lambda create-function --function-name "$SENDER" --region "$R" --runtime "$RUNTIME" \
         --handler index.handler --timeout 30 --memory-size 256 \
         --role "arn:aws:iam::$ACCT:role/$SENDER_ROLE" --zip-file "fileb://$WORK/sender.zip" \
         --environment "$ENV_JSON" >/dev/null 2>"$WORK/err"; then
      echo "Created $SENDER"; break
    fi
    grep -q "cannot be assumed" "$WORK/err" || { cat "$WORK/err"; exit 1; }
    echo "Role not ready yet, retrying in 10s…"; sleep 10
  done
fi
aws lambda wait function-active-v2 --function-name "$SENDER" --region "$R"

say "5. Trigger $SENDER on new files in $PREFIX"
aws lambda add-permission --function-name "$SENDER" --region "$R" --statement-id s3-push-queue \
  --action lambda:InvokeFunction --principal s3.amazonaws.com \
  --source-arn "arn:aws:s3:::$BUCKET" --source-account "$ACCT" >/dev/null 2>&1 \
  && echo "Granted S3 permission to invoke" || echo "S3 invoke permission already present"

SENDER_ARN="arn:aws:lambda:$R:$ACCT:function:$SENDER"
# Merged into the bucket's EXISTING notification settings — a plain put would
# silently delete any other triggers already on this bucket.
aws s3api get-bucket-notification-configuration --bucket "$BUCKET" > "$WORK/notif.json" || echo '{}' > "$WORK/notif.json"
SENDER_ARN="$SENDER_ARN" PREFIX="$PREFIX" python3 - "$WORK/notif.json" <<'PY'
import json, os, sys
path = sys.argv[1]
raw = open(path).read().strip()
cfg = json.loads(raw) if raw else {}
cfg.pop("ResponseMetadata", None)
lambdas = [c for c in cfg.get("LambdaFunctionConfigurations", []) if c.get("Id") != "sksbus-push-queue"]
lambdas.append({
    "Id": "sksbus-push-queue",
    "LambdaFunctionArn": os.environ["SENDER_ARN"],
    "Events": ["s3:ObjectCreated:*"],
    "Filter": {"Key": {"FilterRules": [{"Name": "prefix", "Value": os.environ["PREFIX"]},
                                         {"Name": "suffix", "Value": ".json"}]}},
})
cfg["LambdaFunctionConfigurations"] = lambdas
open(path, "w").write(json.dumps(cfg))
PY
aws s3api put-bucket-notification-configuration --bucket "$BUCKET" \
  --notification-configuration "file://$WORK/notif.json"
echo "ok"

say "6. Self-test"
TEST_KEY="${PREFIX}selftest-$(date +%s).json"
echo '{"title":"selftest","messages":[]}' > "$WORK/t.json"
aws s3api put-object --bucket "$BUCKET" --key "$TEST_KEY" --body "$WORK/t.json" >/dev/null
for i in $(seq 1 15); do
  sleep 2
  if ! aws s3api head-object --bucket "$BUCKET" --key "$TEST_KEY" >/dev/null 2>&1; then
    echo "PASS — $SENDER picked up and removed the test file."
    echo
    echo "Last step: deploy the updated lambda/index.mjs to $API_FN, then submit a report."
    echo "Logs: CloudWatch Logs Insights on /aws/lambda/$API_FN and /aws/lambda/$SENDER,"
    echo '      fields @timestamp, @message | filter @message like /"tag":"PUSH"/ | sort @timestamp desc'
    exit 0
  fi
done
echo "FAIL — the test file was not consumed within 30s."
echo "Check CloudWatch logs for /aws/lambda/$SENDER, and the bucket's Properties → Event notifications."
exit 1
