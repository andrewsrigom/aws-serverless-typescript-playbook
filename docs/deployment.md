# Deployment, state, and cost

The repository never deploys from CI. Review a single scenario’s Terraform, authenticate to a sandbox account, choose region/environment, inspect `terraform plan`, and explicitly apply only when authorized.

Build before planning: Terraform hashes `dist/<scenario>/<handler>.zip`. Artifacts bundle their exact SDK versions rather than relying on the runtime’s bundled SDK. Node.js 24 support was checked against [Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) on 2026-09-16. Terraform and provider versions are pinned in `.terraform-version` and each provider lockfile.

## Local state

Each scenario directory starts with a local backend. State, plans, and secrets are ignored by Git. Keep state secure and backed up: deleting it does not delete resources. Never run two applies against the same local state concurrently. Use a separate working directory/state for every environment; changing `environment` in the same state renames/replaces resources rather than creating an isolated second stack.

## Optional remote state (not provisioned)

Create and secure your own versioned, encrypted S3 state bucket separately. Restrict IAM to a scenario/environment key and its lock object. Add this block to the selected root only after reviewing it:

```hcl
terraform {
  backend "s3" {}
}
```

Then run `terraform init -migrate-state -backend-config=bucket=<existing-bucket> -backend-config=key=<scenario>/<environment>/terraform.tfstate -backend-config=region=<region> -backend-config=use_lockfile=true`. Do not put credentials in backend config. See [S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3).

## Cost and permissions

Expect charges for Lambda invocations/duration, API Gateway calls, DynamoDB requests/storage, SQS/SNS/EventBridge traffic, CloudWatch logs, Scheduler, and Secrets Manager where used. No free-tier or zero-cost claim is made. Review [AWS pricing](https://aws.amazon.com/pricing/) for your account/region. No VPC, NAT gateway, Kubernetes, or provisioned concurrency is created.

Runtime roles permit only each scenario’s tables, queues, bus/topic, secret, and log group. The deployment identity still needs permissions to create these resources and pass their roles. HTTP API uses IAM auth; webhook uses its documented HMAC protocol; the enrichment provider is an intentionally public throttled simulator. Add account-specific alarms and access controls before adapting examples to real data.

## Teardown

Run `terraform destroy` from the exact scenario directory and state used for apply. Review and confirm the destroy plan. This removes tables and their sample data, queues/DLQs and their messages, functions, APIs, schedules, roles, and bounded-retention log groups owned by that state. The pre-existing webhook secret and optional remote-state bucket are external and remain. Do not delete state until teardown succeeds.
