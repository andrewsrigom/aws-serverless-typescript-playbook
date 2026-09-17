# DLQ inspection and replay

## Problem and demonstration

Inspect bounded messages and replay explicitly without deleting before publishing.

## Prerequisites and restrictions

Standard queues only, explicit distinct URLs. Binary message attributes and messages with no free traceability slot are rejected without deletion. Dry-run receives with zero visibility timeout; SQS has no true peek and receive counters still change.

Node.js 24, pnpm 10.32.0, Terraform 1.16.3, and zip. Unit tests need no AWS credentials, network, or Docker after dependency installation. Deployment and smoke tests require an explicitly authorized sandbox account and AWS CLI v2.

## Read the code

Main entry point and reading order: `src/cli.ts → src/replay.ts → src/queue.ts`. Then read `tests/`, `events/`, and `terraform/main.tf`. Shared helpers only handle logs, required environment variables, and partial SQS batch results.

## Inputs and expected outputs

pnpm replay requires --source URL --destination URL --limit 1..100. Dry-run is default; --apply publishes unchanged bodies and original attributes plus replaySourceMessageId before deletion.

## Run and test

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/09-dlq-replay/tests
pnpm build 09-dlq-replay
terraform -chdir=scenarios/09-dlq-replay/terraform init -backend=false
terraform -chdir=scenarios/09-dlq-replay/terraform validate
```

Inspect `terraform/main.tf` and [deployment guidance](../../docs/deployment.md) before spending money. Only after authorizing deployment:

```bash
# Replace with the explicitly approved sandbox account ID.
export TF_VAR_target_account_id=123456789012
aws sts get-caller-identity
terraform -chdir=scenarios/09-dlq-replay/terraform plan -out=review.tfplan
terraform -chdir=scenarios/09-dlq-replay/terraform apply review.tfplan
terraform -chdir=scenarios/09-dlq-replay/terraform output -json > /tmp/09-dlq-replay-outputs.json
python3 scripts/smoke.py 09 --outputs /tmp/09-dlq-replay-outputs.json --region us-east-1 --allow-remote
terraform -chdir=scenarios/09-dlq-replay/terraform destroy
```

## Configuration

Terraform creates only an isolated queue/DLQ pair and a least-privilege operator policy. Attach the policy explicitly to a dedicated operator role. The script never assumes a queue automatically. Resource names include project (`aws-playbook`), scenario, and `environment`; environments accept 1–12 lowercase letters, digits, and hyphens. Region defaults to us-east-1. Every scenario owns a separate Terraform state.

## Failure behavior and edge cases

The unit suite contains executable malformed-input and scenario-specific failure cases. Never log request bodies or secrets; structured logs retain transport correlation IDs. See the tests for exact assertions. Local mocks cannot establish AWS retry, IAM, filtering, or scheduling behavior.

## Production adaptations and limitations

Intermediate-queue replay is not atomic. Publish may succeed while delete fails, so duplicates are possible. Limit bounds the number inspected per run; repeated receives may cause an early stop. Preserve business IDs and verify downstream idempotency before applying.

CloudWatch retention is seven days. DynamoDB uses on-demand capacity; queues and functions have no idle compute provisioned. Requests, storage, logs, secret reads, and scheduled activity can incur charges. Destroy this scenario’s state-managed resources when finished; the existing webhook secret is not owned or removed by Terraform.

## Checks and official references

See [checks and coverage](../../docs/verification.md) for the development commands and test coverage. Reference: [official service documentation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html).

See [security and cost controls](../../docs/security-and-cost.md) for default limits, activation, budget alerts, and emergency shutdown.
