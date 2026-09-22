# Clinic Glucose Portal (Kaarya Wellness)

Production-pilot source repository for the Kaarya Wellness Clinic Glucose Portal.

## Production-pilot baseline

- Single doctor, single clinic, single care team.
- Up to **1,000 patient profiles** in the doctor workspace.
- Up to **1,500 glucose readings per query**.
- New glucose readings receive a default **120-day DynamoDB TTL**.
- Patient identity and access are enforced through Amazon Cognito and API Gateway JWT authorization.
- Patient profile visibility in the doctor workspace is controlled by sharing consent.

## Repository structure

```text
frontend/        Static Amplify-hosted web application
backend/         AWS Lambda application code
infrastructure/  CloudFormation infrastructure template
deployment/      Deployment and verification guide
docs/            Technical architecture/code reference
release/         Validated deployable release packages
```

## Current release baseline

| Component | Version | Notes |
|---|---:|---|
| Frontend | 3.4.1 | Greeting/time-of-day fix and current portal UI |
| Backend | 3.4.2 | 1,000 profile scan limit, 1,500 reading query limit, 120-day default TTL |
| Infrastructure | 3.4.2 | CloudFormation aligned to the backend capacity and retention settings |

## AWS services

The portal uses Amazon Cognito, API Gateway HTTP API, AWS Lambda, DynamoDB, AWS Amplify Hosting, IAM, and CloudWatch.

## Frontend deployment

The contents of `frontend/` are the source files for the static Amplify application. A validated deployable archive is also retained under `release/`.

`frontend/config.js` contains browser-visible application identifiers only (AWS Region, Cognito app client ID, and API base URL). Do not place IAM access keys, client secrets, passwords, or tokens in frontend code.

## Backend deployment

`backend/index.py` is the canonical Lambda implementation for v3.4.2. It expects these environment variables:

- `PROFILES_TABLE`
- `READINGS_TABLE`
- `RETENTION_DAYS` (production-pilot default: `120`)

The exact safe-update procedure is documented in `deployment/CAPACITY_RETENTION_V3_4_2_DEPLOYMENT.md`.

## Infrastructure

`infrastructure/kaarya-demo-backend-v3_4_2.yaml` is the current CloudFormation template. It aligns future stack deployments with the same production-pilot settings as the running backend.

## Data behavior

New readings get an `expiresAt` epoch value calculated from `RETENTION_DAYS`. DynamoDB TTL deletion is asynchronous. Updating the retention setting does not backfill or modify the expiry timestamp on historical records.

## Security notes

- Never commit AWS access keys, secret keys, passwords, private keys, or `.env` files.
- Doctor authorization depends on the Cognito `DOCTOR` group claim validated server-side.
- The browser does not provide the DynamoDB ownership key used by Lambda.
- Review CORS, Cognito configuration, IAM permissions, logging, backups, and security testing before expanding beyond the controlled production pilot.

## Release artifacts

The `release/` folder retains the validated frontend ZIP, Lambda ZIP, and the v3.4.2 safe-update kit so the repository contains both human-readable source and deployable artifacts.
