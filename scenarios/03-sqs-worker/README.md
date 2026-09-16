# SQS worker

## Problem and demonstration

Process valid records even when another record in the batch is poison.

## Prerequisites and restrictions

Standard queue only. Batch size 10; Lambda timeout 15 seconds; visibility timeout 90 seconds (6× Lambda timeout, zero batch window). Five failed receives lead to the DLQ.

Node.js 24, pnpm 10.32.0, Terraform 1.16.3, and zip. Unit tests need no AWS credentials, network, or Docker after dependency installation. Deployment and smoke tests require an explicitly authorized sandbox account and AWS CLI v2.

## Read the code

Main entry point and reading order: `src/handler.ts → src/worker.ts → ../../lib/batch.ts`. Then read `tests/`, `events/`, and `terraform/main.tf`. Shared helpers only handle logs, required environment variables, and partial SQS batch results.

## Inputs and expected outputs

events/message.json records a quantity under its business ID. The Lambda returns batchItemFailures containing only failed message IDs. Malformed JSON, invalid quantities, and downstream errors fail that record.

## Run and test

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/03-sqs-worker/tests
pnpm build 03-sqs-worker
terraform -chdir=scenarios/03-sqs-worker/terraform init -backend=false
terraform -chdir=scenarios/03-sqs-worker/terraform validate
```

Inspect `terraform/main.tf` and [deployment guidance](../../docs/deployment.md) before spending money. Only after authorizing deployment:

```bash
terraform -chdir=scenarios/03-sqs-worker/terraform plan -out=review.tfplan
terraform -chdir=scenarios/03-sqs-worker/terraform apply review.tfplan
terraform -chdir=scenarios/03-sqs-worker/terraform output -json > /tmp/03-sqs-worker-outputs.json
python3 scripts/smoke.py 03 --outputs /tmp/03-sqs-worker-outputs.json --region us-east-1 --allow-remote
terraform -chdir=scenarios/03-sqs-worker/terraform destroy
```

## Configuration

QUEUE_URL and DLQ URL are Terraform outputs; TABLE_NAME is injected. DLQ retention 14 days exceeds source retention of four days. Resource names include project (`aws-playbook`), scenario, and `environment`; environments accept 1–12 lowercase letters, digits, and hyphens. Region defaults to us-east-1. Every scenario owns a separate Terraform state.

## Failure behavior and edge cases

The unit suite contains executable malformed-input and scenario-specific failure cases. Never log request bodies or secrets; structured logs retain transport correlation IDs. See the tests for exact assertions. Local mocks cannot establish AWS retry, IAM, filtering, or scheduling behavior.

## Production adaptations and limitations

Replacement writes tolerate identical duplicates. Reusing one business ID with a different quantity overwrites the old value; use the idempotency scenario for payload conflict detection. Standard SQS does not preserve ordering.

CloudWatch retention is seven days. DynamoDB uses on-demand capacity; queues and functions have no idle compute provisioned. Requests, storage, logs, secret reads, and scheduled activity can incur charges. Destroy this scenario’s state-managed resources when finished; the existing webhook secret is not owned or removed by Terraform.

## Checks and official references

See [checks and coverage](../../docs/verification.md) for the development commands and test coverage. Reference: [official service documentation](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html).
