# Developer Documentation

Reference material for people working on MiniCRM itself. For using the application, see
the [User Guide](../user-guide/index.md) and [Admin Guide](../admin-guide.md); for
running and operating a deployment, see the [Operations Guide](../operations.md).

---

## Pages in this guide

| Page                                          | What it covers                                                                                 | Who needs it                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [AI Chat Lifecycle](ai-chat.md)               | How the AI page sends a message and renders the assistant's reply                              | Anyone changing the chat flow or its caching                           |
| [Coverage/TIA Instrumentation](coverage.md)   | Runtime coverage collection, session management, the mapping engine, and test-impact selection | Anyone touching coverage, TIA selection, or a failing attestation gate |
| [Coverage/TIA SDK](coverage-tia-sdk.md)       | The versioned agent and harness-adapter contract                                               | Anyone adding a new language or test runner to coverage                |
| [Dates and Timezones](dates-and-timezones.md) | UTC session rules and which columns are timezone-naive                                         | Anyone writing a date comparison, filter, or aggregation               |
| [E2E Authoring](e2e-authoring.md)             | Locators, behaviors, page objects, and fixtures for functional E2E tests                       | Anyone writing or fixing a test under `qa/e2e/`                        |
| [E2E Performance](e2e-performance.md)         | How suite parallelism is sized, and the measurements behind the capacity probe                 | Anyone changing shard counts, workers, or suite runtime                |
| [gRPC / ConnectRPC](grpc.md)                  | The ConnectRPC layer mounted alongside REST, and where its protos live                         | Anyone adding or changing a gRPC service                               |
| [Migrations](migrations.md)                   | Writing migrations, regenerating the ERD, and encryption key versioning                        | Anyone changing the database schema                                    |
| [Retention](retention.md)                     | Which log tables are purged, on what schedule, and by which condition                          | Anyone adding a log table or debugging vanished rows                   |
| [Schema Reference](schema.md)                 | Non-obvious fields, enums, and constraints                                                     | Anyone writing a query against an unfamiliar table                     |

---

## Related references

| Reference                                         | What it covers                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| [Architecture Decision Records](../adr/README.md) | Why significant architectural decisions were made, and what they cost |
| [Generated schema reference](../schema/README.md) | Every table and column, generated from the live database by `tbls`    |
