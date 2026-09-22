# Kaarya v3.4.2 capacity and retention update

This backend-only release changes three operational defaults for the single-doctor, single-clinic portal:

- the doctor patient-list scan evaluates up to 1,000 profiles;
- a glucose query requests up to 1,500 readings;
- newly created glucose readings receive a DynamoDB TTL 120 days after creation.

No table is replaced and no stored item is deleted by this deployment. Existing readings retain the `expiresAt` value they already contain; the new 120-day TTL applies to readings created after the Lambda environment is updated.

## Package contents

- `Kaarya_Glucose_Capacity_Retention_v3_4_2_Lambda.zip` — deployable Lambda code;
- `kaarya-demo-backend-v3_4_2.yaml` — updated infrastructure source of truth;
- this deployment guide.

## Important service boundaries

`Limit=1000` and `Limit=1500` are application ceilings, not guaranteed DynamoDB page sizes. DynamoDB can stop a Scan or Query after 1 MB and return a `LastEvaluatedKey`. The current API does not follow that key, so pagination remains the correct future improvement if item payloads become large or the clinic approaches these ceilings.

The doctor list also calculates patient summaries individually. Load-test the endpoint before onboarding close to 1,000 active profiles.

## 1. Verify and back up the live Lambda

Open AWS CloudShell in **Asia Pacific (Mumbai), ap-south-1** and run:

```bash
export KAARYA_REGION="ap-south-1"
export KAARYA_FUNCTION="kaarya-glucose-api-kaarya-glucose-demo"

aws lambda get-function-configuration \
  --function-name "$KAARYA_FUNCTION" \
  --region "$KAARYA_REGION" \
  --query '{Runtime:Runtime,Handler:Handler,Environment:Environment.Variables}' \
  --output json

KAARYA_CODE_URL=$(aws lambda get-function \
  --function-name "$KAARYA_FUNCTION" \
  --region "$KAARYA_REGION" \
  --query 'Code.Location' \
  --output text)

curl -L "$KAARYA_CODE_URL" -o kaarya-lambda-backup-before-v3_4_2.zip
```

Continue only if the handler is `index.handler` and the environment points to the existing Kaarya profile and reading tables.

## 2. Upload and deploy the Lambda package

Upload `Kaarya_Glucose_Capacity_Retention_v3_4_2_Lambda.zip` through **CloudShell → Actions → Upload file**, then run:

```bash
aws lambda update-function-code \
  --function-name "$KAARYA_FUNCTION" \
  --region "$KAARYA_REGION" \
  --zip-file fileb://Kaarya_Glucose_Capacity_Retention_v3_4_2_Lambda.zip

aws lambda wait function-updated \
  --function-name "$KAARYA_FUNCTION" \
  --region "$KAARYA_REGION"
```

## 3. Change the live retention environment to 120 days

The Lambda environment currently overrides the source-code fallback, so this configuration update is required:

```bash
KAARYA_PROFILES_TABLE=$(aws lambda get-function-configuration \
  --function-name "$KAARYA_FUNCTION" \
  --region "$KAARYA_REGION" \
  --query 'Environment.Variables.PROFILES_TABLE' \
  --output text)

KAARYA_READINGS_TABLE=$(aws lambda get-function-configuration \
  --function-name "$KAARYA_FUNCTION" \
  --region "$KAARYA_REGION" \
  --query 'Environment.Variables.READINGS_TABLE' \
  --output text)

aws lambda update-function-configuration \
  --function-name "$KAARYA_FUNCTION" \
  --region "$KAARYA_REGION" \
  --environment "Variables={PROFILES_TABLE=$KAARYA_PROFILES_TABLE,READINGS_TABLE=$KAARYA_READINGS_TABLE,RETENTION_DAYS=120}"

aws lambda wait function-updated \
  --function-name "$KAARYA_FUNCTION" \
  --region "$KAARYA_REGION"

aws lambda get-function-configuration \
  --function-name "$KAARYA_FUNCTION" \
  --region "$KAARYA_REGION" \
  --query '{Status:LastUpdateStatus,RetentionDays:Environment.Variables.RETENTION_DAYS,Modified:LastModified}' \
  --output table
```

Continue only when the status is `Successful` and retention is `120`.

## 4. Acceptance checks

1. Sign in as a patient and create a new glucose reading.
2. Confirm the reading appears in overview, history, insights and the heat map.
3. Sign in as Dr. Prashant Bhatia and confirm the patient list and patient detail load normally.
4. In DynamoDB, inspect the new reading and confirm `expiresAt` is approximately 120 days after creation.
5. Review the Lambda logs for errors or timeouts after loading the doctor dashboard.

## Rollback

Restore `kaarya-lambda-backup-before-v3_4_2.zip` using `aws lambda update-function-code`. If required, repeat the environment update using the previous retention value. A rollback does not rewrite `expiresAt` on readings already created by either version.

