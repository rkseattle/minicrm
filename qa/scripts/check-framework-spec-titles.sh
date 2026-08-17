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

# SC2016 is disabled file-wide for the awk program below: `$0`, `FNR` and the
# quote characters inside its regexes belong to awk, so single-quoting is
# required rather than an oversight.
# shellcheck disable=SC2016

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# --self-test points the scan at a generated corpus instead of the real tree.
# A guard whose only failure mode is SILENCE cannot be trusted on a spot-check:
# the first draft of this script was blind to backtick and multiline titles, and
# passing looked identical to working. That is the argument for this, and it
# follows check-e2e-cleanup.sh's own --self-test. (MINCRM-706)
SELF_TEST=0
if [[ "${1:-}" == "--self-test" ]]; then
  SELF_TEST=1
  FRAMEWORK_TESTS="$(mktemp -d)"
  trap 'rm -rf "$FRAMEWORK_TESTS"' EXIT
else
  FRAMEWORK_TESTS="${REPO_ROOT}/qa/e2e/tests/framework"
  if [[ ! -d "$FRAMEWORK_TESTS" ]]; then
    echo "ERROR: ${FRAMEWORK_TESTS} does not exist — update $(basename "$0")."
    exit 1
  fi
fi

if [[ "$SELF_TEST" -eq 1 ]]; then
  # Every form Playwright can select on, plus every form that must stay allowed.
  # The BAD cases are the six the first draft missed or caught; the OK cases are
  # the shapes this repo's specs legitimately contain — fixture data inside a
  # template literal above all, since that data must keep its literal tags.
  cat > "${FRAMEWORK_TESTS}/bad-single-quote.spec.ts" <<'CASE'
test('@functional plain single quote', () => {});
CASE
  cat > "${FRAMEWORK_TESTS}/bad-double-quote.spec.ts" <<'CASE'
test("@functional plain double quote", () => {});
CASE
  cat > "${FRAMEWORK_TESTS}/bad-backtick.spec.ts" <<'CASE'
test(`@functional backtick title`, () => {});
CASE
  cat > "${FRAMEWORK_TESTS}/bad-backtick-interpolated.spec.ts" <<'CASE'
test(`@functional rejects ${value} properly`, () => {});
CASE
  cat > "${FRAMEWORK_TESTS}/bad-multiline.spec.ts" <<'CASE'
test(
  '@functional title on the next line',
  () => {},
);
CASE
  cat > "${FRAMEWORK_TESTS}/bad-describe.spec.ts" <<'CASE'
test.describe('@functional a describe title', () => {});
CASE
  # Contrived but reachable: a stray comment or blank line between the call and
  # its title must not let the title escape. Greptile spotted this on PR #385.
  cat > "${FRAMEWORK_TESTS}/bad-multiline-stray-comment.spec.ts" <<'CASE'
test(
  // a stray comment
  '@functional title after a comment',
  () => {},
);
CASE
  cat > "${FRAMEWORK_TESTS}/bad-multiline-blank-line.spec.ts" <<'CASE'
test(

  '@functional title after a blank line',
  () => {},
);
CASE

  cat > "${FRAMEWORK_TESTS}/ok-fixture-data.spec.ts" <<'CASE'
const SPEC = `
  test('@functional F-C1: creates a contact', async () => {});
  test('@functional @serial F-M2: serial', async () => {});
`;
test('parses titles out of a fixture', () => {
  expect(findTestTitles(SPEC)).toHaveLength(2);
});
CASE
  cat > "${FRAMEWORK_TESTS}/ok-line-comment.spec.ts" <<'CASE'
// test('@functional commented out', () => {});
test('a real title with no tag', () => {});
CASE
  cat > "${FRAMEWORK_TESTS}/ok-block-comment.spec.ts" <<'CASE'
/*
  test('@functional inside a block comment', () => {});
*/
test('another real title', () => {});
CASE
  cat > "${FRAMEWORK_TESTS}/ok-bare-serial.spec.ts" <<'CASE'
test('plans only the serial half for a wholly-@serial selection', () => {});
CASE
  cat > "${FRAMEWORK_TESTS}/ok-assertion-arg.spec.ts" <<'CASE'
test('classifies a tagged title', () => {
  expect(isSerialTitle('@functional @serial F1: thing')).toBe(true);
});
CASE
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
findings=0
while IFS= read -r hit; do
  echo "ERROR: ${hit#"${REPO_ROOT}/"}"
  findings=$((findings + 1))
  failed=1
done < <(
  find "$FRAMEWORK_TESTS" -name '*.spec.ts' -print0 |
    xargs -0 awk '
      function is_call_opener(s) {
        return s ~ /^[[:space:]]*(test|test\.(skip|only|fixme)|test\.describe(\.(serial|only|skip))?)\([[:space:]]*$/
      }
      function has_tagged_title(s) {
        # A quoted title carrying the tag, in any of the three quote styles
        # Playwright accepts. Backticks included: a template-literal TITLE is
        # still a title, and shard-script-args.spec.ts already uses that form.
        return s ~ /^[[:space:]]*(test|test\.(skip|only|fixme)|test\.describe(\.(serial|only|skip))?)\([[:space:]]*("|'"'"'|`)[^"'"'"'`]*@functional/
      }
      function opens_bare_title(s) {
        # A quoted title opened on the line after the call — the multiline form.
        return s ~ /^[[:space:]]*("|'"'"'|`)[^"'"'"'`]*@functional/
      }

      FNR == 1 { in_data_template = 0; in_block = 0; pending_call = 0 }

      {
        line = $0
        sub(/\/\/.*$/, "", line)                     # strip line comments

        # A line left blank by that strip — a comment-only line — or a genuinely
        # blank one must NOT clear pending_call. Otherwise a stray comment or
        # blank line between a multiline call and its title lets the title escape
        # the scan entirely. Consume the line and keep waiting for the title.
        if (pending_call && line !~ /[^[:space:]]/) next

        if (in_block) { if (line ~ /\*\//) in_block = 0; next }
        if (line ~ /\/\*/ && line !~ /\*\//) { in_block = 1; next }

        # Inside a multi-line template literal holding FIXTURE DATA, everything
        # is input to the parser under test, not code. Leave on the closing
        # backtick and consume the line.
        if (in_data_template) {
          if (line ~ /`/) in_data_template = 0
          next
        }

        # A call whose title sits on the NEXT line (multiline form). Remember it
        # so the title line can be judged, then move on.
        if (is_call_opener(line)) { pending_call = 1; next }

        if (pending_call) {
          pending_call = 0
          if (opens_bare_title(line)) { printf "%s:%d:%s\n", FILENAME, FNR, $0; next }
        }

        if (has_tagged_title(line)) { printf "%s:%d:%s\n", FILENAME, FNR, $0; next }

        # An UNPAIRED backtick that is not opening a title opens a data template
        # (e.g. `const SERIAL_SPEC = ` + backtick). Titles are excluded above, so
        # anything reaching here with an odd backtick count is fixture data.
        n = gsub(/`/, "`", line)
        if (n % 2 == 1) in_data_template = 1
      }
    ' || true
)

# Assert the exact finding COUNT, not merely the exit status. An exit-only check
# passes just as happily when the scanner flags the wrong lines, or flags one bad
# case and misses five — which is the failure this self-test exists to catch.
if [[ "$SELF_TEST" -eq 1 ]]; then
  expected=8
  if [[ "$findings" -ne "$expected" ]]; then
    echo
    echo "SELF-TEST FAILED: expected ${expected} finding(s), got ${findings}."
    echo "  8 bad cases must be flagged: single-quote, double-quote, backtick,"
    echo "  interpolated backtick, multiline, describe, and multiline with a"
    echo "  stray comment or blank line before the title."
    echo "  5 ok cases must NOT be: fixture data in a template literal, a line"
    echo "  comment, a block comment, a bare @serial, and an assertion argument."
    exit 1
  fi
  echo "SELF-TEST PASSED: flagged all ${expected} selectable forms, and none of"
  echo "the 5 forms that must stay allowed."
  exit 0
fi

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
