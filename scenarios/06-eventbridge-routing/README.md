# EventBridge routing

## Problem and demonstration

Route typed, versioned events to separate consumers with isolated failure queues.

## Prerequisites and restrictions

The Lambda publisher can publish only to this bus. Each SQS queue policy accepts only its rule ARN. EventBridge retries target delivery up to 10 times for one hour; processing retries are handled by SQS.

Node.js 24, pnpm 10.32.0, Terraform 1.16.3, and zip. Unit tests need no AWS credentials, network, or Docker after dependency installation. Deployment and smoke tests require an explicitly authorized sandbox account and AWS CLI v2.

## Read the code

Main entry point and reading order: `src/publisher-handler.ts → src/events.ts → src/consumer-handler.ts`. Then read `tests/`, `events/`, and `terraform/main.tf`. Shared helpers only handle logs, required environment variables, and partial SQS batch results.

## Inputs and expected outputs

events/message.json contains source, detail-type, and detail. resource.created.v1 and resource.deleted.v1 use separate queues/tables. schemaVersion must be 1. PutEvents entry-level rejection is treated as a publish failure.

## Run and test

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/06-eventbridge-routing/tests
pnpm build 06-eventbridge-routing
terraform -chdir=scenarios/06-eventbridge-routing/terraform init -backend=false
terraform -chdir=scenarios/06-eventbridge-routing/terraform validate
```

Inspect `terraform/main.tf` and [deployment guidance](../../docs/deployment.md) before spending money. Only after authorizing deployment:

```bash
terraform -chdir=scenarios/06-eventbridge-routing/terraform plan -out=review.tfplan
terraform -chdir=scenarios/06-eventbridge-routing/terraform apply review.tfplan
terraform -chdir=scenarios/06-eventbridge-routing/terraform output -json > /tmp/06-eventbridge-routing-outputs.json
python3 scripts/smoke.py 06 --outputs /tmp/06-eventbridge-routing-outputs.json --region us-east-1 --allow-remote
terraform -chdir=scenarios/06-eventbridge-routing/terraform destroy
```

## Configuration

BUS_NAME is injected. Consumers also enforce EXPECTED_TYPE. Queue/DLQ/table outputs identify each route. Resource names include project (`aws-playbook`), scenario, and `environment`; environments accept 1–12 lowercase letters, digits, and hyphens. Region defaults to us-east-1. Every scenario owns a separate Terraform state.

## Failure behavior and edge cases

The unit suite contains executable malformed-input and scenario-specific failure cases. Never log request bodies or secrets; structured logs retain transport correlation IDs. See the tests for exact assertions. Local mocks cannot establish AWS retry, IAM, filtering, or scheduling behavior.

## Production adaptations and limitations

EventBridge does not guarantee ordering. These are immutable event records. A business delete consumer would need revision-aware tombstones to prevent an older creation resurrecting a resource.

CloudWatch retention is seven days. DynamoDB uses on-demand capacity; queues and functions have no idle compute provisioned. Requests, storage, logs, secret reads, and scheduled activity can incur charges. Destroy this scenario’s state-managed resources when finished; the existing webhook secret is not owned or removed by Terraform.

## Checks and official references

See [checks and coverage](../../docs/verification.md) for the development commands and test coverage. Reference: [official service documentation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html).
