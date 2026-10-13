#!/usr/bin/env bash
#
# npm-audit-gate.sh — the repo's single EXECUTABLE definition of the
# high/critical dependency audit. (MINCRM-668)
#
# Three callers run this rule:
#   - ci.yml's blocking "Phase 1 - Security Audit" gate, via
#     .github/actions/npm-audit
#   - security-audit.yml's daily scheduled run against main, via the same action
#   - scripts/pre-push-tia.ts, the local pre-push hook
#
# WHY A SCRIPT AND NOT JUST THE COMPOSITE ACTION
# ----------------------------------------------
# The composite action already unified the two WORKFLOWS (MINCRM-704, after they
# had drifted and left the nightly job fail-open). It cannot be the single
# definition for the local hook too: a composite action is only invocable by the
# GitHub Actions runner. So the hook's options were to shell out to this rule or
# to carry its own copy — and a copy is exactly what drifted before. The first
# draft of the hook change did carry one, as a bare
# `npm audit --audit-level=high`, which is not merely a duplicate but a WEAKER
# rule: it reintroduces the fail-open hole below, where an unreadable report
# scrapes to zero advisories and reports green.
#
# The action now calls this script, so there is one rule with three callers
# rather than three implementations of one rule.
#
# FAILS CLOSED, DELIBERATELY
# --------------------------
# `npm audit` exits non-zero BOTH when it finds advisories and when it fails to
# run at all, so the exit code alone cannot distinguish "clean" from "never
# produced a verdict". This captures output and status separately and requires a
# well-formed report before trusting any conclusion — otherwise a registry
# outage, a proxy error, or an npm crash yields empty output that scrapes to
# zero advisories and reports a green security gate. (MINCRM-703)
#
# The bar is zero, less ALLOWLISTED_ADVISORIES below. An entry is admissible only
# when a clean re-resolve was attempted AND no patched release exists upstream —
# reasoning about why a fix "cannot work" is how a long allowlist once hid
# advisories that were all fixable. An allowlisted advisory still blocks if it
# reaches the production tree, and the gate warns once its advisory disappears.
#
# Callers are responsible for installing dependencies; this only audits an
# already-installed tree.
#
# Usage: scripts/npm-audit-gate.sh [--github | --self-test]
#   --github     emit GitHub Actions ::error:: annotations (used by the action)
#   --self-test  run only the advisory evaluator's fixture cases

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALUATOR="${SCRIPT_DIR}/npm-audit-evaluate.mjs"

# Advisories with no patched release, reached only through dev tooling. Each
# entry names its package, why it is unreachable in production, and where the
# fix is tracked upstream. Delete an entry the day its advisory goes away.
ALLOWLISTED_ADVISORIES=(
  # braces <=3.0.3 (stack-exhaustion DoS on nested patterns). Only dev/build
  # tooling expands globs with it — markdownlint-cli2, tailwindcss 3, nodemon,
  # promptfoo — over patterns this repo writes. Fix: micromatch/braces#87.
  "GHSA-vfj7-8cjw-p6xm"
  # node-forge <=1.4.0 (lenient RSA PKCS#1 v1.5 verification). Optional dep of
  # promptfoo's jks-js, a qa/ eval tool; absent from `npm ls --omit=dev`.
  # Fix: digitalbazaar/forge#1159.
  "GHSA-86w9-cpqp-85rv"
)

GITHUB_ANNOTATIONS=0
case "${1:-}" in
  --github) GITHUB_ANNOTATIONS=1 ;;
  --self-test) exec node "${EVALUATOR}" --self-test ;;
esac

# Errors go to stderr locally, and to stdout as ::error:: annotations under
# Actions — the runner only parses annotations from stdout.
emit_error() {
  if [ "$GITHUB_ANNOTATIONS" -eq 1 ]; then
    echo "::error::$1"
  else
    echo "ERROR: $1" >&2
  fi
}

# RUNNER_TEMP exists under Actions; fall back to a mktemp dir locally so the
# script is runnable from a developer's shell and from the hook.
TEMP_DIR="${RUNNER_TEMP:-$(mktemp -d)}"
AUDIT_JSON="${TEMP_DIR}/audit.json"
PRODUCTION_AUDIT_JSON="${TEMP_DIR}/audit-production.json"

# node, NOT jq, for every JSON read below. This script ran only on GitHub's
# ubuntu runners (where jq is preinstalled) until the local pre-push hook began
# calling it — and jq is NOT a documented or provisioned prerequisite of this
# repo. On a developer machine without it, every jq call failed, the check below
# read that as "no usable report", and a perfectly CLEAN audit blocked the push.
# Verified by reproducing with jq shadowed. node is guaranteed present: this is
# an npm repo and the hook itself already runs under tsx. (MINCRM-668, found in
# Greptile review on PR #384)
# Runs one audit and refuses to continue unless it produced a well-formed report.
run_audit() {
  local report_path="$1"
  shift
  local audit_status
  set +e
  npm audit --audit-level=high --json "$@" > "${report_path}"
  audit_status=$?
  set -e
  if ! node -e '
    const r = require(process.argv[1]);
    process.exit(r?.metadata?.vulnerabilities && typeof r.metadata.vulnerabilities === "object" ? 0 : 1);
  ' "${report_path}" > /dev/null 2>&1; then
    emit_error "npm audit $* did not produce a usable report (exit ${audit_status})."
    echo "Treating this as a failure: an unreadable audit is not a clean audit."
    head -c 4000 "${report_path}" || true
    exit 1
  fi
}

run_audit "${AUDIT_JSON}"
# The allowlist admits dev-only advisories; this report is how the gate checks that.
run_audit "${PRODUCTION_AUDIT_JSON}" --omit=dev

# The evaluator's own fixtures run on every gate invocation: a broken filter
# fails silently open, and this costs well under a second.
if ! node "${EVALUATOR}" --self-test > /dev/null; then
  emit_error "npm-audit-evaluate.mjs failed its self-test; refusing to trust its verdict."
  node "${EVALUATOR}" --self-test || true
  exit 1
fi

VERDICT_JSON="${TEMP_DIR}/audit-verdict.json"
if ! node "${EVALUATOR}" "${AUDIT_JSON}" "${PRODUCTION_AUDIT_JSON}" ${ALLOWLISTED_ADVISORIES[@]+"${ALLOWLISTED_ADVISORIES[@]}"} > "${VERDICT_JSON}"; then
  emit_error "npm-audit-evaluate.mjs rejected an audit report as incomplete; an unreadable audit is not a clean audit."
  exit 1
fi
verdict_lines() {
  node -e 'for (const l of require(process.argv[1])[process.argv[2]]) console.log(l)' "${VERDICT_JSON}" "$1"
}
BLOCKING_COUNT=$(verdict_lines blocking | wc -l | tr -d ' ')

for stale_id in $(verdict_lines stale); do
  if [ "$GITHUB_ANNOTATIONS" -eq 1 ]; then
    echo "::warning::${stale_id} is allowlisted but no longer reported; delete it from scripts/npm-audit-gate.sh."
  else
    echo "WARNING: ${stale_id} is allowlisted but no longer reported; delete it from scripts/npm-audit-gate.sh." >&2
  fi
done

if [ "$BLOCKING_COUNT" -gt 0 ]; then
  emit_error "npm audit found ${BLOCKING_COUNT} high/critical advisories not on the allowlist:"
  verdict_lines blocking
  node -e 'console.log(JSON.stringify(require(process.argv[1]).vulnerabilities, null, 2))' "${AUDIT_JSON}"
  echo ""
  echo "Before allowlisting anything, try a full re-resolve — an incremental"
  echo "npm install will NOT reconsider overrides for transitive deps:"
  echo "  rm -rf node_modules package-lock.json && npm install"
  echo "Pin the fixed version in the root package.json \"overrides\" block."
  exit 1
fi

SUPPRESSED=$(verdict_lines suppressed)
if [ -n "$SUPPRESSED" ]; then
  echo "Allowlisted (no patched release upstream):"
  echo "$SUPPRESSED"
fi
echo "No high/critical advisories outside the allowlist (MINCRM-703)."
