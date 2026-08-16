#!/usr/bin/env bash
# =============================================================================
# check-audit-gate-parity.sh (MINCRM-668)
#
# Asserts that every caller of the dependency audit runs the ONE shared
# definition, scripts/npm-audit-gate.sh, rather than its own copy of the rule.
#
# WHAT BREAKS SILENTLY WITHOUT THIS
# ---------------------------------
# `npm audit` exits non-zero BOTH when it finds advisories and when it fails to
# run at all, so a bare `npm audit --audit-level=high` cannot distinguish
# "clean" from "never produced a verdict". A registry outage yields empty output
# that scrapes to zero advisories and reports a GREEN security gate. The shared
# script fails closed on an unreadable report; a hand-rolled copy does not.
#
# This is not hypothetical, and it is not a first offense:
#
#   * MINCRM-703 hardened ci.yml's copy against exactly that hole and left
#     security-audit.yml a bare invocation, so the NIGHTLY security job reported
#     green on any registry outage for as long as it went unnoticed.
#   * MINCRM-704 extracted the composite action to stop those two drifting.
#   * MINCRM-668 then added a local pre-push gate whose first draft carried a
#     third copy — the bare, fail-open form again.
#
# Three independent reintroductions of one rule is the signal that a comment
# saying "keep these in sync" is not sufficient. This check is.
#
# WHY A GREP AND NOT A SHARED IMPORT
# ----------------------------------
# The three callers are a bash composite action, a TypeScript hook, and a shell
# script — no import can span them. Source-level enforcement is the only thing
# that pins them together.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SHARED_SCRIPT="scripts/npm-audit-gate.sh"

# Files that must invoke the shared script rather than rolling their own audit.
CALLERS=(
  ".github/actions/npm-audit/action.yml"
  "scripts/pre-push-tia.ts"
)

failed=0

if [[ ! -x "${REPO_ROOT}/${SHARED_SCRIPT}" ]]; then
  echo "ERROR: ${SHARED_SCRIPT} is missing or not executable."
  echo "  It is the single definition every audit caller runs; without the"
  echo "  executable bit, both CI and the pre-push hook fail at invocation."
  exit 1
fi

# The shared script itself must keep the fail-closed report check. Losing this
# is the precise regression that made the nightly job report green on an outage,
# and it would leave every caller below correctly pointed at a broken rule.
if ! grep -q 'metadata.vulnerabilities | type) == "object"' "${REPO_ROOT}/${SHARED_SCRIPT}"; then
  echo "ERROR: ${SHARED_SCRIPT} no longer validates that npm audit produced a"
  echo "  usable report. An unreadable audit must never be treated as a clean"
  echo "  audit — see MINCRM-703."
  failed=1
fi

for caller in "${CALLERS[@]}"; do
  path="${REPO_ROOT}/${caller}"

  if [[ ! -f "$path" ]]; then
    echo "ERROR: ${caller} does not exist — update CALLERS in $(basename "$0")."
    failed=1
    continue
  fi

  # Must reference the shared script by name IN CODE. Checking the whole file
  # would pass on a comment that merely mentions the script — and both callers
  # carry exactly such a comment, so a caller could delete its real invocation,
  # keep the prose, and still pass. Verified by mutation: replacing the call
  # while leaving the comment must fail this check.
  if ! grep -E -q "npm-audit-gate\.sh" <(grep -v -E '^[[:space:]]*(#|//|\*)' "$path"); then
    echo "ERROR: ${caller} does not invoke ${SHARED_SCRIPT} in code."
    echo "  (A comment mentioning the script is not an invocation.)"
    failed=1
  fi

  # Must NOT carry its own `npm audit --audit-level=...` invocation. The shared
  # script is excluded from this rule by not being in CALLERS — it is the one
  # place the real invocation belongs.
  #
  # COMMENT LINES ARE STRIPPED FIRST. Both callers legitimately DISCUSS the bare
  # form in prose, explaining why they must not use it — and an earlier version
  # of this check flagged exactly those comments, which would have taught the
  # next author to delete the explanation rather than keep the rule. Only real
  # code counts: `#` for YAML and shell, `//` and `*` for TypeScript.
  #
  # `|| true` is load-bearing under `set -euo pipefail`: a non-matching grep
  # exits 1 and would abort the loop before the diagnostic below could run.
  # Two spellings, because the callers are different languages:
  #   * shell/YAML  — `npm audit --audit-level=high`
  #   * argv array  — execFileSync('npm', ['audit', '--audit-level=high'], ...)
  # Matching only the shell form let a real mutation through: the TypeScript
  # caller's array spelling never puts the two tokens on one line. Anything
  # naming --audit-level outside the shared script is now flagged.
  # Matched only where --audit-level sits alongside an npm/audit INVOCATION
  # token, not anywhere the flag is merely named. A bare '--audit-level' match
  # flagged this caller's own progress message
  # (`console.log('...(--audit-level=high)...')`), which is not a second
  # implementation of anything. Both real spellings still match:
  #   npm audit --audit-level=high          (shell / YAML)
  #   'npm', ['audit', '--audit-level=high'] (argv array)
  inline="$(grep -n -E -- "(npm[[:space:]]+audit|['\"]audit['\"])[^\n]*--audit-level" "$path" \
    | grep -v -E '^[0-9]+:[[:space:]]*(#|//|\*)' || true)"
  if [[ -n "$inline" ]]; then
    echo "ERROR: ${caller} carries its own 'npm audit --audit-level' invocation:"
    echo "${inline}" | sed 's/^/    /'
    echo "  Call ${SHARED_SCRIPT} instead — a bare invocation is fail-OPEN."
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  echo
  echo "FAIL: the dependency audit must have exactly one definition"
  echo "(${SHARED_SCRIPT}) with every caller delegating to it. A hand-rolled"
  echo "'npm audit --audit-level=high' is not an equivalent shortcut: it reports"
  echo "a green gate when the audit never ran. See this script's header for the"
  echo "three separate times that regression has been introduced."
  exit 1
fi

echo "PASS: all ${#CALLERS[@]} audit callers delegate to ${SHARED_SCRIPT}, which fails closed."
