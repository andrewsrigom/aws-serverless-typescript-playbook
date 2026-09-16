# Verification categories

| Category              | Command                 | Dependencies                                       | Evidence                                                                                      |
| --------------------- | ----------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Unit                  | `pnpm test`             | Installed packages only                            | Business logic, validation, injected failures, concurrency contracts                          |
| Local integration     | `pnpm test:integration` | Docker, curl                                       | Real conditional requests against DynamoDB Local; actual localhost HTTP deadline cancellation |
| Static infrastructure | `pnpm terraform:check`  | Terraform and provider download/cache              | Formatting and provider schema validation; no AWS API calls                                   |
| Deployed smoke        | Scenario README command | Explicit deployment, AWS CLI credentials, Python 3 | Real transport and persistence in the selected environment                                    |

`test:integration` starts one disposable in-memory DynamoDB Local container on an ephemeral loopback port, uses dummy credentials, and stops only that container. Its image digest is pinned. The tests reject a non-loopback endpoint before creating a uniquely named test table. [DynamoDB Local documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html) describes differences from the hosted service.

Unit tests have no network calls. They cover invalid input, poison records, partial batches, timestamp windows, duplicate delivery, live/stale leases, expired records, bounded retries, out-of-order revisions, and checkpoint recovery. Local integration complements those tests; it does not prove managed-service behavior.

Smoke scripts refuse to run without `--allow-remote`, use explicit Terraform outputs and region, and write uniquely identified sample data. They do not deploy resources. Review each script and use only disposable scenario tables/queues. Scenario 09 smoke intentionally exercises dry-run; applying replay is a separate operator action. Smoke tests do not exhaustively verify DLQ timing, filter propagation, or IAM denial cases. Observe these separately in a dev account before production adaptation.
