# Deployment, state, and cost

The repository never deploys from CI. Review a single scenario’s Terraform, authenticate to a sandbox account, choose region/environment, inspect `terraform plan`, and explicitly apply only when authorized.

Build before planning: Terraform hashes `dist/<scenario>/<handler>.zip`. Artifacts bundle their exact SDK versions rather than relying on the runtime’s bundled SDK. Node.js 24 support was checked against [Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) on 2026-09-16. Terraform and provider versions are pinned in `.terraform-version` and each provider lockfile.

## Account and activation controls

Before planning, select a dedicated sandbox profile and set `TF_VAR_target_account_id` to its explicitly approved 12-digit account ID. Check `aws sts get-caller-identity` against that ID. The provider's `allowed_account_ids` rejects credentials for other accounts. Do not derive the expected account automatically from whichever credentials happen to be active.

Every scenario tags supported resources with Project, Scenario, Environment, and ManagedBy. Lambda reserved concurrency defaults to two (one for reconciliation), SQS event-source maximum concurrency is two, DynamoDB tables target at most ten read and ten write units per second, and logs expire after seven days.

SQS workers and the reconciliation schedule start disabled. Enable workers with `TF_VAR_enable_workers=true` only in scenarios 03–06 and 08 for a bounded test session. Enable the scenario 07 schedule separately with `TF_VAR_enable_schedule=true`; its smoke test can invoke the function manually while the schedule remains disabled. Enabling SQS maximum concurrency can increase idle polling relative to Lambda's automatic low-traffic optimization; disable mappings or destroy the scenario after testing.

Scenario 02's webhook is IAM-protected by default. External senders require explicitly setting `TF_VAR_allow_public_webhook=true`, which removes IAM transport authentication but retains raw-body HMAC validation. Keep that exposure brief and turn it off after testing. The simulator in scenario 08 remains IAM-protected.

Set up a small account-level cost budget with email notifications before deployment. A budget is an alert threshold, not a guaranteed spending cap. Avoid relying only on newly activated cost-allocation tags: billing data and alerts have latency. See [security and cost controls](security-and-cost.md).

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

Runtime roles permit only each scenario’s tables, queues, bus/topic, secret, and log group. The deployment identity still needs permissions to create these resources and pass their roles. HTTP API uses IAM auth; webhook uses its documented HMAC protocol; the enrichment simulator requires IAM-signed requests from the worker. Add account-specific alarms and access controls before adapting examples to real data.

## Teardown

Run `terraform destroy` from the exact scenario directory and state used for apply. Review and confirm the destroy plan. This removes tables and their sample data, queues/DLQs and their messages, functions, APIs, schedules, roles, and bounded-retention log groups owned by that state. The pre-existing webhook secret and optional remote-state bucket are external and remain. Do not delete state until teardown succeeds.
