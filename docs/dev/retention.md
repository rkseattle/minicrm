# Log Table Retention Policies

Purged daily at 02:00 by `runRetentionPurge()` in `retentionService.ts` (scheduled via `node-cron`).

| Table                   | Retention | Timestamp column | Condition                               |
| ----------------------- | --------- | ---------------- | --------------------------------------- |
| `automation_rule_logs`  | 90 days   | `triggered_at`   | all rows                                |
| `webhook_delivery_logs` | 30 days   | `delivered_at`   | all rows                                |
| `import_jobs`           | 180 days  | `created_at`     | `status IN ('complete', 'failed')` only |

In-progress import jobs are never purged. `sequence_enrollment_logs` is retained indefinitely.

## Autovacuum Tuning

`automation_rule_logs` and `webhook_delivery_logs` use `autovacuum_vacuum_scale_factor = 0.05` (vs. PG default 0.2) to handle burst writes. Set in migration 082.
