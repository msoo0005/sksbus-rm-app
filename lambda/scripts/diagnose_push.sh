#!/usr/bin/env bash
#
# Phase 0 push diagnostics — read-only, changes nothing.
#
# Push used to fail completely silently, so the first job is working out WHERE
# it stops. Run this before changing anything; it usually names the gate.
#
# Usage:  FN=<lambda-name> ./diagnose_push.sh
set -euo pipefail

FN="${FN:?Set FN to the Lambda function name}"
REGION="${AWS_REGION:-ap-southeast-1}"
SINCE=$(( ($(date +%s) - 86400) * 1000 ))

echo "=============================================================="
echo " 1. Lambda configuration"
echo "=============================================================="
aws lambda get-function-configuration --function-name "$FN" --region "$REGION" \
  --query '{Runtime:Runtime,Timeout:Timeout,MemorySize:MemorySize,
            Subnets:VpcConfig.SubnetIds,SecurityGroups:VpcConfig.SecurityGroupIds,
            EnvKeys:keys(Environment.Variables)}' --output json
echo
echo "  Runtime must be nodejs18.x or newer — global fetch() does not exist"
echo "  before Node 18, and the push send would throw on every attempt."
echo "  Empty Subnets means the function is not VPC-attached, so egress to"
echo "  exp.host is fine and NAT is a non-issue."
echo

echo "=============================================================="
echo " 2. Egress check (only meaningful if VPC-attached above)"
echo "=============================================================="
SUBNETS=$(aws lambda get-function-configuration --function-name "$FN" --region "$REGION" \
  --query 'VpcConfig.SubnetIds' --output text 2>/dev/null || true)
if [ -z "$SUBNETS" ] || [ "$SUBNETS" = "None" ]; then
  echo "  Not VPC-attached — nothing to check."
else
  for SN in $SUBNETS; do
    ROUTE=$(aws ec2 describe-route-tables --region "$REGION" \
      --filters "Name=association.subnet-id,Values=$SN" \
      --query 'RouteTables[].Routes[?DestinationCidrBlock==`0.0.0.0/0`].[NatGatewayId,GatewayId]' \
      --output text 2>/dev/null || true)
    case "$ROUTE" in
      *nat-*) echo "  $SN -> NAT ($ROUTE) — egress OK" ;;
      *igw-*) echo "  $SN -> IGW ($ROUTE) — BROKEN: a Lambda ENI has no public IP, so an internet gateway gives no egress" ;;
      *)      echo "  $SN -> no default route — BROKEN: cannot reach exp.host" ;;
    esac
  done
fi
echo

echo "=============================================================="
echo " 3. The decisive log grep (last 24h)"
echo "=============================================================="
echo "  The in-app bell works, so a NOTIFICATION row was written and execution"
echo "  reached the push send. There are four ways out and three of them log."
echo
for P in "Failed to send push notifications" "Expo push send failed" \
         "Task timed out" "fetch is not defined" '"tag":"PUSH"'; do
  echo "--- $P ---"
  aws logs filter-log-events --log-group-name "/aws/lambda/$FN" --region "$REGION" \
    --start-time "$SINCE" --filter-pattern "\"$P\"" \
    --query 'events[].message' --output text 2>/dev/null | head -20 || echo "  (none)"
  echo
done

cat <<'NOTE'
==============================================================
 How to read the above
==============================================================
  All empty, and no "tag":"PUSH" lines
      -> You are still on the OLD Lambda. Deploy the updated one; it logs
         every stage under tag "PUSH" and cannot exit silently.

  "tag":"PUSH" present, ending in push.skip reason=no_tokens
      -> PUSH_TOKEN is empty: no device has ever registered. Most likely
         cause, given POST /me/push-token used to 404 at API Gateway.
         Fix: force-quit and reopen the app, then re-check (query below).

  "tag":"PUSH" ending in push.summary with ticketsError > 0
      -> Read the `detail` on each error. InvalidCredentials means the Expo
         project has no APNs push key. DeviceNotRegistered tokens are now
         pruned automatically.

  EAI_AGAIN / ENOTFOUND / Task timed out
      -> VPC without NAT. Infrastructure fix, not a code fix.

  "fetch is not defined"
      -> Runtime is Node 16 or older. Upgrade to nodejs18.x or newer.

  "Expo push send failed" with 400/401
      -> Expo rejected the request. Enable EXPO_ACCESS_TOKEN (see below).

==============================================================
 Database checks (run against RDS)
==============================================================
  SELECT COUNT(*) total, COUNT(DISTINCT user_id) users, MAX(updated_at) last_seen
  FROM PUSH_TOKEN;

  -- rows the send-time regex silently discards
  SELECT * FROM PUSH_TOKEN
  WHERE expo_push_token NOT REGEXP '^Expo(nent)?PushToken\[.+\]$';

  -- BEFORE enabling project scoping: anyone with 0 rows here stops being
  -- notified. Backfill first, or set NOTIFY_PROJECT_SCOPE=0.
  SELECT u.user_role, COUNT(*) users, SUM(up.user_id IS NULL) without_project
  FROM `USER` u
  LEFT JOIN (SELECT DISTINCT user_id FROM USER_PROJECT) up ON up.user_id = u.user_id
  GROUP BY u.user_role;

==============================================================
 Expo checks
==============================================================
  npx eas credentials -p ios      # a Push Key must exist for com.anonymous.sksbus-rm-app
  expo.dev -> project -> Project settings -> Notifications
      If "Enhanced Security for Push Notifications" is ON, set the Lambda env
      var EXPO_ACCESS_TOKEN. The code sends Authorization only when it is set.

  ⚠️ `aws lambda update-function-configuration --environment` REPLACES the
     whole variables map. Read the current one and merge, or you will wipe
     DB_HOST/S3_BUCKET and take the API down.

  Bypass the Lambda entirely with a real token from the query above:
     curl -s -X POST https://exp.host/--/api/v2/push/send \
       -H 'Content-Type: application/json' \
       -d '{"to":"ExponentPushToken[...]","title":"probe","body":"probe","priority":"high"}'
     A per-ticket "status":"error" here proves the problem is the token or the
     Expo credentials, not the Lambda.
NOTE
