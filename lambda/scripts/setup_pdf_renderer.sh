#!/usr/bin/env bash
#
# Sets up the PDF reports (Job Completion Report + fleet exports). Run it in
# AWS CloudShell (Singapore region), from a folder holding a copy of
# lambda/pdf-renderer (upload the folder as a zip and unzip it):
#
#   bash setup_pdf_renderer.sh path/to/pdf-renderer
#
# Run setup_push_sender.sh first: it adds the free S3 gateway endpoint that
# sksbus-api also needs here.
#
# What it does (each step is safe to re-run):
#   1. Reads sksbus-api's role and S3 bucket.
#   2. Lets sksbus-api queue PDF requests (pdf-queue/*) and read the finished
#      PDFs (reports-pdf/*) so it can hand out download links. ListBucket is
#      what makes S3 answer "not there yet" with 404 rather than 403.
#   3. Builds the renderer (npm install: headless Chrome is ~60 MB) and
#      uploads the zip to S3, because it is too big for a direct upload.
#   4. Creates or updates the sksbus-pdf-renderer Lambda, outside the VPC,
#      with read access to the photos and write access to reports-pdf/*.
#   5. Triggers it for every new file under pdf-queue/ (merged with the
#      bucket's existing triggers, so the push trigger is kept).
#   6. Self-test: renders a tiny export and checks the PDF appears.
#
# Cost: a few seconds of a 2 GB Lambda per PDF, a fraction of a cent each.
set -euo pipefail

SRC="${1:-pdf-renderer}"
[ -f "$SRC/index.mjs" ] || { echo "Usage: bash setup_pdf_renderer.sh path/to/pdf-renderer"; exit 1; }
[ -f "$SRC/assets/SKSCHASSIS_LOGO_BLACK_AND_WHITE.svg" ] || [ -f "$SRC/assets/SKSCHASSIS LOGO BLACK AND WHITE.svg" ] || \
  echo "NOTE: assets/SKSCHASSIS_LOGO_BLACK_AND_WHITE.svg is missing. PDFs will show 'SKS CHASSIS' as text until it is added and this is re-run."

R="${AWS_REGION:-ap-southeast-1}"
API_FN="${API_FN:-sksbus-api}"
FN="sksbus-pdf-renderer"
ROLE="sksbus-pdf-renderer-role"
QUEUE="pdf-queue/"
OUT="reports-pdf/"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
py() { python3 -c "$1"; }

ACCT=$(aws sts get-caller-identity --query Account --output text)

say "1. Reading $API_FN configuration"
CFG=$(aws lambda get-function-configuration --function-name "$API_FN" --region "$R")
API_ROLE=$(echo "$CFG" | py 'import json,sys; print(json.load(sys.stdin)["Role"].split("/")[-1])')
BUCKET=$(echo "$CFG" | py 'import json,sys; print(((json.load(sys.stdin).get("Environment") or {}).get("Variables") or {}).get("S3_BUCKET",""))')
[ -n "$BUCKET" ] || { echo "S3_BUCKET is not set on $API_FN, stopping."; exit 1; }
echo "role: $API_ROLE  bucket: $BUCKET"

say "2. Allow $API_FN to queue PDFs and read finished ones"
aws iam put-role-policy --role-name "$API_ROLE" --policy-name sksbus-pdf-queue --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": \"s3:PutObject\", \"Resource\": \"arn:aws:s3:::$BUCKET/${QUEUE}*\" },
    { \"Effect\": \"Allow\", \"Action\": \"s3:GetObject\", \"Resource\": \"arn:aws:s3:::$BUCKET/${OUT}*\" },
    { \"Effect\": \"Allow\", \"Action\": \"s3:ListBucket\", \"Resource\": \"arn:aws:s3:::$BUCKET\" }
  ]
}"
echo "ok"

say "3. Building the renderer"
WORK=$(mktemp -d)
cp -R "$SRC"/. "$WORK"/
( cd "$WORK" && npm install --omit=dev --no-audit --no-fund >/dev/null && zip -qr renderer.zip index.mjs package.json lib templates assets node_modules )
ls -lh "$WORK/renderer.zip"
CODE_KEY="deploy/$FN.zip"
aws s3 cp "$WORK/renderer.zip" "s3://$BUCKET/$CODE_KEY" --only-show-errors
echo "uploaded s3://$BUCKET/$CODE_KEY"

say "4. $FN (outside the VPC)"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" }, "Action": "sts:AssumeRole" }]
  }' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "Created role $ROLE (waiting for it to propagate)"
  sleep 12
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name sksbus-pdf-renderer-s3 --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": \"s3:GetObject\",
      \"Resource\": [\"arn:aws:s3:::$BUCKET/jobs/*\", \"arn:aws:s3:::$BUCKET/reports/*\", \"arn:aws:s3:::$BUCKET/${QUEUE}*\", \"arn:aws:s3:::$BUCKET/${OUT}*\"] },
    { \"Effect\": \"Allow\", \"Action\": \"s3:DeleteObject\", \"Resource\": \"arn:aws:s3:::$BUCKET/${QUEUE}*\" },
    { \"Effect\": \"Allow\", \"Action\": \"s3:PutObject\", \"Resource\": \"arn:aws:s3:::$BUCKET/${OUT}*\" },
    { \"Effect\": \"Allow\", \"Action\": \"s3:ListBucket\", \"Resource\": \"arn:aws:s3:::$BUCKET\" }
  ]
}"

if aws lambda get-function --function-name "$FN" --region "$R" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --region "$R" \
    --s3-bucket "$BUCKET" --s3-key "$CODE_KEY" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$R"
  aws lambda update-function-configuration --function-name "$FN" --region "$R" \
    --timeout 90 --memory-size 2048 >/dev/null
  echo "Updated $FN"
else
  for i in 1 2 3 4 5; do
    if aws lambda create-function --function-name "$FN" --region "$R" --runtime nodejs20.x \
         --architectures x86_64 --handler index.handler --timeout 90 --memory-size 2048 \
         --ephemeral-storage Size=1024 \
         --role "arn:aws:iam::$ACCT:role/$ROLE" --code "S3Bucket=$BUCKET,S3Key=$CODE_KEY" \
         >/dev/null 2>"$WORK/err"; then
      echo "Created $FN"; break
    fi
    grep -q "cannot be assumed" "$WORK/err" || { cat "$WORK/err"; exit 1; }
    echo "Role not ready yet, retrying in 10s..."; sleep 10
  done
fi
aws lambda wait function-active-v2 --function-name "$FN" --region "$R"

say "5. Trigger $FN on new files in $QUEUE"
aws lambda add-permission --function-name "$FN" --region "$R" --statement-id s3-pdf-queue \
  --action lambda:InvokeFunction --principal s3.amazonaws.com \
  --source-arn "arn:aws:s3:::$BUCKET" --source-account "$ACCT" >/dev/null 2>&1 \
  && echo "Granted S3 permission to invoke" || echo "S3 invoke permission already present"

FN_ARN="arn:aws:lambda:$R:$ACCT:function:$FN"
aws s3api get-bucket-notification-configuration --bucket "$BUCKET" > "$WORK/notif.json" || echo '{}' > "$WORK/notif.json"
FN_ARN="$FN_ARN" QUEUE="$QUEUE" python3 - "$WORK/notif.json" <<'PY'
import json, os, sys
path = sys.argv[1]
raw = open(path).read().strip()
cfg = json.loads(raw) if raw else {}
cfg.pop("ResponseMetadata", None)
lambdas = [c for c in cfg.get("LambdaFunctionConfigurations", []) if c.get("Id") != "sksbus-pdf-queue"]
lambdas.append({
    "Id": "sksbus-pdf-queue",
    "LambdaFunctionArn": os.environ["FN_ARN"],
    "Events": ["s3:ObjectCreated:*"],
    "Filter": {"Key": {"FilterRules": [{"Name": "prefix", "Value": os.environ["QUEUE"]},
                                         {"Name": "suffix", "Value": ".json"}]}},
})
cfg["LambdaFunctionConfigurations"] = lambdas
open(path, "w").write(json.dumps(cfg))
PY
aws s3api put-bucket-notification-configuration --bucket "$BUCKET" \
  --notification-configuration "file://$WORK/notif.json"
echo "ok"

say "6. Self-test"
# A new S3 trigger takes a little while to start firing; a test file dropped
# straight after creating it is silently missed (seen on the first run).
echo "Waiting 45s for the S3 trigger to become active..."
sleep 45
ID="selftest-$(date +%s)"
OUT_KEY="${OUT}selftest/$ID.pdf"
cat > "$WORK/t.json" <<JSON
{"kind":"bus","generated_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","to":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
 "bus":{"bus_id":"SELFTEST","bus_ev_no":"EV000","bus_model":"Test","reports_all_time":0},
 "jobs":0,"downtime_ms":0,"issues":[],"rows":[],"out_bucket":"$BUCKET","out_key":"$OUT_KEY"}
JSON
aws s3api put-object --bucket "$BUCKET" --key "${QUEUE}$ID.json" --body "$WORK/t.json" >/dev/null
for i in $(seq 1 30); do
  sleep 3
  if aws s3api head-object --bucket "$BUCKET" --key "$OUT_KEY" >/dev/null 2>&1; then
    echo "PASS: $FN rendered s3://$BUCKET/$OUT_KEY"
    aws s3 rm "s3://$BUCKET/$OUT_KEY" --only-show-errors || true
    echo
    echo "Logs: CloudWatch Logs Insights on /aws/lambda/$FN:"
    echo '      fields @timestamp, @message | filter @message like /"tag":"PDF"/ | sort @timestamp desc'
    exit 0
  fi
done
echo "FAIL: no PDF after 90s (the first run is slower while Chrome unpacks)."
echo "Check CloudWatch logs for /aws/lambda/$FN, then run this script again."
exit 1
