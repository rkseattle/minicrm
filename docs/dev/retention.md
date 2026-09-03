# Log Table Retention Policies

Purged by `runRetentionPurge()` in `retentionService.ts`, on the schedule in [Scheduled Jobs](../operations.md#scheduled-jobs).

| Table                   | Retention                         | Timestamp column | Condition                               |
| ----------------------- | --------------------------------- | ---------------- | --------------------------------------- |
| `automation_rule_logs`  | 90 days                           | `triggered_at`   | all rows                                |
| `webhook_delivery_logs` | 30 days                           | `delivered_at`   | all rows                                |
| `import_jobs`           | 180 days                          | `created_at`     | `status IN ('complete', 'failed')` only |
| `email_sync_jobs`       | 180 days                          | `created_at`     | `status IN ('complete', 'failed')` only |
| `ai_sessions`           | configurable (default 90, min 30) | `created_at`     | all rows; `ai_messages` cascade-deleted |

In-progress import jobs are never purged. `sequence_enrollment_logs` is retained indefinitely.

`email_messages` is **not** time-purged: a mailbox's conversation history is the feature, not a
log of it. Rows are deleted when their `connected_accounts` row is, via `ON DELETE CASCADE`, so
disconnecting a mailbox removes everything synced from it. Erasing a message because a _data
subject_ appears in its addresses is a separate question — the messages hold contact personal
data while belonging to the connected user — and is decided by the email privacy story, which
owns whether that is address redaction or row deletion and extends `gdpr_deletion_log` to match.

That question is wider than addresses: the table stores message **bodies**, so a data subject's
personal data can appear anywhere in free text rather than only in an indexed address column,
and address redaction alone would not erase it. Note that `docs/gdpr.md`'s `body_text` scrub
covers **notes**, a different column on a different table, and does not reach these.

`email_sync_jobs` holds no personal data — a status, a count, and an error string — and rides the
same cascade when its mailbox is disconnected. Age alone never purges an unfinished job, because
a backfill legitimately spans many scheduler ticks. Staleness does: the same nightly run first
fails any job whose `updated_at` has not advanced in 24 hours, so a backfill orphaned by a
restart cannot block its mailbox forever — only one unfinished job may exist per account.

`user_ai_context` is **not** subject to the `ai_sessions` retention policy — it stores persistent
personalisation data (user-defined term definitions), not conversation transcripts.

The AI session retention window is configurable by admins at **Admin → AI Settings → Session Retention**.
Changes take effect on the next nightly run. Minimum window: 30 days. Maximum: 3650 days (10 years).
Each purge writes one audit entry recording the session count and retention window applied.

Admins can also trigger an immediate purge outside the nightly schedule via the **Purge now**
button in the same section (MINCRM-462). This calls the exact same `purgeAiSessions()` function
used by the nightly cron — same logic, same audit trail — just on demand. The endpoint
(`POST /admin/ai/retention/purge`) responds `202 Accepted` immediately and runs the purge
asynchronously, and additionally writes its own audit entry recording who triggered it (distinct
from the purge-result audit entry `purgeAiSessions()` itself writes). The current session and
message counts are shown alongside the retention window input so admins can gauge the impact of
a purge before triggering one.

## Autovacuum Tuning

`automation_rule_logs` and `webhook_delivery_logs` use `autovacuum_vacuum_scale_factor = 0.05` (vs. PG default 0.2) to handle burst writes. Set in migration 082.
