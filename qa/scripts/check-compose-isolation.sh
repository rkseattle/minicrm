#!/usr/bin/env bash
#
# check-compose-isolation.sh — MINCRM-684
#
# Asserts the dev and test Compose projects stay physically isolated:
#   1. Both projects config-validate (dev is a MERGED project: base + dev overlay —
#      validating each file alone would miss merge-only failures).
#   2. No container_name is shared. container_name is global to the Docker daemon, not
#      scoped by Compose project, so a duplicate makes the second stack unstartable.
#   3. No published host port is shared, so both stacks can run simultaneously.
#   4. Named volumes resolve to distinct project-scoped names, so a test run can never
#      write into the dev stack's data volume.
#   5. The test stack never names a dev database. This is the regression that motivated
#      the ticket: isolation used to be by DB_NAME alone on one shared Postgres, and a
#      test process resolving the wrong name truncated the dev database.
#
# Requires the `docker` CLI. Skips (exit 0) when unavailable so the check does not break
# environments without Docker.
#
# Deliberately a LOCAL gate only — it is wired into .claude/gates/definition-of-done.md
# and runs before every commit, not from any GitHub workflow. Compose files describe the
# local topology exclusively: CI stands its services up directly and never invokes
# Compose (verified: zero `docker compose` references across .github/). Adding a CI step
# was considered and declined to keep this change provably CI-neutral; the check runs
# where compose files are actually edited.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

if ! command -v docker >/dev/null 2>&1; then
  echo "check-compose-isolation: docker CLI not found — skipping."
  exit 0
fi

DEV_ARGS=(-f docker-compose.yml -f docker-compose.dev.yml --profile web --profile backup)
TEST_ARGS=(-f docker-compose.test.yml)

failures=0
fail() {
  echo "FAIL: $1"
  failures=$((failures + 1))
}

# ── 1. Both projects must config-validate ────────────────────────────────────
dev_config=$(docker compose "${DEV_ARGS[@]}" config 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$dev_config" ]; then
  fail "dev project (docker-compose.yml + docker-compose.dev.yml) failed to validate."
  echo "  Reproduce: docker compose ${DEV_ARGS[*]} config"
fi

test_config=$(docker compose "${TEST_ARGS[@]}" config 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$test_config" ]; then
  fail "test project (docker-compose.test.yml) failed to validate."
  echo "  Reproduce: docker compose ${TEST_ARGS[*]} config"
fi

# The dev stack must also validate WITHOUT --profile web, since that is the default
# local invocation, and must not expose the nginx client on port 80 in that mode.
dev_default=$(docker compose -f docker-compose.yml -f docker-compose.dev.yml config 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$dev_default" ]; then
  fail "dev project failed to validate without --profile web (the default local mode)."
elif grep -qE '^\s+published: "80"$' <<<"$dev_default"; then
  fail "port 80 is published by the default dev stack; the client service must stay profiled."
fi

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "check-compose-isolation: $failures failure(s)."
  exit 1
fi

# Positive expectation before the collision greps: if `config` emitted something
# unexpected, the greps below would find nothing and report a false OK.
test_name_count=$(grep -cE '^\s+container_name: ' <<<"$test_config")
if [ "$test_name_count" -lt 5 ]; then
  fail "test project rendered only ${test_name_count} container_name entries (expected >= 5) — refusing to report OK on a degraded config."
  echo ""
  echo "check-compose-isolation: $failures failure(s)."
  exit 1
fi

# ── 2. container_name collisions ─────────────────────────────────────────────
dup_names=$( { grep -oE 'container_name: [a-z0-9_-]+' <<<"$dev_config"
               grep -oE 'container_name: [a-z0-9_-]+' <<<"$test_config"; } | sort | uniq -d)
if [ -n "$dup_names" ]; then
  fail "container_name shared between the dev and test stacks:"
  echo "$dup_names" | sed 's/^/    /'
fi

# ── 3. published host port collisions ────────────────────────────────────────
dup_ports=$( { grep -oE 'published: "[0-9]+"' <<<"$dev_config"
               grep -oE 'published: "[0-9]+"' <<<"$test_config"; } | sort | uniq -d)
if [ -n "$dup_ports" ]; then
  fail "published host port shared between the dev and test stacks:"
  echo "$dup_ports" | sed 's/^/    /'
fi

# ── 4. named volume / network collisions ─────────────────────────────────────
# The `name:` key under a top-level volumes: or networks: block renders identically, so
# this catches both. Both must be disjoint, and both are project-scoped by Compose, so a
# collision here means a project name clash rather than a stray declaration.
dup_volumes=$( { grep -oE '^    name: minicrm[a-z0-9_-]*$' <<<"$dev_config"
                 grep -oE '^    name: minicrm[a-z0-9_-]*$' <<<"$test_config"; } | sort | uniq -d)
if [ -n "$dup_volumes" ]; then
  fail "named volume or network shared between the dev and test stacks:"
  echo "$dup_volumes" | sed 's/^/    /'
fi

# ── 5. the test stack must never name a dev database ─────────────────────────
# Both patterns are anchored, so they are mutually exclusive; order is not significant.
for dev_db in 'minicrm' 'minicrm_coverage'; do
  if grep -qE "(DB_NAME|POSTGRES_DB):[[:space:]]*\"?${dev_db}\"?[[:space:]]*$" <<<"$test_config"; then
    fail "test stack resolves a dev database name (${dev_db}). It must use the *_e2e/*_test databases."
  fi
done

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "check-compose-isolation: $failures failure(s)."
  exit 1
fi

echo "check-compose-isolation: OK — dev and test stacks are isolated."
