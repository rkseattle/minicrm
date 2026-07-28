#!/usr/bin/env bash
#
# check-env-example-parity.sh — MINCRM-684
#
# Asserts each tracked .env*.example declares exactly the same set of variable NAMES as
# the local file developers copy it to. Values are never compared or read — the example
# files hold placeholders, and the real files are gitignored secrets.
#
# Why this exists: .env.test.example had silently drifted from .env.test, missing
# COVERAGE_DB_NAME and NODE_ENCRYPTION_KEY entirely. A fresh clone following the README
# got a test suite that failed in attachmentService/cryptoService with no indication the
# template was incomplete. Reconciling by hand fixes today and drifts again next PR;
# this makes the invariant enforceable.
#
# Only pairs where BOTH files exist are checked, so a developer who has not created a
# given local .env file yet is never blocked.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# example-file:local-file pairs.
#
# .env / .env.example is deliberately NOT listed yet: that pair has pre-existing drift
# (the local .env omits DB_HOST/DB_PORT/PORT/SMTP_*, and carries COVERAGE_*/E2E the
# template lacks). The missing DB_PORT is the very reason every non-.env.test path fell
# back to localhost:5432 — worth fixing, but it means editing a developer's live dev
# environment and is outside MINCRM-684's scope. Tracked separately; add the pair here
# once reconciled.
PAIRS=(
  ".env.test.example:.env.test"
  "qa/e2e/.env.example:qa/e2e/.env"
)

# Extracts sorted, unique variable names. Ignores comments, blanks and indented
# continuation lines; tolerates `export FOO=` and trailing whitespace.
env_keys() {
  sed -E 's/^[[:space:]]*export[[:space:]]+//' "$1" \
    | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' \
    | cut -d= -f1 \
    | sort -u
}

failures=0

for pair in "${PAIRS[@]}"; do
  example="${pair%%:*}"
  local_file="${pair##*:}"

  [ -f "$example" ] || continue
  if [ ! -f "$local_file" ]; then
    echo "check-env-example-parity: $local_file not present — skipping $example."
    continue
  fi

  only_local=$(comm -23 <(env_keys "$local_file") <(env_keys "$example"))
  only_example=$(comm -13 <(env_keys "$local_file") <(env_keys "$example"))

  if [ -n "$only_local" ]; then
    echo "FAIL: $local_file defines variables missing from $example:"
    echo "$only_local" | sed 's/^/    /'
    echo "  A fresh clone copying $example would not get these."
    failures=$((failures + 1))
  fi

  if [ -n "$only_example" ]; then
    echo "FAIL: $example defines variables missing from $local_file:"
    echo "$only_example" | sed 's/^/    /'
    echo "  Either add them locally or drop them from the template."
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "check-env-example-parity: $failures mismatch(es)."
  exit 1
fi

echo "check-env-example-parity: OK — every .env*.example matches its local counterpart."
