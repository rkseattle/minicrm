# Developer Documentation

Reference material for people working on MiniCRM itself. For using the application, see
the [User Guide](../user-guide/index.md) and [Admin Guide](../admin-guide.md); for
running and operating a deployment, see the [Operations Guide](../operations.md).

---

## Pages in this guide

| Page                                          | What it covers                                                                                 | Who needs it                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [AI Chat Lifecycle](ai-chat.md)               | How the AI page sends a message and renders the assistant's reply                              | Anyone changing the chat flow or its caching                              |
| [CI Pipeline](ci.md)                          | What runs on a PR, what gates a merge, and how to reproduce a failure                          | Anyone with a red check or a skipped job                                  |
| [Contributing](contributing.md)               | What to run before a commit, a push, and a PR                                                  | Anyone about to commit                                                    |
| [Coverage/TIA Instrumentation](coverage.md)   | Runtime coverage collection, session management, the mapping engine, and test-impact selection | Anyone touching coverage, TIA selection, or a failing attestation gate    |
| [Coverage/TIA SDK](coverage-tia-sdk.md)       | The versioned agent and harness-adapter contract                                               | Anyone adding a new language or test runner to coverage                   |
| [Custom ESLint Rules](eslint-plugins.md)      | The seven repo-specific lint rules and what each enforces                                      | Anyone whose lint run failed on a `local/` rule                           |
| [Dates and Timezones](dates-and-timezones.md) | UTC session rules and which columns are timezone-naive                                         | Anyone writing a date comparison, filter, or aggregation                  |
| [E2E Authoring](e2e-authoring.md)             | Locators, behaviors, page objects, and fixtures for functional E2E tests                       | Anyone writing or fixing a test under `qa/e2e/`                           |
| [Email Sync](email-sync.md)                   | The provider seam, IMAP cursors and threading, backoff, and the backfill job                   | Anyone adding a mail provider or debugging a mailbox that stopped syncing |
| [E2E Performance](e2e-performance.md)         | How suite parallelism is sized, and the measurements behind the capacity probe                 | Anyone changing shard counts, workers, or suite runtime                   |
| [gRPC / ConnectRPC](grpc.md)                  | The ConnectRPC layer mounted alongside REST, and where its protos live                         | Anyone adding or changing a gRPC service                                  |
| [Local SSO Testing](local-sso.md)             | Running Dex as a local OIDC provider, and its test accounts                                    | Anyone working on SSO or login flows                                      |
| [Migrations](migrations.md)                   | Writing migrations, regenerating the ERD, and encryption key versioning                        | Anyone changing the database schema                                       |
| [New Endpoint Checklist](new-endpoint.md)     | Layering, authorization, audit, and error rules for a new route                                | Anyone adding a route                                                     |
| [Retention](retention.md)                     | Which log tables are purged, on what schedule, and by which condition                          | Anyone adding a log table or debugging vanished rows                      |
| [Schema Reference](schema.md)                 | Non-obvious fields, enums, and constraints                                                     | Anyone writing a query against an unfamiliar table                        |
| [Troubleshooting](troubleshooting.md)         | Symptoms, causes, and the exact fix for common local failures                                  | Anyone whose stack, tests, or push just broke                             |

---

## Related references

| Reference                                         | What it covers                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| [Architecture Decision Records](../adr/README.md) | Why significant architectural decisions were made, and what they cost |
| [Generated schema reference](../schema/README.md) | Every table and column, generated from the live database by `tbls`    |

---

## `.claude/` and `docs/`

Procedures that bind anyone working in this repo live here, in `docs/dev/`. `.claude/`
holds the agent-facing copies: the same requirements plus session-level pacing — when to
run E2E across a multi-commit branch, what to do between phases of a plan — which has no
meaning for a person working normally.

Where a rule binds both, `docs/` is canonical for the **reasoning** — why a gate exists,
what it protects, when a bypass is legitimate — and the gate points here for it.

**Executable check lists are the exception, and they run the other way.** The full
command sequence lives in `.claude/gates/definition-of-done.md`, and `docs/` links it
rather than copying it. A list of a dozen commands that must match what CI runs is the
worst possible thing to hold in two places: the copies drift silently, and the one a
contributor follows is the one that gets it wrong. One list, linked from both trees.

`check-gate-pointer-parity.sh` pins the pointers in the first direction; the second is
a single list with no second copy to drift.
