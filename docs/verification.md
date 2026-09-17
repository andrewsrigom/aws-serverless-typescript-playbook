# Checks and coverage

Run commands from the repository root after `pnpm install --frozen-lockfile`. Node.js 24, pnpm 10.32.0, zip, and Terraform 1.16.3 are the development prerequisites.

| Command                 | Purpose                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`     | Check source and documentation formatting                                                                                                     |
| `pnpm lint`             | Enforce lint rules                                                                                                                            |
| `pnpm typecheck`        | Check strict TypeScript without emitting files                                                                                                |
| `pnpm test`             | Run 74 unit tests without network, Docker, or AWS credentials                                                                                 |
| `pnpm build`            | Bundle Lambda handlers and create deployment archives                                                                                         |
| `pnpm check`            | Run formatting, lint, type checking, unit tests, and builds                                                                                   |
| `pnpm terraform:check`  | Check Terraform formatting, initialize without a backend, and validate all twelve roots and both shared modules, then run mocked safety tests |
| `pnpm test:integration` | Run fourteen DynamoDB Local and HTTP integration tests using Docker                                                                           |

Unit tests cover malformed requests, signed webhook timestamps, poison records, partial batches, duplicate delivery, expired leases, recovery, bounded retries, out-of-order revisions, and replay failure safety. Integration tests exercise conditional lease acquisition, result reuse, conflicting fingerprints, expired-lease recovery, and HTTP timeout cancellation.

The GitHub Actions workflow installs the frozen lockfile and runs the checks above without cloud credentials. Deployment is an operator action. Follow [testing](testing.md) for test categories and opt-in smoke commands, and [deployment](deployment.md) for infrastructure, cost, state, and teardown.

## Recovery and upload coverage

The outbox unit suite covers send-before-mark ordering, failed publication, ambiguous-send duplicates, stream sequence failures, and ID validation. DynamoDB Local tests verify the two-row transaction, rollback on collision, stable retry identity, and persisted publication state.

The Step Functions suite checks bounded task failure routes. DynamoDB Local exercises reservation/confirmation repetition, compensation races, late reservation tombstones, insufficient stock, and changed-input conflicts. Local persistence tests complement the explicit sandbox workflow exercise described in the scenario README; they do not emulate the Step Functions service.

The upload suite validates form constraints, notification bucket/key/version boundaries, S3 TestEvent handling, poison documents, UTF-8, and size limits. Mocked Terraform plans check opt-in polling, capacity caps, bucket public-access blocks, versioning, intentional teardown, and opt-in alarms. The scenario guide includes the S3 policy and asynchronous smoke-test workflow.
