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
