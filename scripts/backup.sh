#!/usr/bin/env bash
# backup.sh — One-command PostgreSQL backup for MiniCRM (MINCRM-393).
#
# Usage:
#   ./scripts/backup.sh
#   BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#
# Environment variables (all optional — defaults mirror docker-compose.yml):
#   DATABASE_URL   Full connection string, e.g. postgres://user:pass@host:5432/dbname
#                  When set, DB_* variables below are ignored.
#   DB_HOST        Postgres host        (default: localhost)
#   DB_PORT        Postgres port        (default: 5432)
#   DB_USER        Postgres user        (default: minicrm)
#   DB_NAME        Postgres database    (default: minicrm)
#   DB_PASSWORD    Postgres password    (unset by default; set PGPASSWORD directly if preferred)
#   BACKUP_DIR     Destination directory (default: ./backups)
#
# The backup file is named minicrm-backup-YYYYMMDD-HHMMSS.dump.gz and written
# to BACKUP_DIR. pg_dump is run with --format=custom so pg_restore can do
# selective, parallel, and partial restores. The dump is then compressed with gzip.
#
# Exit codes:
#   0  — success
#   1  — pre-flight check failed (missing tool, bad env)
#   2  — pg_dump or gzip failed

set -euo pipefail

# ── Helpers ────────────────────────────────────────────────────────────────────

log()  { echo "[backup] $*"; }
err()  { echo "[backup] ERROR: $*" >&2; }
die()  { err "$*"; exit 1; }

# ── Pre-flight ─────────────────────────────────────────────────────────────────

command -v pg_dump  >/dev/null 2>&1 || die "pg_dump not found — install postgresql-client"
command -v gzip     >/dev/null 2>&1 || die "gzip not found"

# ── Configuration ──────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-./backups}"

# Parse DATABASE_URL when present; otherwise fall back to discrete DB_* vars.
if [[ -n "${DATABASE_URL:-}" ]]; then
  # Strip the scheme, e.g. postgres://user:pass@host:5432/dbname
  _url="${DATABASE_URL#postgres://}"
  _url="${_url#postgresql://}"
  _userinfo="${_url%%@*}"
  _hostpart="${_url##*@}"
  DB_USER="${_userinfo%%:*}"
  DB_PASSWORD="${_userinfo#*:}"
  _hostport="${_hostpart%%/*}"
  DB_HOST="${_hostport%%:*}"
  DB_PORT="${_hostport##*:}"
  DB_NAME="${_hostpart##*/}"
  # Remove any query-string parameters from DB_NAME
  DB_NAME="${DB_NAME%%\?*}"
  export PGPASSWORD="${DB_PASSWORD}"
else
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  DB_USER="${DB_USER:-minicrm}"
  DB_NAME="${DB_NAME:-minicrm}"
  if [[ -n "${DB_PASSWORD:-}" ]]; then
    export PGPASSWORD="${DB_PASSWORD}"
  fi
fi

# ── Run backup ─────────────────────────────────────────────────────────────────

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/minicrm-backup-${TIMESTAMP}.dump"
FINAL_FILE="${DUMP_FILE}.gz"

log "Starting backup of ${DB_NAME}@${DB_HOST}:${DB_PORT} → ${FINAL_FILE}"

if ! pg_dump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --username="${DB_USER}" \
  --dbname="${DB_NAME}" \
  --format=custom \
  --file="${DUMP_FILE}"; then
  rm -f "${DUMP_FILE}"
  die "pg_dump failed — backup aborted"
fi

if ! gzip "${DUMP_FILE}"; then
  rm -f "${DUMP_FILE}"
  die "gzip failed — raw dump left at ${DUMP_FILE}"
fi

SIZE="$(du -sh "${FINAL_FILE}" | cut -f1)"
log "Backup complete: ${FINAL_FILE} (${SIZE})"
