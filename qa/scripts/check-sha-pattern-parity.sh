#!/usr/bin/env bash
# ===========================================================================
# check-sha-pattern-parity.sh  (MINCRM-688)
#
# CI lint step — fail if the coverage build-SHA accept-set has drifted between
# the three places that hold it.
#
# WHY THREE COPIES EXIST
# ----------------------
# The same rule decides which commit-SHA values are usable in three workspaces
# that cannot share a runtime import:
#
#   1. server/src/coverageAgent/coverageConfig.ts   (SAFE_PATH_SEGMENT_PATTERN)
#      Tags coverage DUMPS. Here the value becomes a filesystem path segment,
#      so the rule is also a traversal guard.
#   2. qa/e2e/framework/coverageAgent/coverage-session-control-client.ts
#      (SAFE_BUILD_SHA_PATTERN) — tags coverage SESSIONS, which the attestation
#      gate joins on. qa/e2e/framework/ must stay product-agnostic and free of
#      shared-schema imports, so it cannot import either of the others.
#   3. coverage-dashboard/src/pages/SessionRecorderPage.tsx
#      (SAFE_BUILD_SHA_PATTERN) — tags manually recorded sessions.
#
# Hoisting the constant into the shared package was tried and does not work:
# that package is consumed as COMPILED .js, and neither the dashboard's vitest
# run nor CI's framework-spec job builds it first, so a newly-added export
# resolves to undefined at runtime in both.
#
# WHY A GREP AND NOT A TEST
# -------------------------
# A unit test can only compare definitions its own workspace can import. The QA
# framework spec pins (1) against (2) by importing the server's real constant —
# the one pair where that is possible. No workspace can import all three, so a
# test asserting parity for the dashboard copy would necessarily compare it to
# a transcribed literal, which cannot fail when the server changes. This script
# reads all three source files directly, which is the only mechanism that
# actually catches drift in any direction.
#
# A split between any two copies is invisible at runtime until the attestation
# gate reports `no-session-attribution` or a generated coverage map turns out to
# be keyed to values one side rejected.
# ===========================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Each entry: <file>::<constant name>
DEFINITIONS=(
  "server/src/coverageAgent/coverageConfig.ts::SAFE_PATH_SEGMENT_PATTERN"
  "qa/e2e/framework/coverageAgent/coverage-session-control-client.ts::SAFE_BUILD_SHA_PATTERN"
  "coverage-dashboard/src/pages/SessionRecorderPage.tsx::SAFE_BUILD_SHA_PATTERN"
)

failed=0
canonical=""
canonical_source=""

for entry in "${DEFINITIONS[@]}"; do
  file="${entry%%::*}"
  name="${entry##*::}"
  path="$REPO_ROOT/$file"

  if [[ ! -f "$path" ]]; then
    echo "ERROR: $file not found — did the file move? Update this script's DEFINITIONS list."
    failed=1
    continue
  fi

  # Take everything after the first '=' on the declaration line, minus the
  # trailing semicolon. Deliberately compares the literal source text: two
  # regexes that differ only cosmetically still represent a decision someone
  # made in one place and not the others, and should be reconciled explicitly.
  pattern="$(grep -E "(const|export const) ${name} = " "$path" | head -1 | sed -E 's/^[^=]*= *//; s/;[[:space:]]*$//')"

  if [[ -z "$pattern" ]]; then
    echo "ERROR: could not find '${name}' in $file"
    failed=1
    continue
  fi

  if [[ -z "$canonical" ]]; then
    canonical="$pattern"
    canonical_source="$file"
  elif [[ "$pattern" != "$canonical" ]]; then
    echo "ERROR: coverage build-SHA pattern has drifted."
    echo "  $canonical_source:"
    echo "    $canonical"
    echo "  $file:"
    echo "    $pattern"
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  echo
  echo "FAIL: the three coverage build-SHA accept-sets must stay identical."
  echo "They tag coverage sessions and dumps that the attestation gate and the"
  echo "coverage map key off; a split is invisible until a gate reports"
  echo "no-session-attribution or a generated map turns out unusable."
  echo "See this script's header for why the rule is duplicated rather than shared."
  exit 1
fi

echo "PASS: coverage build-SHA pattern is identical across all ${#DEFINITIONS[@]} definitions."
