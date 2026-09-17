# SNS fan-out

## Problem and demonstration

Deliver one event to independent audit and index consumers.

## Prerequisites and restrictions

Raw message delivery is enabled. Consumer processing failures retry only that queue; subscription delivery failures can also reach its DLQ. Filtering does not replace payload validation.

Node.js 24, pnpm 10.32.0, Terraform 1.16.3, and zip. Unit tests need no AWS credentials, network, or Docker after dependency installation. Deployment and smoke tests require an explicitly authorized sandbox account and AWS CLI v2.

## Read the code

Main entry point and reading order: `src/publisher-handler.ts → src/event.ts → src/consumer-handler.ts`. Then read `tests/`, `events/`, and `terraform/main.tf`. Shared helpers only handle logs, required environment variables, and partial SQS batch results.

## Inputs and expected outputs

events/message.json publishes a created event to both consumers. Updated events go only to audit, selected by the SNS kind message attribute. Each consumer writes its own table and has its own queue/DLQ.

## Run and test

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/05-sns-fanout/tests
pnpm build 05-sns-fanout
terraform -chdir=scenarios/05-sns-fanout/terraform init -backend=false
terraform -chdir=scenarios/05-sns-fanout/terraform validate
```

Inspect `terraform/main.tf` and [deployment guidance](../../docs/deployment.md) before spending money. Only after authorizing deployment:

```bash
# Replace with the explicitly approved sandbox account ID.
export TF_VAR_target_account_id=123456789012
aws sts get-caller-identity
export TF_VAR_enable_workers=true
terraform -chdir=scenarios/05-sns-fanout/terraform plan -out=review.tfplan
terraform -chdir=scenarios/05-sns-fanout/terraform apply review.tfplan
terraform -chdir=scenarios/05-sns-fanout/terraform output -json > /tmp/05-sns-fanout-outputs.json
python3 scripts/smoke.py 05 --outputs /tmp/05-sns-fanout-outputs.json --region us-east-1 --allow-remote
terraform -chdir=scenarios/05-sns-fanout/terraform destroy
```

## Configuration

TOPIC_ARN and each table are injected. Queue policies allow only this topic ARN. Separate Lambda roles permit access only to each consumer’s queue and table. Resource names include project (`aws-playbook`), scenario, and `environment`; environments accept 1–12 lowercase letters, digits, and hyphens. Region defaults to us-east-1. Every scenario owns a separate Terraform state.

## Failure behavior and edge cases

The unit suite contains executable malformed-input and scenario-specific failure cases. Never log request bodies or secrets; structured logs retain transport correlation IDs. See the tests for exact assertions. Local mocks cannot establish AWS retry, IAM, filtering, or scheduling behavior.

## Production adaptations and limitations

These consumers maintain independent event records keyed by event ID, not ordered materialized resource views. Add per-resource revisions if adapting the index to a mutable snapshot.

CloudWatch retention is seven days. DynamoDB uses on-demand capacity; queues and functions have no idle compute provisioned. Requests, storage, logs, secret reads, and scheduled activity can incur charges. Destroy this scenario’s state-managed resources when finished; the existing webhook secret is not owned or removed by Terraform.

## Checks and official references

See [checks and coverage](../../docs/verification.md) for the development commands and test coverage. Reference: [official service documentation](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html).

See [security and cost controls](../../docs/security-and-cost.md) for default limits, activation, budget alerts, and emergency shutdown.
