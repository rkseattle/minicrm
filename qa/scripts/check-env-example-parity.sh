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

# Derived from the tracked templates rather than hand-listed: a hand-maintained list is
# itself a thing that drifts, and the whole point of this check is to catch drift. Every
# tracked `*.env*.example` maps to the local file it is copied to by dropping `.example`.
PAIRS=()
while IFS= read -r example; do
  [ -n "$example" ] && PAIRS+=("${example}:${example%.example}")
done < <(git ls-files '*.env.example' '*.env*.example' 2>/dev/null | sort -u)

if [ ${#PAIRS[@]} -eq 0 ]; then
  echo "check-env-example-parity: no tracked .env*.example templates found — nothing to check."
  exit 0
fi

# Active (uncommented) variable names. Tolerates `export FOO=` and leading whitespace.
env_keys() {
  sed -E 's/^[[:space:]]*export[[:space:]]+//' "$1" \
    | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' \
    | cut -d= -f1 \
    | sort -u
}

# Every name a template DOCUMENTS, active or commented (`# FOO=bar`). Templates mark
# optional variables by commenting them out, so a commented entry still counts as
# documented — otherwise this check would force developers to declare variables they do
# not need, contradicting .env.example's own "required unless marked optional" contract.
documented_keys() {
  sed -E 's/^[[:space:]]*#[[:space:]]*//; s/^[[:space:]]*export[[:space:]]+//' "$1" \
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

  # Anything active locally must at least be documented in the template — that is the
  # drift that strands a fresh clone (COVERAGE_DB_NAME / NODE_ENCRYPTION_KEY, MINCRM-684).
  only_local=$(comm -23 <(env_keys "$local_file") <(documented_keys "$example"))
  # Anything the template declares ACTIVE (not commented) is required, so it must be
  # ACTIVE locally too. Commented template entries are optional and not required at all.
  # Both sides use env_keys deliberately: accepting a commented-out local line here would
  # let `# NODE_ENCRYPTION_KEY=…` satisfy a required variable and pass the gate, then
  # fail the crypto suites with no hint — exactly the drift this script exists to catch.
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

# ---------------------------------------------------------------------------
# Mirror check: qa/.env.example and qa/e2e/.env.example (MINCRM-699)
#
# qa/e2e/.env.example declares itself a mirror of qa/.env.example in its own
# header, but the pair loop above only ever compares a template to its OWN local
# counterpart — never template to template. So the two could drift silently, and
# had: AI_HEAL_COST_WARNING_THRESHOLD was documented in one and absent from the
# other. Any edit touching one file must touch both, which is precisely the
# "two representations, nothing reconciling them" failure this ticket removes.
#
# Compares DOCUMENTED names (commented entries count), because the two files
# legitimately differ in which variables they leave commented out.
# ---------------------------------------------------------------------------
MIRROR_A="qa/.env.example"
MIRROR_B="qa/e2e/.env.example"

# Both are tracked, so an absent one means a rename or deletion went unnoticed —
# fail loudly rather than skipping. A silent skip here would drop the only
# assertion that runs in a fresh checkout, where no local .env files exist and
# every pair above is skipped.
if [ ! -f "$MIRROR_A" ] || [ ! -f "$MIRROR_B" ]; then
  echo "FAIL: expected both qa template mirrors to exist:"
  [ -f "$MIRROR_A" ] || echo "    missing: $MIRROR_A"
  [ -f "$MIRROR_B" ] || echo "    missing: $MIRROR_B"
  echo "  If one was renamed, update MIRROR_A/MIRROR_B in this script."
  failures=$((failures + 1))
else
  missing_from_b=$(comm -23 <(documented_keys "$MIRROR_A") <(documented_keys "$MIRROR_B"))
  missing_from_a=$(comm -13 <(documented_keys "$MIRROR_A") <(documented_keys "$MIRROR_B"))

  if [ -n "$missing_from_b" ]; then
    echo "FAIL: $MIRROR_A documents variables missing from $MIRROR_B:"
    echo "$missing_from_b" | sed 's/^/    /'
    echo "  These files are declared mirrors — document the variable in both."
    failures=$((failures + 1))
  fi

  if [ -n "$missing_from_a" ]; then
    echo "FAIL: $MIRROR_B documents variables missing from $MIRROR_A:"
    echo "$missing_from_a" | sed 's/^/    /'
    echo "  These files are declared mirrors — document the variable in both."
    failures=$((failures + 1))
  fi
fi

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "check-env-example-parity: $failures mismatch(es)."
  exit 1
fi

echo "check-env-example-parity: OK — every .env*.example matches its local counterpart,"
echo "and the qa/ template mirrors agree."
