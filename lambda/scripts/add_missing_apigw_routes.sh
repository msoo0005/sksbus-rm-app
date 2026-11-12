#!/usr/bin/env bash
#
# Adds the API Gateway routes the Lambda handles but the HTTP API never had.
#
# Symptom this fixes: the app shows a bare "Error / Not Found". That message is
# API Gateway's own 404 body, returned before the Lambda is ever invoked — the
# Lambda's own 404 reads "Not found: GET /some/path" instead. A request to an
# unregistered route 404s without running the JWT authorizer, which is how you
# can tell the two apart without signing in:
#
#   curl -s -o /dev/null -w '%{http_code}\n' "$API_BASE/reports/1/selfie/presign"
#     404 -> route missing from API Gateway   (this script fixes it)
#     401 -> route exists, you just aren't authenticated
#
# Every route below was verified missing on 2026-09-13. They reuse the same
# Lambda integration and JWT authorizer as the existing routes, so nothing new
# is created besides the route entries themselves.
#
# Usage:  API_ID=1tph3rn0e1 ./add_missing_apigw_routes.sh
set -euo pipefail

API_ID="${API_ID:?Set API_ID, e.g. API_ID=1tph3rn0e1}"
REGION="${AWS_REGION:-ap-southeast-1}"

# Reuse whatever integration and authorizer the existing routes already point
# at, rather than hardcoding ids that differ per environment.
read -r INTEGRATION_ID AUTHORIZER_ID <<<"$(
  aws apigatewayv2 get-routes --api-id "$API_ID" --region "$REGION" \
    --query "Items[?Target!=null && AuthorizerId!=null] | [0].[Target, AuthorizerId]" \
    --output text | sed 's#integrations/##'
)"

if [ -z "${INTEGRATION_ID:-}" ] || [ "$INTEGRATION_ID" = "None" ]; then
  echo "Could not read an existing integration from api $API_ID — check API_ID and credentials." >&2
  exit 1
fi
echo "Using integration $INTEGRATION_ID, authorizer $AUTHORIZER_ID"

ROUTES=(
  # Push notification registration — without these, no device ever registers a
  # token, so push notifications silently never arrive.
  "POST /me/push-token"
  "DELETE /me/push-token"

  # Finalises a report once its selfie and photos are uploaded. Reports are
  # created as invisible drafts, so without this route nothing a user submits
  # ever reaches a reviewer.
  "POST /reports/{report_id}/submit"

  # Identity-verification selfies. These are what produce the "Not Found" error
  # on submitting a report, and would do the same on completing a job.
  "GET /reports/{report_id}/selfie/presign"
  "POST /reports/{report_id}/selfie/confirm"
  "GET /jobs/{job_id}/selfie/presign"
  "POST /jobs/{job_id}/selfie/confirm"

  # Job detail — the job screen's own fetch, its parts list and its timeline.
  "GET /jobs/{job_id}"
  "GET /jobs/{job_id}/parts"
  "GET /jobs/{job_id}/history"
  "POST /jobs/{job_id}/history"

  # Editing a tyre, and the replacement history on a bus's tyre page.
  "PATCH /tyres/{tyre_id}"
  "GET /buses/{bus_id}/tyre-swaps"

  # Fleet tread analytics behind the Tyre Summary and Data screen. Without this
  # the screen shows a bare "Not Found" — API Gateway's own 404, returned before
  # the Lambda runs.
  "GET /tyres/summary"

  # Canonical presign path now that the handler also serves tyre-inspection
  # sidewall photos, not just swap photos. The older /tyres/swap/photo/presign
  # route still works and is still handled, so app builds in the field are fine.
  "GET /tyres/photo/presign"

  # Approve / accept sign-off selfies (migration 020).
  "GET /verification/selfie/presign"

  # Migration 021: issue-type correction, job orders, Performance & KPIs, and
  # the PDF reports (Job Completion Report + fleet exports).
  "PATCH /reports/{report_id}"
  "POST /job-orders"
  "GET /kpis/overview"
  "GET /kpis/buses"
  "GET /kpis/buses/{bus_id}"
  "GET /jobs/{job_id}/report-pdf"
  "POST /exports"
  "GET /exports/{export_id}"
)

EXISTING="$(aws apigatewayv2 get-routes --api-id "$API_ID" --region "$REGION" \
  --query 'Items[].RouteKey' --output text)"

for key in "${ROUTES[@]}"; do
  # Whole-line match: "PATCH /reports/{report_id}" must not count as present
  # just because "PATCH /reports/{report_id}/status" is.
  if tr '\t' '\n' <<<"$EXISTING" | grep -qxF -- "$key"; then
    echo "  exists   $key"
    continue
  fi
  aws apigatewayv2 create-route \
    --api-id "$API_ID" --region "$REGION" \
    --route-key "$key" \
    --target "integrations/$INTEGRATION_ID" \
    --authorization-type JWT \
    --authorizer-id "$AUTHORIZER_ID" \
    >/dev/null
  echo "  ADDED    $key"
done

echo
echo "Done. Re-run the curl check above — the selfie routes should now return 401, not 404."
