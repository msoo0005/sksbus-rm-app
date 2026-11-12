#!/usr/bin/env bash
#
# Two small, safe savings. Run once in AWS CloudShell (Singapore):
#
#   ./apply_cost_savings.sh
#
#  1. Log retention: Lambda logs are kept forever by default. Keep 30 days.
#  2. S3 clean-up of throwaway files only:
#       reports-pdf/exports/  Breakdowns / Bus PDFs, made fresh on every
#                             export and never reused: delete after 7 days.
#       pdf-queue/, push-queue/  job files the renderers already delete;
#                             anything left behind by a failure: 2 days.
#     Photos, job reports and PUSPAKOM reports are NOT touched.
#
# The S3 step refuses to run if the bucket already has lifecycle rules,
# because writing new rules replaces all existing ones.
set -euo pipefail
R="${AWS_REGION:-ap-southeast-1}"
API_FN="${API_FN:-sksbus-api}"
DAYS="${LOG_DAYS:-30}"

echo "1. Log retention ($DAYS days)"
for g in $(aws logs describe-log-groups --region "$R" --log-group-name-prefix /aws/lambda/sksbus --query 'logGroups[].logGroupName' --output text); do
  aws logs put-retention-policy --region "$R" --log-group-name "$g" --retention-in-days "$DAYS"
  echo "   $g -> $DAYS days"
done

echo "2. S3 lifecycle for throwaway files"
BUCKET=$(aws lambda get-function-configuration --function-name "$API_FN" --region "$R" --query 'Environment.Variables.S3_BUCKET' --output text)
if aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "   $BUCKET already has lifecycle rules; not replacing them. Add these by hand in the console:"
  echo "   reports-pdf/exports/ -> expire 7 days; pdf-queue/ and push-queue/ -> expire 2 days"
  exit 0
fi
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [
    {"ID": "exports-7d", "Status": "Enabled", "Filter": {"Prefix": "reports-pdf/exports/"}, "Expiration": {"Days": 7}},
    {"ID": "pdf-queue-2d", "Status": "Enabled", "Filter": {"Prefix": "pdf-queue/"}, "Expiration": {"Days": 2}},
    {"ID": "push-queue-2d", "Status": "Enabled", "Filter": {"Prefix": "push-queue/"}, "Expiration": {"Days": 2}},
    {"ID": "abort-multipart-7d", "Status": "Enabled", "Filter": {"Prefix": ""}, "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}}
  ]
}'
echo "   done on $BUCKET"
