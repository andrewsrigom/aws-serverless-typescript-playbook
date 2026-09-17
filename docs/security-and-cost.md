# Security and cost controls

The default configuration is intended for short sandbox exercises with synthetic data. Deploy one scenario at a time, select an explicit account and region, and destroy the scenario when finished.

## Default controls

| Area                     | Control                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Account isolation        | Required `target_account_id`; provider account allowlist                                                  |
| Lambda compute           | 256 MiB, two reserved executions per function; reconciliation uses one                                    |
| SQS processing           | Disabled until `enable_workers=true`; maximum concurrency two; five receives before DLQ                   |
| DynamoDB                 | On-demand tables with ten read and ten write request units per second as throughput targets               |
| Scheduled work           | Disabled until `enable_schedule=true`; bounded pages and checkpoint recovery                              |
| HTTP access              | IAM on the resource API and enrichment simulator; webhook IAM by default with explicit public HMAC opt-in |
| Webhook secret           | ARN only in configuration; validation before reads; 60-second in-memory cache                             |
| Queue access             | Encryption at rest, insecure non-service transport denied, SNS/EventBridge grants limited by source ARN   |
| Logs and data            | Seven-day logs, no request-body/secret logging; bounded queue retention; state excluded from Git          |
| Infrastructure footprint | No NAT gateway, VPC, Kubernetes, provisioned Lambda concurrency, or always-running compute                |

Reserved concurrency has no idle compute charge, but sustained invocations still cost money. DynamoDB throughput limits and API Gateway throttling are best-effort targets, not financial caps. Data storage, log ingestion/storage, queue API requests, event traffic, network transfer, and Secrets Manager charges remain separate. Public webhook traffic can consume resources even when signature checks reject it.

## Before the first apply

1. Use a sandbox AWS account with temporary SSO/role credentials and MFA. Check the explicit account ID and region before planning.
2. Create an account-level AWS Budget appropriate to the test allowance and configure actual/forecast email alerts. For a small exercise, discuss a USD 5 alert budget with the account owner. Alerts are delayed and do not stop running services or guarantee a USD 5 maximum.
3. Build only the selected scenario, inspect its Terraform plan, and keep workers, schedules, and public webhook transport disabled until needed.
4. Confirm the account's Lambda concurrency quota can accommodate the reservations; AWS retains unreserved capacity and newer accounts may have lower quotas. Do not remove limits just to bypass a quota failure.
5. Use synthetic records and short test sessions. Scope deployment credentials to the scenario resources and required IAM role passing; Lambda runtime roles are separate and narrowly scoped.
6. Review any existing state before applying changes. Queue policies now live in the shared queue module; an existing deployment needs a reviewed state migration rather than blindly replacing policy ownership.

## Cost model

Estimate with the selected region and actual request counts in the [AWS Pricing Calculator](https://calculator.aws/). Do not assume Free Tier credits. For US East (N. Virginia), the referenced Lambda x86 example rate is USD 0.0000166667 per GB-second plus USD 0.20 per million requests. At 256 MiB, 1,000 calls lasting 100 ms each contribute about USD 0.00062 in Lambda charges, excluding every other service. Sustaining two concurrent 256 MiB executions for 30 days contributes about USD 21.60 in compute alone; a low concurrency limit does not mean a low monthly bill.

Secrets Manager's reference rate is USD 0.40 per secret-month plus API requests. The webhook secret is external to Terraform and survives scenario teardown. Request-based charges for API Gateway, DynamoDB, SQS, SNS, and EventBridge, plus logs and storage, must be added separately. Prices and Free Tier eligibility depend on region/account and should be checked at deployment time.

## Stop and teardown

For a normal test finish, apply `enable_workers=false` for SQS consumers, `enable_schedule=false` for reconciliation, and `allow_public_webhook=false` for the webhook. These stop processing or remove anonymous access; queues, stored data, and API endpoints can still incur charges. Review `terraform destroy` from the exact scenario directory/state and complete teardown.

For an emergency, set the affected Lambda's reserved concurrency to zero, disable its event-source mappings/schedule, and remove public API access. Stopping a Lambda alone does not remove API, polling, storage, or other service charges. Reconcile emergency console/CLI changes with Terraform afterwards. Verify remaining tagged resources and the external signing secret; do not delete Terraform state before resources are destroyed.

## References

- [Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/) and [best-effort throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html)
- [DynamoDB maximum throughput](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode-max-throughput.html)
- [SQS concurrency and polling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)
- [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/)
- [AWS Budgets best practices](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html)
- [HTTP API IAM authentication](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html)

## Opt-in observability

All roots accept `enable_alarms=false` and `alarm_action_arns=[]`. Explicitly enabling alarms provisions two per Lambda (Errors and Throttles), two per shared queue (oldest-message age above 300 seconds and visible DLQ messages), and two for the Step Functions workflow (failed and timed-out executions). These use native metrics with one-minute periods; missing data is treated as non-breaching. SQS values are approximate. An empty action list leaves alarms visible in CloudWatch without sending notifications. Select existing SNS topic ARNs deliberately; these examples create no notification subscription.

CloudWatch alarms are billable. Decide which scenario to deploy and estimate the total alarm count before enabling them. Native Lambda errors also count intentional application failures; tune thresholds to the intended workload. A successful partial-batch response does not increment Lambda Errors, so inspect queue age/DLQ or stream iterator age and failure destinations as well.

## Additional resource boundaries

The outbox retains pending and published event rows for explicit recovery/deduplication; establish an archival policy to bound storage over time. Its stream failures have a dedicated SQS destination and the original business payload stays in DynamoDB. Standard Step Functions runs only after an authenticated start request; there is no automatic loop or schedule. Review failed/timed-out executions for unfinished compensation.

Upload forms expire after 60 seconds, allow at most 1 MiB, and target one random key. Forms are reusable until expiry; versioning makes each notification immutable but does not limit total uploads. IAM access to the issuer is the first authorization boundary. S3 lifecycle and DynamoDB TTL are asynchronous cleanup, not immediate deletion guarantees. Capacity/concurrency/request limits constrain throughput and individual operations; they do not impose a hard total spending ceiling.
