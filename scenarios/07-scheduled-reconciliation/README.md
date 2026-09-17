# Scheduled reconciliation

## Problem and demonstration

Recover incomplete work in bounded pages and resume after failure.

## Prerequisites and restrictions

Scheduler runs every five minutes. Reserved concurrency is 1 to prevent overlapping scans. Scheduler has bounded retries and a DLQ; application errors are recovered by a later scheduled run.

Node.js 24, pnpm 10.32.0, Terraform 1.16.3, and zip. Unit tests need no AWS credentials, network, or Docker after dependency installation. Deployment and smoke tests require an explicitly authorized sandbox account and AWS CLI v2.

## Read the code

Main entry point and reading order: `src/handler.ts → src/reconcile.ts → src/store.ts`. Then read `tests/`, `events/`, and `terraform/main.tf`. Shared helpers only handle logs, required environment variables, and partial SQS batch results.

## Inputs and expected outputs

Seed events/message.json into the DynamoDB table as native document fields. PENDING becomes RECONCILED. Each page scans at most 25 evaluated items; invocation stops after five pages. A checkpoint advances only after the whole page succeeds.

## Run and test

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/07-scheduled-reconciliation/tests
pnpm build 07-scheduled-reconciliation
terraform -chdir=scenarios/07-scheduled-reconciliation/terraform init -backend=false
terraform -chdir=scenarios/07-scheduled-reconciliation/terraform validate
```

Inspect `terraform/main.tf` and [deployment guidance](../../docs/deployment.md) before spending money. Only after authorizing deployment:

```bash
# Replace with the explicitly approved sandbox account ID.
export TF_VAR_target_account_id=123456789012
aws sts get-caller-identity
terraform -chdir=scenarios/07-scheduled-reconciliation/terraform plan -out=review.tfplan
terraform -chdir=scenarios/07-scheduled-reconciliation/terraform apply review.tfplan
terraform -chdir=scenarios/07-scheduled-reconciliation/terraform output -json > /tmp/07-scheduled-reconciliation-outputs.json
python3 scripts/smoke.py 07 --outputs /tmp/07-scheduled-reconciliation-outputs.json --region us-east-1 --allow-remote
terraform -chdir=scenarios/07-scheduled-reconciliation/terraform destroy
```

## Configuration

TABLE_NAME and CHECKPOINT_TABLE are injected. An empty filtered page may still have a continuation key. At scan completion the checkpoint resets so newly added work is eventually revisited. Resource names include project (`aws-playbook`), scenario, and `environment`; environments accept 1–12 lowercase letters, digits, and hyphens. Region defaults to us-east-1. Every scenario owns a separate Terraform state.

## Failure behavior and edge cases

The unit suite contains executable malformed-input and scenario-specific failure cases. Never log request bodies or secrets; structured logs retain transport correlation IDs. See the tests for exact assertions. Local mocks cannot establish AWS retry, IAM, filtering, or scheduling behavior.

## Production adaptations and limitations

Scans are not snapshots. Repeating conditional updates is safe, but external side effects need stronger idempotency. For large tables use a status/time index, partitioned work claims, and an explicit time budget instead of full scans.

CloudWatch retention is seven days. DynamoDB uses on-demand capacity; queues and functions have no idle compute provisioned. Requests, storage, logs, secret reads, and scheduled activity can incur charges. Destroy this scenario’s state-managed resources when finished; the existing webhook secret is not owned or removed by Terraform.

## Checks and official references

See [checks and coverage](../../docs/verification.md) for the development commands and test coverage. Reference: [official service documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html).

See [security and cost controls](../../docs/security-and-cost.md) for default limits, activation, budget alerts, and emergency shutdown.
