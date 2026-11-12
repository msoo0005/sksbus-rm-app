#!/usr/bin/env bash
#
# READ ONLY. Shows what the SKS R&M backend actually costs and the settings
# that drive the bill. Changes nothing. Run in AWS CloudShell (Singapore):
#
#   ./cost_check.sh
#
# Note: each Cost Explorer call costs US$0.01; this script makes one.
set -uo pipefail
R="${AWS_REGION:-ap-southeast-1}"
API_FN="${API_FN:-sksbus-api}"
say() { printf '\n== %s ==\n' "$1"; }

say "1. Actual cost by service, last 3 full months (USD)"
END=$(date -u +%Y-%m-01)
START=$(date -u -d "$END -3 month" +%Y-%m-01 2>/dev/null || date -u -v-3m -j -f %Y-%m-%d "$END" +%Y-%m-01)
aws ce get-cost-and-usage --time-period Start=$START,End=$END --granularity MONTHLY \
  --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[].{month:TimePeriod.Start,services:Groups[?Metrics.UnblendedCost.Amount>`0.005`].[Keys[0],Metrics.UnblendedCost.Amount]}' \
  --output json 2>&1 | head -80

say "2. Database (usually the biggest line)"
aws rds describe-db-instances --region "$R" --query 'DBInstances[].{id:DBInstanceIdentifier,class:DBInstanceClass,engine:Engine,multiAZ:MultiAZ,storageGB:AllocatedStorage,storage:StorageType,public:PubliclyAccessible,backupDays:BackupRetentionPeriod,perfInsights:PerformanceInsightsEnabled,monitoringSec:MonitoringInterval}' --output table

say "3. Lambda functions"
aws lambda list-functions --region "$R" --query 'Functions[?starts_with(FunctionName, `sksbus`)].{name:FunctionName,memoryMB:MemorySize,arch:Architectures[0],timeout:Timeout,vpc:VpcConfig.VpcId}' --output table

say "4. Things that cost money just by existing"
echo "NAT gateways (about US\$45/month each + data):"
aws ec2 describe-nat-gateways --region "$R" --filter Name=state,Values=available --query 'NatGateways[].NatGatewayId' --output text
echo "Interface VPC endpoints (about US\$9/month each per AZ):"
aws ec2 describe-vpc-endpoints --region "$R" --filters Name=vpc-endpoint-type,Values=Interface --query 'VpcEndpoints[].ServiceName' --output text
echo "Public IPv4 addresses in use (US\$0.005/hour = ~\$3.65/month each):"
aws ec2 describe-network-interfaces --region "$R" --query 'NetworkInterfaces[?Association.PublicIp!=null].[Description,Association.PublicIp]' --output text
echo "EC2 instances running:"
aws ec2 describe-instances --region "$R" --filters Name=instance-state-name,Values=running --query 'Reservations[].Instances[].[InstanceId,InstanceType]' --output text

say "5. Logs (stored forever unless a retention is set)"
aws logs describe-log-groups --region "$R" --log-group-name-prefix /aws/lambda/sksbus \
  --query 'logGroups[].{group:logGroupName,retentionDays:retentionInDays,storedMB:storedBytes}' --output table

say "6. S3 storage"
BUCKET=$(aws lambda get-function-configuration --function-name "$API_FN" --region "$R" --query 'Environment.Variables.S3_BUCKET' --output text 2>/dev/null)
echo "Bucket: $BUCKET"
aws cloudwatch get-metric-statistics --region "$R" --namespace AWS/S3 --metric-name BucketSizeBytes \
  --dimensions Name=BucketName,Value="$BUCKET" Name=StorageType,Value=StandardStorage \
  --start-time "$(date -u -d '-3 days' +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -v-3d +%Y-%m-%dT00:00:00Z)" \
  --end-time "$(date -u +%Y-%m-%dT00:00:00Z)" --period 86400 --statistics Average \
  --query 'Datapoints[-1].Average' --output text | awk '{ if ($1 != "None") printf "Stored: %.2f GB\n", $1/1073741824; else print "Stored: (no data yet)" }'
echo "Lifecycle rules:"
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --query 'Rules[].{id:ID,prefix:Filter.Prefix,days:Expiration.Days}' --output table 2>/dev/null || echo "  none"

echo
echo "Done. Nothing was changed."
