#!/usr/bin/env bash
# restore.sh — Restore a MiniCRM PostgreSQL backup (MINCRM-393).
#
# Usage:
#   ./scripts/restore.sh <backup-file>
#
# <backup-file> may be a plain pg_dump custom-format file (.dump) or a gzip-
# compressed dump (.dump.gz / .gz). The script decompresses to a temp file
# automatically and cleans up on exit.
#
# Environment variables (all optional — defaults mirror docker-compose.yml):
#   DATABASE_URL   Full connection string, e.g. postgres://user:pass@host:5432/dbname
#                  When set, DB_* variables below are ignored.
#   DB_HOST        Postgres host        (default: localhost)
#   DB_PORT        Postgres port        (default: 5432)
#   DB_USER        Postgres user        (default: minicrm)
#   DB_NAME        Postgres database    (default: minicrm)
#   DB_PASSWORD    Postgres password
#
# WARNING: This overwrites ALL current data in the target database.
#          Confirm the correct host and database before running.
#
# Exit codes:
#   0  — success
#   1  — pre-flight check failed (missing argument, missing tool, bad env)
#   2  — pg_restore failed

set -euo pipefail

# ── Helpers ────────────────────────────────────────────────────────────────────

log()  { echo "[restore] $*"; }
err()  { echo "[restore] ERROR: $*" >&2; }
die()  { err "$*"; exit 1; }

# ── Pre-flight ─────────────────────────────────────────────────────────────────

[[ $# -ge 1 ]] || die "Usage: $0 <backup-file>"

BACKUP_FILE="$1"
[[ -f "${BACKUP_FILE}" ]] || die "File not found: ${BACKUP_FILE}"

command -v pg_restore >/dev/null 2>&1 || die "pg_restore not found — install postgresql-client"

# ── Configuration ──────────────────────────────────────────────────────────────

if [[ -n "${DATABASE_URL:-}" ]]; then
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

# ── Decompress if needed ───────────────────────────────────────────────────────

RESTORE_FILE="${BACKUP_FILE}"
TEMP_FILE=""

cleanup() {
  if [[ -n "${TEMP_FILE}" && -f "${TEMP_FILE}" ]]; then
    rm -f "${TEMP_FILE}"
  fi
}
trap cleanup EXIT

case "${BACKUP_FILE}" in
  *.gz)
    command -v gunzip >/dev/null 2>&1 || die "gunzip not found — install gzip"
    TEMP_FILE="$(mktemp /tmp/minicrm-restore-XXXXXX.dump)"
    log "Decompressing ${BACKUP_FILE} → ${TEMP_FILE}"
    gunzip -c "${BACKUP_FILE}" > "${TEMP_FILE}"
    RESTORE_FILE="${TEMP_FILE}"
    ;;
esac

# ── Confirmation prompt ────────────────────────────────────────────────────────

log "WARNING: This will OVERWRITE all data in ${DB_NAME}@${DB_HOST}:${DB_PORT}"
log "Restoring from: ${BACKUP_FILE}"
read -r -p "[restore] Type 'yes' to continue: " CONFIRM
[[ "${CONFIRM}" == "yes" ]] || die "Restore aborted by user"

# ── Run restore ────────────────────────────────────────────────────────────────

log "Restoring ${DB_NAME}@${DB_HOST}:${DB_PORT} from ${BACKUP_FILE}…"

if ! pg_restore \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --username="${DB_USER}" \
  --dbname="${DB_NAME}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "${RESTORE_FILE}"; then
  die "pg_restore failed — database may be in a partially restored state; check pg_restore output above"
fi

log "Restore complete. Database ${DB_NAME} is ready."
