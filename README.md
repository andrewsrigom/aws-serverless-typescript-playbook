# AWS Serverless TypeScript Playbook

Twelve executable serverless scenarios with strict TypeScript, AWS SDK v3, focused tests, sample events, and independent Terraform entry points. Each scenario can be studied and deployed on its own.

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm test -- scenarios/01-http-api/tests
pnpm build 01-http-api
pnpm check
pnpm terraform:check
```

Prerequisites: Node.js 24 (Lambda `nodejs24.x`), pnpm 10.32.0, zip, and Terraform 1.16.3. Optional local integration requires Docker; deployed smoke tests require Python 3 and AWS CLI v2. No credentials are needed for unit tests, builds, or `terraform validate`.

## Scenario catalog and decision guide

| Scenario                                                          | Choose it when you need to…                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [HTTP API](scenarios/01-http-api)                                 | Expose a small resource with predictable validation and conflict responses.                |
| [Webhook ingestion](scenarios/02-webhook-ingestion)               | Accept a signed event, suppress replay, and durably queue it before acknowledgement.       |
| [SQS worker](scenarios/03-sqs-worker)                             | Process valid records even when another record in the batch is poison.                     |
| [Idempotent processing](scenarios/04-idempotent-processing)       | Coordinate concurrent deliveries using conditional DynamoDB writes and fenced leases.      |
| [SNS fan-out](scenarios/05-sns-fanout)                            | Deliver one event to independent audit and index consumers.                                |
| [EventBridge routing](scenarios/06-eventbridge-routing)           | Route typed, versioned events to separate consumers with isolated failure queues.          |
| [Scheduled reconciliation](scenarios/07-scheduled-reconciliation) | Recover incomplete work in bounded pages and resume after failure.                         |
| [Asynchronous enrichment](scenarios/08-async-enrichment)          | Queue versioned events, call a simulated provider, and persist only newer enrichment.      |
| [DLQ inspection and replay](scenarios/09-dlq-replay)              | Inspect bounded messages and replay explicitly without deleting before publishing.         |
| [Transactional outbox](scenarios/10-transactional-outbox)         | Commit data and an event atomically, then publish with recoverable at-least-once delivery. |
| [Compensating workflow](scenarios/11-compensating-workflow)       | Coordinate reservation, confirmation, and idempotent compensation with Step Functions.     |
| [Secure S3 upload](scenarios/12-secure-upload)                    | Issue bounded uploads and validate immutable object versions asynchronously.               |

## Development checks

Run `pnpm check` for formatting, lint, strict TypeScript, unit tests, and Lambda bundles. `pnpm terraform:check` checks all twelve infrastructure roots; `pnpm test:integration` exercises DynamoDB Local and HTTP timeouts. See [checks and coverage](docs/verification.md) for the command reference.

## Further reading

- [Security and cost controls](docs/security-and-cost.md)
- [Deployment, costs, state, and teardown](docs/deployment.md)
- [Testing categories and smoke tests](docs/testing.md)
- [Engineering rules](AGENTS.md)

## License

[MIT](LICENSE) — Copyright 2026 Andrews Rigom.
