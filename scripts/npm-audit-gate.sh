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
# The bar is zero. There is no allowlist — MINCRM-703 deleted all 16 entries
# because every one resolved once the tree was actually re-resolved rather than
# reasoned about. If a future advisory genuinely has no fix, add an allowlist
# back with a written justification and a re-resolve actually attempted first.
#
# Callers are responsible for installing dependencies; this only audits an
# already-installed tree.
#
# Usage: scripts/npm-audit-gate.sh [--github]
#   --github  emit GitHub Actions ::error:: annotations (used by the action)

set -euo pipefail

GITHUB_ANNOTATIONS=0
if [ "${1:-}" = "--github" ]; then
  GITHUB_ANNOTATIONS=1
fi

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

set +e
npm audit --audit-level=high --json > "${AUDIT_JSON}"
AUDIT_STATUS=$?
set -e

# node, NOT jq, for every JSON read below. This script ran only on GitHub's
# ubuntu runners (where jq is preinstalled) until the local pre-push hook began
# calling it — and jq is NOT a documented or provisioned prerequisite of this
# repo. On a developer machine without it, every jq call failed, the check below
# read that as "no usable report", and a perfectly CLEAN audit blocked the push.
# Verified by reproducing with jq shadowed. node is guaranteed present: this is
# an npm repo and the hook itself already runs under tsx. (MINCRM-668, found in
# Greptile review on PR #384)
if ! node -e '
  const r = require(process.argv[1]);
  process.exit(r?.metadata?.vulnerabilities && typeof r.metadata.vulnerabilities === "object" ? 0 : 1);
' "${AUDIT_JSON}" > /dev/null 2>&1; then
  emit_error "npm audit did not produce a usable report (exit ${AUDIT_STATUS})."
  echo "Treating this as a failure: an unreadable audit is not a clean audit."
  head -c 4000 "${AUDIT_JSON}" || true
  exit 1
fi

HIGH=$(node -p "require('${AUDIT_JSON}').metadata.vulnerabilities.high || 0")
CRITICAL=$(node -p "require('${AUDIT_JSON}').metadata.vulnerabilities.critical || 0")

if [ "$HIGH" -gt 0 ] || [ "$CRITICAL" -gt 0 ]; then
  emit_error "npm audit found ${CRITICAL} critical and ${HIGH} high advisories:"
  node -e '
    const r = require(process.argv[1]);
    const lines = new Set();
    for (const v of Object.values(r.vulnerabilities || {})) {
      for (const via of v.via || []) {
        if (typeof via === "object" && via !== null) {
          lines.add(`${String(via.url || "").split("/").pop()}  ${via.severity}  ${via.name}`);
        }
      }
    }
    for (const l of [...lines].sort()) console.log(l);
  ' "${AUDIT_JSON}"
  node -e 'console.log(JSON.stringify(require(process.argv[1]).vulnerabilities, null, 2))' "${AUDIT_JSON}"
  echo ""
  echo "Before allowlisting anything, try a full re-resolve — an incremental"
  echo "npm install will NOT reconsider overrides for transitive deps:"
  echo "  rm -rf node_modules package-lock.json && npm install"
  echo "Pin the fixed version in the root package.json \"overrides\" block."
  exit 1
fi

echo "No high/critical advisories (MINCRM-703)."
