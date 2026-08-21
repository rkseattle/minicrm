# Operations Guide

This guide covers upgrading a self-hosted MiniCRM installation and backing up and restoring
the PostgreSQL database.

---

## Local Test Environment (developer workflow)

The E2E suite runs against an isolated Compose project defined in
`docker-compose.test.yml`, completely separate from the dev stack. Previously the two
shared one Postgres container and were separated only by database name, which let a
stray test run truncate the dev database (MINCRM-684). Repointing the server unit,
coverage and TIA suites onto the same stack is in progress.

### Starting the services

Run once per local development session from the repo root:

```bash
docker compose -f docker-compose.test.yml up -d
```

This starts the `minicrm-test` project:

| Service  | Purpose                        | Host port(s)                 |
| -------- | ------------------------------ | ---------------------------- |
| Postgres | Test databases                 | 5433                         |
| Server   | App server for E2E             | 3002                         |
| Client   | Static build (E2E uses Vite)   | 8080                         |
| MinIO    | S3-compatible attachment store | 9002 (API), 9003 (console)   |
| Mailhog  | SMTP capture for email tests   | 1025 (SMTP), 8025 (HTTP API) |

Every port that the dev stack also uses is offset, so both can run at once and a
misconfigured test process fails to connect rather than silently writing into dev data.
Mailhog keeps 1025/8025 because the dev stack no longer runs it.

### Initialising the infrastructure

After starting the services, run the setup script once per session (MINCRM-318):

```bash
npm run e2e:setup
```

This script:

1. Creates and migrates `minicrm_e2e` and `minicrm_coverage_e2e`
2. Resets accumulated test data and seeds the E2E admin user
3. Waits up to 30 seconds for MinIO to become healthy
4. Creates the `minicrm-test-bucket` bucket inside the MinIO container (idempotent)
5. Seeds MinIO storage and Mailhog SMTP coordinates into `system_settings`

The script is idempotent — safe to re-run if you restart the Docker services or wipe
the database. It reads `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` from `qa/e2e/.env`;
copy `qa/e2e/.env.example` to `qa/e2e/.env` first if you have not already.

### Serving the test client

The E2E suite drives a Vite dev server on **5175**, pointed at the test API on **3002**.
Start it in a separate terminal and leave it running:

```bash
npm run e2e:client
```

Use `e2e:client`, not `dev:client`. They serve different stacks — `e2e:client` on 5175
against the test server (3002), `dev:client` on 5173 against the dev server (3001) — and
both print their target on startup, which is how you confirm which one you are on. Both
can run at once. Playwright refuses to start when `E2E_BASE_URL` is unset outside CI
rather than defaulting to 5173, so pointing a run at the dev frontend fails loudly
instead of silently mutating dev data.

### Running the E2E suite

Export the commit SHA and rebuild the server image first, otherwise the container runs
the previous build and coverage dumps are tagged with the wrong commit. Re-run the setup
script so the admin user and storage/SMTP settings are reseeded, then clear old results
so a stale file cannot influence the outcome:

```bash
export GIT_COMMIT_SHA=$(git rev-parse HEAD)
docker compose -f docker-compose.test.yml build server
docker compose -f docker-compose.test.yml up -d server
npm run e2e:setup
rm -rf qa/e2e/test-results/
```

Re-running `e2e:setup` here is not redundant with "once per session" above: it also
resets accumulated test data. Skipping it across many runs lets test users pile up —
50k+ has been observed, which times out user-list pagination and cascades failures
into suites that have nothing to do with the change under test.

Then the non-serial run:

```bash
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
  PW_GLOBAL_TIMEOUT_MS=3600000 \
  npm run test -- --grep "@functional" --grep-invert "visual-regression|serial" --workers=1
```

and the serial one, which is desktop-only and single-worker:

```bash
cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) \
  PW_GLOBAL_TIMEOUT_MS=1500000 \
  npm run test -- --project=desktop \
  --grep "@functional.*@serial|@serial.*@functional" --workers=1
```

`PW_GLOBAL_TIMEOUT_MS` is required on both. `qa/e2e/playwright.config.ts` defaults
`globalTimeout` to 20 minutes, which is calibrated for CI's sharded matrix; an unsharded
local run exceeds it and is **truncated, not failed** — see Reading results below.

### Tags

`@functional` is required on every test. `@serial` marks tests that mutate shared global
state, which is why they run single-worker in their own pass and are excluded from the
first command. `@smoke` is a quick subset; `@visual` is screenshot comparison, run
separately. The authoritative table is in
[docs/dev/e2e-authoring.md](dev/e2e-authoring.md#tags-reference), which also covers how
to write and register a `@serial` test.

### Choosing what to run

**Push, and let the `pre-push` hook select.** It resolves your diff to the affected
specs through `select-tests.ts` — the same script CI's select-mode job runs — and widens
to the full `@functional` suite on its own when the diff is unmapped, the confidence is
low, or the coverage map is stale.

Do not hand-write a `--grep` to narrow the push gate. It is a third selection path built
from filenames rather than coverage data, and it skips the attestation that proves the
selected specs ran against the commit you are pushing. The one place a hand-written
`--grep` belongs is validating a fix against a spec you watched fail.

### Reading results

Read `qa/e2e/test-results/results.xml`. Do not judge a run by console output or exit
code.

Check the executed count, not just failures. A truncated run reports `failures="0"` and
looks green: the tells are a `<testsuites>` `time` sitting at exactly the timeout and an
executed count well below the suite total.

Every failure gets root-caused. Never label one a known flake, flaky, pre-existing, or
unrelated as grounds to stop investigating — whether it has failed before is irrelevant,
and comparing against `main` is not a way to dismiss it. **Never rerun to make a failure
go away**; a rerun that passes is not a resolution. Run once, accept the result, fix the
cause, then rerun only the specific failing spec with `--grep` to validate the fix. If
you cannot find the root cause, say so rather than moving on.

For a healed-locator failure, download that run's `healing-report.json` artifact
(`gh api .../artifacts/<id>/zip`) — it shows the original → healed strategy per event.
The local `heal-trends.json` is from a different run and will mislead you.

### Stopping the services

```bash
docker compose -f docker-compose.test.yml down
```

### Isolation from the dev stack

The dev stack (`docker-compose.yml` + `docker-compose.dev.yml`) runs no MinIO, no
Mailhog and no test databases. `qa/scripts/check-compose-isolation.sh` enforces that the
two projects share no container name, host port or named volume, and that the test stack
never names a dev database.

---

## Required Secrets

Two secrets must be set before production use. Both should be generated with a
cryptographically random source and never reused across deployments.

### `JWT_SECRET`

**Required at startup.** Signs and verifies all session tokens (JWTs stored in httpOnly
cookies). The server rejects weak values (`changeme`, `secret`, `password`, `''`) and any
string shorter than 32 characters at boot time.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set this in your `.env` file (or `docker-compose.yml` via the `.env` substitution) before
the first `docker compose up`.

### `NODE_ENCRYPTION_KEY`

**Required at startup, unconditionally.** If `NODE_ENCRYPTION_KEY` is absent or malformed
when the server starts, it throws and exits before binding to its port — whether or not you
use file storage or SMTP. This mirrors `JWT_SECRET` and catches misconfiguration at
deployment time rather than at first use.

What it protects: the S3/MinIO secret access key and the SMTP password, encrypted at rest in
`system_settings` using AES-256-GCM. Must be a 64-character hex string (32 bytes).

A server that exits at startup for this reason prints:

```
Error: NODE_ENCRYPTION_KEY is not set or is not a valid 64-character hex string (32 bytes).
This key is required for file storage and SMTP secret encryption. Generate one with:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" and set it in
your .env file. See docs/operations.md for details.
```

Generate a value the same way as `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Once set, **treat this key as permanent.** There is no supported way to rotate it that
preserves existing secrets — see [Key Rotation](#key-rotation) below.

#### Key Rotation

> **Warning — data loss.** Rotating `NODE_ENCRYPTION_KEY` makes every secret encrypted
> under it permanently unreadable. No tooling re-encrypts them, and the key itself can
> never be retired. A step-by-step procedure previously documented here targeted
> `system_settings` keys that do not exist, so it silently did nothing while implying
> rotation was safe; it has been removed rather than corrected.

Rotation is necessary only if the key is compromised or a compliance requirement mandates
periodic rotation. If neither condition applies, do not rotate.

The versioned keyring and the full inventory of encrypted values are documented in
[migrations.md](dev/migrations.md#encryption-key-rotation). In summary:

- Setting `ENCRYPTION_KEY_V2` and `CURRENT_ENCRYPTION_KEY_VERSION=2` makes **new**
  ciphertexts use version 2. Existing rows are untouched.
- **No tooling re-encrypts existing secrets.** Every key ever used must stay in the
  environment permanently.
- **`NODE_ENCRYPTION_KEY` can never be retired.** It backs key version 1 (there is no
  `ENCRYPTION_KEY_V1`) and every legacy `encrypt`/`decrypt` secret — the storage secret,
  TOTP MFA secrets, the SSO private key and IdP certificate, and webhook signing secrets.

If the key is compromised, there is no supported rotation path that preserves existing
secrets. Re-entering each credential through the UI after setting a new key is the only
route, and it invalidates every enrolled MFA device and webhook signature.

## API Versioning Policy

All MiniCRM resource endpoints are served under the `/api/v1/` URL prefix (e.g.
`GET /api/v1/contacts`). The `/api/health` endpoint is intentionally unversioned — it is an
infrastructure endpoint, not part of the resource API. (MINCRM-283)

### Chosen scheme: URL prefix

The URL-prefix approach (`/api/v1/`) was chosen over content negotiation
(`Accept: application/vnd.minicrm+json;version=1`) because it is simpler to implement,
simpler to test, and unambiguously visible in logs, proxies, and browser dev-tools.

### Backward-compatibility redirects

The server issues `308 Permanent Redirect` from the old unversioned paths to their v1
equivalents (e.g. `GET /api/contacts` → `GET /api/v1/contacts`). 308 rather than 301
because a client may rewrite a 301 to GET and drop the request body, which breaks any
POST or PATCH sent to a legacy path. This gives existing consumers a graceful migration
path. **These redirects will be removed in a future release — migrate to `/api/v1/` as
soon as possible.**

### Introducing v2

When a breaking change is required, mount the changed routes alongside the v1 routes under
`/api/v2/`. Non-breaking changes are added to the existing version. Breaking changes are
defined as:

- Removing or renaming a field in a response body
- Changing the semantics of an existing query parameter
- Removing an endpoint
- Changing a required field to a different type

Additive changes (new optional fields, new endpoints, new optional query parameters) do not
require a version bump.

---

## Client Build Process

The client container uses a multi-stage Docker build:

1. **Build stage** (`node:24-alpine`): installs npm workspace dependencies and runs
   `npm run build --workspace=minicrm-client` to produce an optimized production bundle
   in `client/dist/`.

2. **Runtime stage** (`nginx:alpine`): serves the compiled `dist/` directory as static
   files and proxies `/api` requests to the `server` container on port 3001. The Vite
   development server is not used in production.

The client is available at `http://localhost` (port 80) when running via Docker Compose.
Direct navigation to any React Router route (e.g. `http://localhost/contacts`) loads
correctly because `nginx.conf` falls back to `index.html` via `try_files`.

---

## Upgrade Procedure

> **Back up your data before every upgrade.** Follow the [Backup](#backup-and-restore)
> instructions below before pulling new images.

MiniCRM runs database migrations automatically on server startup. When the server container
starts, it binds to its port and then immediately calls `runMigrations()`. Already-applied
migrations are skipped; only pending ones run. If a migration fails the server exits
immediately with a non-zero status code — do not send traffic until `Migrations complete.`
appears in the log (see below).

### Steps

```bash
# 1. Back up your data first — see "Backup and Restore" below.

# 2. Pull the new images.
docker compose pull

# 3. Stop the running containers.
#    IMPORTANT: omit -v. Using "docker compose down -v" destroys the db_data volume
#    and permanently deletes all your data. Plain "down" preserves the volume.
#    --profile web is needed here too, or the client container is left running.
docker compose --profile web down

# 4. Start with the new images. Migrations run automatically on server startup.
#    --profile web is REQUIRED: the nginx client service is behind that profile
#    (MINCRM-684) so a local `docker compose up` does not occupy port 80. Omitting it
#    brings the stack up with no frontend. Add --profile backup if you use the
#    automated backup service.
docker compose --profile web up -d
```

### Confirming migrations ran

Monitor the server startup log until you see `Migrations complete.`:

```bash
docker compose logs -f server
```

The server binds to its port first and then runs migrations, so `listening on port 3001`
appears before the migration output. A successful startup looks like:

```
minicrm-server  | MiniCRM API server listening on port 3001
minicrm-server  | Running database migrations...
minicrm-server  | Migrations complete.
```

If no migrations were pending (already up to date), you will also see `No migrations to run!`
between the two lines above — that is expected and successful.

Do not send traffic to the server until `Migrations complete.` appears in the log.

If the server exits without printing `Migrations complete.`, a migration failed.
Check the full log for the error and follow the rollback procedure below.

### Rollback procedure

Down migrations are **not** a safe recovery strategy in production. If a migration fails:

1. Run `docker compose --profile web down` to stop all containers. The profile flag is
   required or the nginx client container is left running (MINCRM-684).
2. Restore from the backup you took before pulling the new images (see [Backup and Restore](#backup-and-restore)).
3. Re-tag or revert to the previous image version in your `docker-compose.yml` or by re-pulling
   the prior tag.
4. Start the old version: `docker compose --profile web up -d`.

> **Warning — data loss risk:** `docker compose down -v` deletes the `db_data` volume and
> permanently destroys your database. Never use the `-v` flag unless you intend to wipe all
> data and start fresh.

---

## Backup and Restore

MiniCRM data lives in a named Docker volume (`db_data`) attached to the `db` container.
You can protect it with the built-in automated backup service (recommended) or run
manual one-off dumps when needed.

---

### Automated backups (recommended)

`docker-compose.yml` ships with an optional `db-backup` service that runs `pg_dump`
on a cron schedule and automatically rotates old backups. It is **disabled by default**
and activated via a Docker Compose profile so it has no effect on standard deployments.

#### Enable the backup service

1. Add the following lines to your `.env` file (both are optional — the defaults shown
   are used if omitted):

   ```env
   BACKUP_SCHEDULE=@daily          # cron expression or @daily / @hourly shorthand
   BACKUP_RETENTION_DAYS=7         # number of daily backups to keep
   ```

2. Start (or restart) the stack with the `backup` profile:

   ```bash
   docker compose --profile backup up -d
   ```

   The `db-backup` container starts alongside the other services and runs its first
   backup according to `BACKUP_SCHEDULE`.

3. To stop the backup service without stopping the rest of the stack:

   ```bash
   docker compose --profile backup stop db-backup
   ```

#### Where backups are stored

Backups are written to the `db_backups` named Docker volume inside the container path
`/backups/`. To copy backups out of the volume to your host for off-site storage:

```bash
# List available backup files.
docker compose run --rm db-backup ls /backups/

# Copy a specific backup file to the host.
docker cp minicrm-db-backup:/backups/last/minicrm-backup.dump ./minicrm-backup.dump
```

#### Restore from an automated backup

> **Warning:** Restoring overwrites all current data in the target database. Confirm you
> are restoring to the correct host and database before running these commands.

```bash
# Copy the dump from the backup volume into the db container.
docker cp minicrm-db-backup:/backups/last/minicrm-backup.dump /tmp/restore.dump
docker compose cp /tmp/restore.dump db:/tmp/restore.dump

# Restore, dropping and recreating existing objects.
docker compose exec db pg_restore \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --clean \
  --if-exists \
  /tmp/restore.dump
```

Replace `/backups/last/minicrm-backup.dump` with the path to the specific backup file
you want to restore (use `ls /backups/` to browse available files).

---

### Manual backups

Use `pg_dump` inside the running `db` container to create a portable one-off dump.

#### Create a manual backup

```bash
# Capture the filename in a variable so the same name is used for both commands.
# DB_USER and DB_NAME must match the values in your .env file.
DUMP_FILE="minicrm-backup-$(date +%Y%m%d-%H%M%S).dump"

# Write the dump inside the container.
docker compose exec db pg_dump \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --format=custom \
  --file="/tmp/${DUMP_FILE}"

# Copy the dump file out of the container to a local ./backups/ directory.
mkdir -p ./backups
docker compose cp "db:/tmp/${DUMP_FILE}" ./backups/
echo "Backup saved to ./backups/${DUMP_FILE}"
```

#### Restore from a manual backup

> **Warning:** Restoring overwrites all current data in the target database. Confirm you
> are restoring to the correct host and database before running these commands.

```bash
# Copy the dump file into the container.
docker compose cp ./backups/minicrm-backup-YYYYMMDD-HHMMSS.dump db:/tmp/restore.dump

# Restore, dropping and recreating existing objects.
docker compose exec db pg_restore \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --clean \
  --if-exists \
  /tmp/restore.dump
```

Replace `minicrm-backup-YYYYMMDD-HHMMSS.dump` with the actual filename of the backup
you want to restore.

---

**Test your restores.** Run the restore procedure against a staging instance at least
once before you need it in an emergency. A backup that has never been tested is not a
backup.

---

### Backup scripts (host-side)

Two shell scripts in `scripts/` perform backups and restores directly against a
PostgreSQL instance accessible from the host — useful when you are not using the
Docker-based automated service or when you need a one-off backup before an upgrade.

Both scripts read the same environment variables as `docker-compose.yml`. The values
below are the **dev/production** stack (port 5432) — backups target real data, never the
test stack on 5433. Set them in your shell or prefix the command:

```bash
export DB_HOST=localhost DB_PORT=5432 DB_USER=minicrm DB_NAME=minicrm
export DB_PASSWORD=<your-password>

# Or use a single DATABASE_URL:
export DATABASE_URL=postgres://minicrm:<password>@localhost:5432/minicrm
```

#### Create a host-side backup

```bash
# Default destination: ./backups/minicrm-backup-YYYYMMDD-HHMMSS.dump.gz
./scripts/backup.sh

# Custom destination
BACKUP_DIR=/mnt/nas/minicrm-backups ./scripts/backup.sh
```

The script writes a pg_dump custom-format file and gzip-compresses it.
The compressed file can be restored with `scripts/restore.sh` (see below).

#### Restore from a host-side backup

```bash
./scripts/restore.sh ./backups/minicrm-backup-YYYYMMDD-HHMMSS.dump.gz
```

The script prompts for confirmation before overwriting any data. `.gz` files
are decompressed automatically to a temp file and cleaned up on exit. Plain
uncompressed `.dump` files are also accepted.

---

### Backup schedule recommendation

| Environment | Recommended schedule                         |
| ----------- | -------------------------------------------- |
| Production  | Daily minimum; hourly if deal volume is high |
| Staging     | Before each deployment                       |
| Development | On demand / before schema experiments        |

For production, set `BACKUP_SCHEDULE=@daily` (or a cron expression such as
`0 2 * * *` for 02:00 daily) and `BACKUP_RETENTION_DAYS=7` in your `.env`.
Keep at least two weeks of backups if your pipeline value justifies it.

Off-site copies are strongly recommended: copy the compressed dump files to a
separate storage location (S3, a remote NAS, or a different cloud region) so a
host-level failure does not destroy both your data and your backups.

---

### How to verify a backup is valid

A backup file that exists on disk is not the same as a backup you can restore.
Verify at least once per week (ideally after every backup run) that the dump is
readable:

```bash
# 1. Check the file is a valid pg_dump custom-format archive.
#    This reads the table of contents without touching the database.
pg_restore --list ./backups/minicrm-backup-YYYYMMDD-HHMMSS.dump.gz | head -20

# 2. Perform a full test restore against a throw-away database.
createdb minicrm_verify
DB_NAME=minicrm_verify ./scripts/restore.sh ./backups/minicrm-backup-YYYYMMDD-HHMMSS.dump.gz
# (confirm with "yes" when prompted)

# 3. Spot-check row counts.
psql -d minicrm_verify -c "SELECT COUNT(*) FROM contacts;"
psql -d minicrm_verify -c "SELECT COUNT(*) FROM deals;"

# 4. Drop the verification database.
dropdb minicrm_verify
```

If step 1 fails (`pg_restore: error: did not find magic string in file header`)
the dump is corrupt — run a fresh backup immediately and investigate the cause
before the corrupt file is the only copy you have.

---

## Email Deliverability

Self-hosted MiniCRM sends transactional emails (password resets, assignment
notifications, overdue task digests). Without correct DNS records, these will
reliably be rejected or delivered to spam. This section explains the three DNS
records required and how to verify them.

### Why deliverability fails

Receiving mail servers run reputation checks against the sending domain. The
three mechanisms work together:

| Record | Purpose                                                     |
| ------ | ----------------------------------------------------------- |
| SPF    | Lists IP addresses authorised to send mail for your domain  |
| DKIM   | Cryptographic signature proving the message was not altered |
| DMARC  | Policy telling receivers what to do when SPF or DKIM fails  |

If any of the three is absent or misconfigured, major providers (Gmail, Outlook,
Yahoo) may silently bin the message or reject it at the SMTP level.

### Startup warning

When `SMTP_FROM` is set in the environment but `SMTP_DKIM_PRIVATE_KEY` is not,
the server logs an advisory warning at startup:

```
WARN: SMTP_FROM is set but SMTP_DKIM_PRIVATE_KEY is not configured.
Outbound emails may be rejected or delivered to spam.
See docs/operations.md#email-deliverability for SPF/DKIM/DMARC setup instructions.
```

This is non-fatal — the server starts normally. Resolve it by following the
steps below.

---

### Step 1 — SPF record

SPF is a TXT record on your sending domain that lists the mail servers allowed
to send on its behalf. If you are using an SMTP relay (see
[Recommended SMTP relays](#recommended-smtp-relays)), the relay provider
supplies the SPF include.

**Example (SendGrid):**

```
yourdomain.com.  IN  TXT  "v=spf1 include:sendgrid.net ~all"
```

**Example (Amazon SES, us-east-1):**

```
yourdomain.com.  IN  TXT  "v=spf1 include:amazonses.com ~all"
```

**Example (self-hosted Postfix on a dedicated IP):**

```
yourdomain.com.  IN  TXT  "v=spf1 ip4:203.0.113.10 ~all"
```

Replace `203.0.113.10` with the public IP of your mail server. The `~all`
softfail is the recommended starting policy; harden to `-all` once you have
confirmed all legitimate senders are covered.

**Verify:**

```bash
nslookup -type=TXT yourdomain.com
# or
dig TXT yourdomain.com +short
```

The output should include `v=spf1 …`.

---

### Step 2 — DKIM record

DKIM signs outgoing messages with a private key. Receiving servers look up the
corresponding public key via DNS and verify the signature.

#### Using an SMTP relay (recommended)

Most SMTP relays (SendGrid, Mailgun, SES) generate the key pair for you and
give you a TXT record to publish. Follow your relay's DKIM setup guide — the
record is usually in the form:

```
<selector>._domainkey.yourdomain.com.  IN  TXT  "v=DKIM1; k=rsa; p=<public-key>"
```

The relay handles signing; you do not need to configure `SMTP_DKIM_PRIVATE_KEY`
on the MiniCRM server in this case. Clear the startup warning by setting:

```env
# Set this to any non-empty string to acknowledge that DKIM is handled by your relay.
SMTP_DKIM_PRIVATE_KEY=relay-managed
```

#### Self-managed DKIM (advanced)

If you are running Postfix and signing at the MTA level (e.g. with OpenDKIM),
no additional MiniCRM configuration is required beyond publishing the DNS record.
Set `SMTP_DKIM_PRIVATE_KEY=postfix-managed` to silence the startup warning.

**Verify (after publishing the DNS record):**

```bash
nslookup -type=TXT <selector>._domainkey.yourdomain.com
# or
dig TXT <selector>._domainkey.yourdomain.com +short
```

The output should include `v=DKIM1`.

---

### Step 3 — DMARC record

DMARC builds on SPF and DKIM to tell receiving servers what to do when either
check fails. Start with a monitoring-only policy (`p=none`) and tighten it once
you have reviewed a few days of aggregate reports.

**Recommended starting record:**

```
_dmarc.yourdomain.com.  IN  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com"
```

- `p=none` — take no action on failures; report only
- `rua=` — aggregate report recipient (can be a dedicated mailbox or a DMARC
  monitoring service such as Postmark's free DMARC monitoring, Dmarcian, or
  MxToolbox)

**Tighten after reviewing reports:**

```
"v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@yourdomain.com"
"v=DMARC1; p=reject;     rua=mailto:dmarc-reports@yourdomain.com"
```

**Verify:**

```bash
nslookup -type=TXT _dmarc.yourdomain.com
# or
dig TXT _dmarc.yourdomain.com +short
```

The output should include `v=DMARC1`.

---

### Recommended SMTP relays

Configuring a dedicated SMTP relay is the fastest path to good deliverability
on a self-hosted instance. The relay handles IP reputation, DKIM signing, bounce
handling, and feedback loops.

#### SendGrid (recommended for most deployments)

1. Create a free SendGrid account and verify your sending domain under
   **Settings → Sender Authentication → Domain Authentication**. SendGrid
   walks you through publishing SPF and DKIM records.

2. Generate an API key under **Settings → API Keys** with **Mail Send** scope.

3. Configure MiniCRM:

   ```env
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=apikey
   SMTP_PASS=<your-sendgrid-api-key>
   SMTP_FROM=MiniCRM <notifications@yourdomain.com>
   SMTP_DKIM_PRIVATE_KEY=relay-managed
   ```

4. Send a test email from the **Admin Settings → SMTP → Send Test Email** button
   to confirm delivery.

#### Amazon SES

1. Verify your sending domain in the AWS SES console (**Configuration →
   Verified identities**). SES generates DKIM records for you to publish.

2. Create SMTP credentials under **Account dashboard → Create SMTP credentials**.

3. Configure MiniCRM:

   ```env
   SMTP_HOST=email-smtp.<region>.amazonaws.com
   SMTP_PORT=587
   SMTP_USER=<ses-smtp-username>
   SMTP_PASS=<ses-smtp-password>
   SMTP_FROM=MiniCRM <notifications@yourdomain.com>
   SMTP_DKIM_PRIVATE_KEY=relay-managed
   ```

#### Mailgun

1. Add and verify your domain in the Mailgun dashboard under **Sending → Domains**.
   Mailgun provides SPF and DKIM records to publish.

2. Generate an SMTP password under your domain's SMTP credentials.

3. Configure MiniCRM:

   ```env
   SMTP_HOST=smtp.mailgun.org
   SMTP_PORT=587
   SMTP_USER=postmaster@yourdomain.com
   SMTP_PASS=<mailgun-smtp-password>
   SMTP_FROM=MiniCRM <notifications@yourdomain.com>
   SMTP_DKIM_PRIVATE_KEY=relay-managed
   ```

---

### End-to-end verification checklist

After publishing your DNS records and configuring an SMTP relay, run through
this checklist before declaring email deliverability production-ready:

- [ ] SPF record returns `v=spf1 …` for your domain
- [ ] DKIM `_domainkey` record returns `v=DKIM1 …`
- [ ] DMARC `_dmarc` record returns `v=DMARC1 …`
- [ ] Server startup log contains no DKIM warning
- [ ] Admin Settings → SMTP → Send Test Email delivers successfully
- [ ] The test email lands in the inbox (not spam) of an external Gmail or Outlook
      address
- [ ] DMARC aggregate reports show `pass` for SPF and DKIM after 24–48 hours

Use [MxToolbox Email Deliverability Check](https://mxtoolbox.com/deliverability)
or [mail-tester.com](https://www.mail-tester.com) to get a scored report before
going live.
