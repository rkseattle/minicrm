# Operations Guide

This guide covers upgrading a self-hosted MiniCRM installation and backing up and restoring
the PostgreSQL database.

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

**Required when file storage or UI-configured SMTP is used.** Encrypts the S3/MinIO secret
access key and SMTP password at rest in `system_settings` using AES-256-GCM. Must be a
64-character hex string (32 bytes).

If this variable is absent or malformed, any admin action that writes or reads a storage or
SMTP secret throws:

```
Error: NODE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)...
```

Generate a value the same way as `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set `NODE_ENCRYPTION_KEY` in your `.env` before enabling file attachments or configuring
SMTP via the Admin Settings UI. Once set, **do not rotate this key** without first decrypting
and re-encrypting any existing stored secrets — rotating without migration will make stored
secrets unreadable.

---

## API Versioning Policy

All MiniCRM resource endpoints are served under the `/api/v1/` URL prefix (e.g.
`GET /api/v1/contacts`). The `/api/health` endpoint is intentionally unversioned — it is an
infrastructure endpoint, not part of the resource API. (MINCRM-283)

### Chosen scheme: URL prefix

The URL-prefix approach (`/api/v1/`) was chosen over content negotiation
(`Accept: application/vnd.minicrm+json;version=1`) because it is simpler to implement,
simpler to test, and unambiguously visible in logs, proxies, and browser dev-tools.

### Backward-compatibility redirects

The server issues `301 Permanent Redirect` from the old unversioned paths to their v1
equivalents (e.g. `GET /api/contacts` → `GET /api/v1/contacts`). This gives existing
consumers a graceful migration path. **These redirects will be removed in a future release —
migrate to `/api/v1/` as soon as possible.**

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

1. **Build stage** (`node:20-alpine`): installs npm workspace dependencies and runs
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
docker compose down

# 4. Start with the new images. Migrations run automatically on server startup.
docker compose up -d
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

1. Run `docker compose down` to stop all containers.
2. Restore from the backup you took before pulling the new images (see [Backup and Restore](#backup-and-restore)).
3. Re-tag or revert to the previous image version in your `docker-compose.yml` or by re-pulling
   the prior tag.
4. Start the old version: `docker compose up -d`.

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
