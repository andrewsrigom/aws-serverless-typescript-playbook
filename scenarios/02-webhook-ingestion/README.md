# Webhook ingestion

## Problem and demonstration

Accept a signed event, suppress replay, and durably queue it before acknowledgement.

## Prerequisites and restrictions

This is a playbook-specific protocol, not a provider standard. ±300-second clock tolerance; maximum 64 KiB body. Event IDs must be immutable and unique. Store the raw signing secret in an existing Secrets Manager secret; custom KMS encryption additionally needs kms:Decrypt on that specific key.

Node.js 24, pnpm 10.32.0, Terraform 1.16.3, and zip. Unit tests need no AWS credentials, network, or Docker after dependency installation. Deployment and smoke tests require an explicitly authorized sandbox account and AWS CLI v2.

## Read the code

Main entry point and reading order: `src/handler.ts → src/protocol.ts → src/receipts.ts`. Then read `tests/`, `events/`, and `terraform/main.tf`. Shared helpers only handle logs, required environment variables, and partial SQS batch results.

## Inputs and expected outputs

events/message.json is the exact JSON payload. Headers are x-playbook-timestamp (Unix seconds) and x-playbook-signature (v1=lowercase hex HMAC-SHA256). Sign timestamp + period + ORIGINAL body bytes. Accepted/previously accepted: 202; in-flight: 409; invalid signature/time: 401; malformed body: 400/422; unavailable dependencies: 503.

## Run and test

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/02-webhook-ingestion/tests
pnpm build 02-webhook-ingestion
terraform -chdir=scenarios/02-webhook-ingestion/terraform init -backend=false
terraform -chdir=scenarios/02-webhook-ingestion/terraform validate
```

Inspect `terraform/main.tf` and [deployment guidance](../../docs/deployment.md) before spending money. Only after authorizing deployment:

```bash
terraform -chdir=scenarios/02-webhook-ingestion/terraform plan -out=review.tfplan
terraform -chdir=scenarios/02-webhook-ingestion/terraform apply review.tfplan
terraform -chdir=scenarios/02-webhook-ingestion/terraform output -json > /tmp/02-webhook-ingestion-outputs.json
python3 scripts/smoke.py 02 --outputs /tmp/02-webhook-ingestion-outputs.json --region us-east-1 --allow-remote --secret-arn "$TF_VAR_secret_arn"
terraform -chdir=scenarios/02-webhook-ingestion/terraform destroy
```

## Configuration

Set TF_VAR_secret_arn to the existing secret ARN. Terraform never creates or stores the secret value. PENDING claims use a 30-second lease; COMPLETED receipts expire logically after 24 hours. A crash recovers after lease expiry. TTL removal is not required for recovery. Resource names include project (`aws-playbook`), scenario, and `environment`; environments accept 1–12 lowercase letters, digits, and hyphens. Region defaults to us-east-1. Every scenario owns a separate Terraform state.

## Failure behavior and edge cases

The unit suite contains executable malformed-input and scenario-specific failure cases. Never log request bodies or secrets; structured logs retain transport correlation IDs. See the tests for exact assertions. Local mocks cannot establish AWS retry, IAM, filtering, or scheduling behavior.

## Production adaptations and limitations

Enqueue and receipt completion are not atomic: a crash after enqueue can cause a duplicate on retry. Consumers must be idempotent. A successful duplicate response refers to an earlier successful enqueue. Add rotating-key overlap and provider-specific retry policy for real integrations.

CloudWatch retention is seven days. DynamoDB uses on-demand capacity; queues and functions have no idle compute provisioned. Requests, storage, logs, secret reads, and scheduled activity can incur charges. Destroy this scenario’s state-managed resources when finished; the existing webhook secret is not owned or removed by Terraform.

## Checks and official references

See [checks and coverage](../../docs/verification.md) for the development commands and test coverage. Reference: [official service documentation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets-javascript.html).
