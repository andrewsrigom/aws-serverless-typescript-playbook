# Asynchronous enrichment

## Problem and demonstration

Queue versioned events, call a simulated provider, and persist only newer enrichment.

## Prerequisites and restrictions

Provider is an IAM-protected, throttled API simulator with synthetic data. The worker signs requests using temporary execution-role credentials. It is not an external integration. Worker batch size 5, timeout 30 seconds, visibility 180 seconds.

Node.js 24, pnpm 10.32.0, Terraform 1.16.3, and zip. Unit tests need no AWS credentials, network, or Docker after dependency installation. Deployment and smoke tests require an explicitly authorized sandbox account and AWS CLI v2.

## Read the code

Main entry point and reading order: `src/ingestion-handler.ts → src/worker.ts → src/provider.ts → src/store.ts → src/provider-handler.ts`. Then read `tests/`, `events/`, and `terraform/main.tf`. Shared helpers only handle logs, required environment variables, and partial SQS batch results.

## Inputs and expected outputs

events/message.json queues entity revision 1. Provider GET /classify/{id} returns category standard or extended and providerVersion simulator-v1. Duplicates and older revisions are ignored; a concurrent newer write wins.

## Run and test

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/08-async-enrichment/tests
pnpm build 08-async-enrichment
terraform -chdir=scenarios/08-async-enrichment/terraform init -backend=false
terraform -chdir=scenarios/08-async-enrichment/terraform validate
```

Inspect `terraform/main.tf` and [deployment guidance](../../docs/deployment.md) before spending money. Only after authorizing deployment:

```bash
# Replace with the explicitly approved sandbox account ID.
export TF_VAR_target_account_id=123456789012
aws sts get-caller-identity
export TF_VAR_enable_workers=true
terraform -chdir=scenarios/08-async-enrichment/terraform plan -out=review.tfplan
terraform -chdir=scenarios/08-async-enrichment/terraform apply review.tfplan
terraform -chdir=scenarios/08-async-enrichment/terraform output -json > /tmp/08-async-enrichment-outputs.json
python3 scripts/smoke.py 08 --outputs /tmp/08-async-enrichment-outputs.json --region us-east-1 --allow-remote
terraform -chdir=scenarios/08-async-enrichment/terraform destroy
```

## Configuration

PROVIDER_URL is set by Terraform. Each request has a one-second deadline, at most three attempts, exponential full jitter (0–100 and 0–200 ms), and retries only network timeouts, 429, or 5xx. Resource names include project (`aws-playbook`), scenario, and `environment`; environments accept 1–12 lowercase letters, digits, and hyphens. Region defaults to us-east-1. Every scenario owns a separate Terraform state.

## Failure behavior and edge cases

The unit suite contains executable malformed-input and scenario-specific failure cases. Never log request bodies or secrets; structured logs retain transport correlation IDs. See the tests for exact assertions. Local mocks cannot establish AWS retry, IAM, filtering, or scheduling behavior.

## Production adaptations and limitations

Malformed provider data and permanent HTTP errors are not retried within an attempt. SQS eventually sends poison events to the DLQ. Equal revisions are treated as immutable; use a payload fingerprint if conflicts must be detected. Real provider credentials belong in Secrets Manager, and its URL must be controlled configuration.

CloudWatch retention is seven days. DynamoDB uses on-demand capacity; queues and functions have no idle compute provisioned. Requests, storage, logs, secret reads, and scheduled activity can incur charges. Destroy this scenario’s state-managed resources when finished; the existing webhook secret is not owned or removed by Terraform.

## Checks and official references

See [checks and coverage](../../docs/verification.md) for the development commands and test coverage. Reference: [official service documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html).

See [security and cost controls](../../docs/security-and-cost.md) for default limits, activation, budget alerts, and emergency shutdown.

`src/iam-fetch.ts` signs provider GET requests with the worker's temporary role credentials. IAM grants only `execute-api:Invoke` for this API's GET `/classify/*` route. The adapter pins the HTTPS origin and path, rejects unexpected URLs, and refuses redirects to prevent forwarding signed credentials to another destination.
