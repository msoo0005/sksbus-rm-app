#!/usr/bin/env bash
#
# Creates the daily EventBridge schedule that drives the tyre digest.
#
# ⚠️ This is NOT an API Gateway route. add_missing_apigw_routes.sh cannot do
# this and this cannot do that — they are different integrations. An HTTP route
# lets a signed-in user call the Lambda; this lets EventBridge invoke it on a
# timer with no user and no JWT. The Lambda tells them apart by the absence of
# `requestContext` plus the presence of `task` (see the top of the handler).
#
# Schedule: 01:00 UTC = 09:00 Malaysia, so alerts are waiting at the start of
# the working day. Classic EventBridge rules are UTC-only; Malaysia has no
# daylight saving, so a fixed offset is correct year-round.
#
# Usage:  FN=<lambda-name> ./add_scheduled_trigger.sh
# Safe to re-run: put-rule and put-targets are upserts, and the duplicate
# add-permission is tolerated.
set -euo pipefail

FN="${FN:?Set FN to the Lambda function name}"
REGION="${AWS_REGION:-ap-southeast-1}"
RULE="${RULE:-sksbus-tyre-daily}"
SCHEDULE="${SCHEDULE:-cron(0 1 * * ? *)}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
LAMBDA_ARN="$(aws lambda get-function --function-name "$FN" --region "$REGION" \
  --query 'Configuration.FunctionArn' --output text)"
RULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${RULE}"

echo "Function : $LAMBDA_ARN"
echo "Rule     : $RULE_ARN"
echo "Schedule : $SCHEDULE  (01:00 UTC = 09:00 Asia/Kuala_Lumpur)"
echo

aws events put-rule --name "$RULE" --region "$REGION" \
  --schedule-expression "$SCHEDULE" \
  --description "Daily tyre digest: overdue inspections and low tread" >/dev/null
echo "  rule created/updated"

# Idempotent: a repeated statement id is an error we can safely ignore.
if aws lambda add-permission --function-name "$FN" --region "$REGION" \
  --statement-id "${RULE}-invoke" \
  --action lambda:InvokeFunction --principal events.amazonaws.com \
  --source-arn "$RULE_ARN" >/dev/null 2>&1; then
  echo "  invoke permission added"
else
  echo "  invoke permission already present"
fi

aws events put-targets --rule "$RULE" --region "$REGION" \
  --targets "Id=1,Arn=${LAMBDA_ARN},Input='{\"task\":\"tyre_daily\"}'" >/dev/null
echo "  target set"

echo
echo "Test it WITHOUT waiting for the schedule:"
echo "  aws lambda invoke --function-name $FN --region $REGION \\"
echo "    --cli-binary-format raw-in-base64-out \\"
echo "    --payload '{\"task\":\"tyre_daily\"}' /dev/stdout"
echo
echo "Run it twice — the second run should report skipped>0 and insert nothing,"
echo "which proves the dedupe table is working."
