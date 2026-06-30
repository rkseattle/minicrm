# Log Table Retention Policies

Purged daily at 02:00 by `runRetentionPurge()` in `retentionService.ts` (scheduled via `node-cron`).

| Table                   | Retention                         | Timestamp column | Condition                               |
| ----------------------- | --------------------------------- | ---------------- | --------------------------------------- |
| `automation_rule_logs`  | 90 days                           | `triggered_at`   | all rows                                |
| `webhook_delivery_logs` | 30 days                           | `delivered_at`   | all rows                                |
| `import_jobs`           | 180 days                          | `created_at`     | `status IN ('complete', 'failed')` only |
| `ai_sessions`           | configurable (default 90, min 30) | `created_at`     | all rows; `ai_messages` cascade-deleted |

In-progress import jobs are never purged. `sequence_enrollment_logs` is retained indefinitely.

`user_ai_context` is **not** subject to the `ai_sessions` retention policy — it stores persistent
personalisation data (user-defined term definitions), not conversation transcripts.

The AI session retention window is configurable by admins at **Admin → AI Settings → Session Retention**.
Changes take effect on the next nightly run at 02:00. Minimum window: 30 days. Maximum: 3650 days (10 years).
Each purge writes one audit entry recording the session count and retention window applied.

## Autovacuum Tuning

`automation_rule_logs` and `webhook_delivery_logs` use `autovacuum_vacuum_scale_factor = 0.05` (vs. PG default 0.2) to handle burst writes. Set in migration 082.
