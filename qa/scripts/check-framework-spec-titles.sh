#!/usr/bin/env bash
# =============================================================================
# check-framework-spec-titles.sh (MINCRM-706)
#
# Rejects a literal `@functional` tag in a real test() title under
# qa/e2e/tests/framework/.
#
# WHAT BREAKS SILENTLY WITHOUT THIS
# ---------------------------------
# Playwright greps the test TITLE (plus the file path and describe titles), not
# the tag metadata. A framework unit spec whose title merely mentions
# `@functional` in prose is therefore SELECTED BY THE FUNCTIONAL SUITE — it runs
# in e2e-functional's shards and in the local non-serial gate, alongside the app
# tests, for no reason.
#
# That is not hypothetical. Three titles in targeted-run-plan.spec.ts described
# the classifier's behaviour in prose ("treats a plain @functional title as
# non-serial") and leaked exactly that way. Measured before the rename:
#
#   --grep "@functional" --grep-invert "visual-regression|serial"
#       1004 tests / 80 files, versus 1002 / 79 on main
#   --grep "@functional" --project=desktop
#       661 tests / 97 files, versus 658 / 96
#
# The tests passed, so nothing failed and nothing reported it. The only signal
# was a test-count drift that no gate asserts on.
#
# WHY A BARE `@serial` IS ALLOWED
# -------------------------------
# SERIAL_GREP requires BOTH tags in either order, so a title carrying `@serial`
# alone is matched by neither half of the split. Only `@functional` makes a spec
# reachable. Flagging `@serial` too would reject correct, descriptive titles.
#
# WHY NOT A UNIT TEST
# -------------------
# A spec asserting "no framework title contains @functional" would have to carry
# the string itself to make the assertion — flagging its own title, or forcing an
# exemption that reopens the hole. A source-level grep has no such problem.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRAMEWORK_TESTS="${REPO_ROOT}/qa/e2e/tests/framework"

if [[ ! -d "$FRAMEWORK_TESTS" ]]; then
  echo "ERROR: ${FRAMEWORK_TESTS} does not exist — update $(basename "$0")."
  exit 1
fi

failed=0

# Only REAL invocations count. Line-anchoring alone is NOT enough, and assuming
# it was is how the first draft of this script produced nine false positives:
# this very file passes `test('@functional …')` strings to findTestTitles as
# TEST DATA inside template literals, indented exactly like real calls. Those
# strings must keep their literal tags — they are the input the parser is being
# tested against.
#
# So a tiny state machine tracks backtick template literals and block comments,
# and reports only lines that are live code. `//` line comments are stripped too:
# a commented-out example is documentation, not a selectable test.
# SC2016 is disabled for the awk program below: `$0` and `FNR` belong to awk, so
# the single quotes are required rather than an oversight.
# shellcheck disable=SC2016
while IFS= read -r hit; do
  echo "ERROR: ${hit#"${REPO_ROOT}/"}"
  failed=1
done < <(
  find "$FRAMEWORK_TESTS" -name '*.spec.ts' -print0 |
    xargs -0 awk '
      FNR == 1 { in_template = 0; in_block = 0 }

      {
        line = $0

        # Strip a trailing line comment before any analysis.
        sub(/\/\/.*$/, "", line)

        # Block comments: enter/leave, and skip wholly-commented lines.
        if (in_block) { if (line ~ /\*\//) in_block = 0; next }
        if (line ~ /\/\*/ && line !~ /\*\//) { in_block = 1; next }

        was_in_template = in_template

        # Toggle once per backtick on the line, so a line that both opens and
        # closes a template literal ends in the state it started.
        n = gsub(/`/, "`", line)
        if (n % 2 == 1) in_template = !in_template

        # Inside a template literal the content is data, not code.
        if (was_in_template) next

        if (line ~ /^[[:space:]]*(test|test\.(skip|only|fixme)|test\.describe(\.(serial|only|skip))?)\([[:space:]]*("|'"'"')[^"'"'"']*@functional/) {
          printf "%s:%d:%s\n", FILENAME, FNR, $0
        }
      }
    ' || true
)

if [[ "$failed" -ne 0 ]]; then
  echo
  echo "A literal '@functional' in a framework test title makes that spec"
  echo "selectable by the functional suite (--grep @functional), so it runs in"
  echo "e2e-functional's shards and the local non-serial gate for no reason."
  echo
  echo "Rewrite the title to describe the tag without spelling it — e.g."
  echo "'functional-tagged' instead of '@functional'. A bare '@serial' is fine:"
  echo "SERIAL_GREP requires both tags, so it matches neither half."
  exit 1
fi

echo "PASS: no framework spec title carries a literal @functional tag."
