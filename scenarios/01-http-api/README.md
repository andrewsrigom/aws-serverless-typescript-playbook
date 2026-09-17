# HTTP API

## Problem and demonstration

Expose a small resource with predictable validation and conflict responses.

## Prerequisites and restrictions

Requests use API Gateway HTTP payload v2. Terraform enables AWS_IAM authorization; callers must sign with SigV4 and have execute-api:Invoke permission.

Node.js 24, pnpm 10.32.0, Terraform 1.16.3, and zip. Unit tests need no AWS credentials, network, or Docker after dependency installation. Deployment and smoke tests require an explicitly authorized sandbox account and AWS CLI v2.

## Read the code

Main entry point and reading order: `src/handler.ts → src/resource.ts → src/store.ts`. Then read `tests/`, `events/`, and `terraform/main.tf`. Shared helpers only handle logs, required environment variables, and partial SQS batch results.

## Inputs and expected outputs

POST /resources creates a resource (201), GET /resources/{id} reads it (200). Invalid JSON: 400; invalid resource: 422; duplicate ID: 409; missing ID: 404; downstream failures: 503.

## Run and test

From repository root:

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/01-http-api/tests
pnpm build 01-http-api
terraform -chdir=scenarios/01-http-api/terraform init -backend=false
terraform -chdir=scenarios/01-http-api/terraform validate
```

Inspect `terraform/main.tf` and [deployment guidance](../../docs/deployment.md) before spending money. Only after authorizing deployment:

```bash
# Replace with the explicitly approved sandbox account ID.
export TF_VAR_target_account_id=123456789012
aws sts get-caller-identity
terraform -chdir=scenarios/01-http-api/terraform plan -out=review.tfplan
terraform -chdir=scenarios/01-http-api/terraform apply review.tfplan
terraform -chdir=scenarios/01-http-api/terraform output -json > /tmp/01-http-api-outputs.json
python3 scripts/smoke.py 01 --outputs /tmp/01-http-api-outputs.json --region us-east-1 --allow-remote
terraform -chdir=scenarios/01-http-api/terraform destroy
```

## Configuration

TABLE_NAME is wired from Terraform. Resources have an immutable client-provided id and a title of 1–120 characters. Resource names include project (`aws-playbook`), scenario, and `environment`; environments accept 1–12 lowercase letters, digits, and hyphens. Region defaults to us-east-1. Every scenario owns a separate Terraform state.

## Failure behavior and edge cases

The unit suite contains executable malformed-input and scenario-specific failure cases. Never log request bodies or secrets; structured logs retain transport correlation IDs. See the tests for exact assertions. Local mocks cannot establish AWS retry, IAM, filtering, or scheduling behavior.

## Production adaptations and limitations

Use an authorizer for end-user identity, define resource ownership, and add conditional versioned updates when adding mutation operations. This example has no user model.

CloudWatch retention is seven days. DynamoDB uses on-demand capacity; queues and functions have no idle compute provisioned. Requests, storage, logs, secret reads, and scheduled activity can incur charges. Destroy this scenario’s state-managed resources when finished; the existing webhook secret is not owned or removed by Terraform.

## Checks and official references

See [checks and coverage](../../docs/verification.md) for the development commands and test coverage. Reference: [official service documentation](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html).

See [security and cost controls](../../docs/security-and-cost.md) for default limits, activation, budget alerts, and emergency shutdown.
