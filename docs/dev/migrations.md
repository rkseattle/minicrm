# Migrations Reference

## Rules

- Never modify an existing migration — write a new corrective migration instead.
- Every migration needs both `up` and `down`; `down` must genuinely reverse `up`.
- Integrity rules go in DB CHECK constraints in addition to Zod.
- Use `varchar(N) + CHECK` for new constrained-string columns — never new PostgreSQL ENUM types (cannot be rolled back within a transaction).
- After adding a migration, regenerate the ERD and commit `docs/schema/` in the same PR:
  ```bash
  npm run db:erd --workspace=minicrm-server
  ```

---

## Fresh Environment Setup (Migration Baseline)

`db/migrations/000_baseline.js` captures the full schema so fresh environments skip replaying all individual migrations.

**Do NOT run `npm run migrate` on a brand-new database** — it would try to run `000_baseline` + all subsequent migrations in sequence and fail (objects already exist). Use the two-step bootstrap instead:

```bash
DATABASE_URL=postgres://... npm run migrate:fresh --workspace=minicrm-server
```

`server/src/scripts/migrate-fresh.ts`:

1. Runs only `000_baseline` (`count: 1`) — creates the full schema
2. Marks all subsequent migrations as applied via node-pg-migrate's `fake` mode
3. Future migrations run normally via `npm run migrate`

---

## Existing Deployments

`000_baseline` is safe on existing databases — every `CREATE TABLE/INDEX/EXTENSION` uses `IF NOT EXISTS`. All `CREATE TRIGGER`, `CREATE POLICY`, and `ALTER TABLE ADD CONSTRAINT` statements are wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` blocks, so the baseline is fully idempotent.

When `npm run migrate` runs on a DB that does not yet have `000_baseline` in `pgmigrations`, it executes the baseline once as a no-op for all objects that already exist.

---

## Regenerating the Baseline

Regenerate `000_baseline.js` every ~50 migrations or once per major release. Goal: keep fresh-install time under 10 seconds.

```bash
# 1. Ensure all migrations are applied
DATABASE_URL=postgres://... npm run migrate --workspace=minicrm-server

# 2. Dump the full schema (run inside the DB container)
docker exec minicrm-db pg_dump \
  --username=minicrm --dbname=minicrm \
  --schema-only --no-owner --no-acl --schema=public \
  > /tmp/minicrm_schema_dump.sql

# 3. Rewrite db/migrations/000_baseline.js from the dump
#    - Wrap every CREATE in IF NOT EXISTS
#    - Wrap triggers/policies/constraints in DO $$ ... EXCEPTION WHEN duplicate_object blocks
#    - Maintain dependency order (no forward FK references)
#    - Update the migration list in the JSDoc header comment

# 4. Verify against a clean Docker environment
docker exec minicrm-db psql -U minicrm -c "CREATE DATABASE minicrm_baseline_test"
DATABASE_URL=postgres://minicrm:password@localhost:5432/minicrm_baseline_test \
  npm run migrate:fresh --workspace=minicrm-server
# Compare table/index/constraint counts against the production DB

# 5. Drop the test DB
docker exec minicrm-db psql -U minicrm -c "DROP DATABASE minicrm_baseline_test"
```

---

## Concurrency & Locking

All three migration entry points — `runMigrations()` (`server/src/migrate.ts`, called at every
server boot), `create-e2e-db.ts` (`npm run e2e:setup`), and `migrate-fresh.ts`
(`npm run migrate:fresh`) — run the same three-step baseline/fake-mark/real-run sequence and
share a single Postgres advisory lock (`withMigrationLock()` in `server/src/migrate.ts`,
MINCRM-658).

**Why:** before this lock existed, two of these entry points could run concurrently against the
same database — e.g. `docker compose --profile e2e up -d` boots `server-e2e`, which calls
`runMigrations()` at startup, while a developer's `npm run e2e:setup` moments later runs
`create-e2e-db.ts`'s own unlocked sequence against the same `minicrm_e2e` database. With no
coordination, one process's fake-mark step could interleave with another's real-run step,
producing a `pgmigrations` row for a migration whose schema changes never actually landed.

**How it works:** each entry point opens a dedicated `pg.Client` and polls
`pg_try_advisory_lock` (a fixed, namespaced key unique to migrations) with a 500ms interval and a
60-second timeout, before running the baseline/fake-mark/real-run sequence. A second concurrent
invocation waits for the lock; if it is not released within 60 seconds (the first process is
stuck or crashed), the second invocation fails fast with a clear "timed out waiting for migration
lock" error rather than silently interleaving or hanging indefinitely. The lock is released in a
`finally` block and is also released automatically if the holding connection drops, so a crashed
process cannot leak the lock permanently.

Since every step in the sequence is idempotent (per the "Existing Deployments" section above), a
second invocation that waits and then proceeds is always safe — it re-checks `pgmigrations` and
finds everything already applied.

`countBaselineCoveredMigrations()` also validates `BASELINE_COVERED_MIGRATION_COUNT` against the
migration files actually present in `db/migrations` at call time, and throws if no file matches —
this catches drift between two processes' views of the migrations directory (e.g. a stale build)
before it can silently fake-mark a migration that was never really applied.

---

## ERD (Schema Documentation)

`docs/schema/` contains auto-generated Markdown and Mermaid ERD output from [tbls](https://github.com/k1LoW/tbls). There is no automated CI staleness check (tbls output is non-deterministic across postgres versions).

```bash
# Generate using dev DB (postgres://minicrm:password@localhost:5432/minicrm)
npm run db:erd --workspace=minicrm-server

# Override DB
DATABASE_URL=postgres://user:pass@host:5432/db npm run db:erd --workspace=minicrm-server
```

`.tbls.yml` at repo root. Audit log partitions and `pgmigrations` are excluded (visual noise). To upgrade tbls: update the pinned version in `.tbls.yml` comments and the `check-erd` CI job's `curl` command.

---

## Encryption Key Rotation

`cryptoService.ts` exposes a versioned keyring (`encryptVersioned` / `decryptVersioned`). `_key_version` columns on `ai_configuration` and `smtp_configuration` record which key encrypted each secret.

**Env vars:** `NODE_ENCRYPTION_KEY` = key version 1; `ENCRYPTION_KEY_V2`/`V3`/… = higher versions (64-char hex each); `CURRENT_ENCRYPTION_KEY_VERSION` controls which version encrypts new secrets (defaults to 1).

**To rotate:** set `ENCRYPTION_KEY_V2` + `CURRENT_ENCRYPTION_KEY_VERSION=2`, redeploy, then run `npm run key-rotate` (see `docs/admin-guide.md`) to re-encrypt existing secrets and update `_key_version` columns.

**Limitation:** `sso_idp_certificate_encrypted` in `system_settings` has no `key_version` column and uses the legacy unversioned API — it cannot be re-encrypted by `npm run key-rotate`. Re-configure SSO manually after rotation.
