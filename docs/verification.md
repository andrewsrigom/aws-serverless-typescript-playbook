# Checks and coverage

Run commands from the repository root after `pnpm install --frozen-lockfile`. Node.js 24, pnpm 10.32.0, zip, and Terraform 1.16.3 are the development prerequisites.

| Command                 | Purpose                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `pnpm format:check`     | Check source and documentation formatting                                             |
| `pnpm lint`             | Enforce lint rules                                                                    |
| `pnpm typecheck`        | Check strict TypeScript without emitting files                                        |
| `pnpm test`             | Run 46 unit tests without network, Docker, or AWS credentials                         |
| `pnpm build`            | Bundle Lambda handlers and create deployment archives                                 |
| `pnpm check`            | Run formatting, lint, type checking, unit tests, and builds                           |
| `pnpm terraform:check`  | Check Terraform formatting, initialize without a backend, and validate all nine roots |
| `pnpm test:integration` | Run five DynamoDB Local and HTTP integration tests using Docker                       |

Unit tests cover malformed requests, signed webhook timestamps, poison records, partial batches, duplicate delivery, expired leases, recovery, bounded retries, out-of-order revisions, and replay failure safety. Integration tests exercise conditional lease acquisition, result reuse, conflicting fingerprints, expired-lease recovery, and HTTP timeout cancellation.

The GitHub Actions workflow installs the frozen lockfile and runs the checks above without cloud credentials. Deployment is an operator action. Follow [testing](testing.md) for test categories and opt-in smoke commands, and [deployment](deployment.md) for infrastructure, cost, state, and teardown.
