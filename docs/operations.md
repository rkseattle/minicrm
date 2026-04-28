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
2. Restore from the backup you took before pulling the new images (see [Restore](#restore-from-backup)).
3. Re-tag or revert to the previous image version in your `docker-compose.yml` or by re-pulling
   the prior tag.
4. Start the old version: `docker compose up -d`.

> **Warning — data loss risk:** `docker compose down -v` deletes the `db_data` volume and
> permanently destroys your database. Never use the `-v` flag unless you intend to wipe all
> data and start fresh.

---

## Backup and Restore

MiniCRM data lives in a named Docker volume (`db_data`) attached to the `db` container.
Use `pg_dump` inside the running container to create portable backups.

### Create a backup

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

### Restore from backup

> **Warning:** Restoring overwrites all current data in the target database. Confirm you are
> restoring to the correct host and database before running these commands.

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

Replace `minicrm-backup-YYYYMMDD-HHMMSS.dump` with the actual filename of the backup you
want to restore.

### Automating daily backups

Add a cron job on the host to run the backup one-liner nightly:

```cron
0 2 * * * cd /path/to/minicrm && \
  DUMP="minicrm-backup-$(date +\%Y\%m\%d-\%H\%M\%S).dump" && \
  docker compose exec db pg_dump -U "${DB_USER}" -d "${DB_NAME}" --format=custom --file="/tmp/${DUMP}" && \
  mkdir -p ./backups && \
  docker compose cp "db:/tmp/${DUMP}" ./backups/ && \
  find ./backups -name "minicrm-backup-*.dump" -mtime +7 -delete
```

This keeps 7 days of backups and deletes older files automatically.

**Test your restores.** Run the restore procedure against a staging instance at least once
before you need it in an emergency. A backup that has never been tested is not a backup.
