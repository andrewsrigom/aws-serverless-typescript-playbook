# Idempotent processing

## Problem and demonstration

Coordinate concurrent deliveries using conditional DynamoDB writes and fenced leases.

## Prerequisites and restrictions

IN_PROGRESS and COMPLETED records have a 24-hour logical expiration. Leases last 60 seconds, above the 15-second Lambda deadline. Only the matching token with an unexpired lease can complete.

Node.js 24, pnpm 10.32.0, Terraform 1.16.3, and zip. Unit tests need no AWS credentials, network, or Docker after dependency installation. Deployment and smoke tests require an explicitly authorized sandbox account and AWS CLI v2.

## Read the code

Main entry point and reading order: `src/handler.ts → src/idempotency.ts → src/store.ts`. Then read `tests/`, `events/`, and `terraform/main.tf`. Shared helpers only handle logs, required environment variables, and partial SQS batch results.

## Inputs and expected outputs

events/message.json normalizes text to uppercase. Repeated identical ID/payload returns the cached result. A different payload for an unexpired ID conflicts; another live lease is busy; SQS retries both.

## Run and test

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/04-idempotent-processing/tests
pnpm build 04-idempotent-processing
terraform -chdir=scenarios/04-idempotent-processing/terraform init -backend=false
terraform -chdir=scenarios/04-idempotent-processing/terraform validate
```

Inspect `terraform/main.tf` and [deployment guidance](../../docs/deployment.md) before spending money. Only after authorizing deployment:

```bash
terraform -chdir=scenarios/04-idempotent-processing/terraform plan -out=review.tfplan
terraform -chdir=scenarios/04-idempotent-processing/terraform apply review.tfplan
terraform -chdir=scenarios/04-idempotent-processing/terraform output -json > /tmp/04-idempotent-processing-outputs.json
python3 scripts/smoke.py 04 --outputs /tmp/04-idempotent-processing-outputs.json --region us-east-1 --allow-remote
terraform -chdir=scenarios/04-idempotent-processing/terraform destroy
```

## Configuration

TABLE_NAME is injected. Strongly consistent reads inspect a failed claim. Conditional acquisition checks expiresAt directly, so stale TTL records are safe. Resource names include project (`aws-playbook`), scenario, and `environment`; environments accept 1–12 lowercase letters, digits, and hyphens. Region defaults to us-east-1. Every scenario owns a separate Terraform state.

## Failure behavior and edge cases

The unit suite contains executable malformed-input and scenario-specific failure cases. Never log request bodies or secrets; structured logs retain transport correlation IDs. See the tests for exact assertions. Local mocks cannot establish AWS retry, IAM, filtering, or scheduling behavior.

## Production adaptations and limitations

A failed attempt releases its claim; crashes recover after lease expiry. This does not guarantee exactly-once external side effects: a provider call can succeed before persistence or lease expiry. Pass the business idempotency key to an idempotent downstream service or use a transactional outbox.

CloudWatch retention is seven days. DynamoDB uses on-demand capacity; queues and functions have no idle compute provisioned. Requests, storage, logs, secret reads, and scheduled activity can incur charges. Destroy this scenario’s state-managed resources when finished; the existing webhook secret is not owned or removed by Terraform.

## Checks and official references

See [checks and coverage](../../docs/verification.md) for the development commands and test coverage. Reference: [official service documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html).
