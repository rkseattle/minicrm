#!/usr/bin/env bash
# ===========================================================================
# check-e2e-beforeall.sh  (MINCRM-368)
#
# CI lint step — fail if any spec file under qa/e2e/tests/ calls loginAsAdmin
# inside a test.beforeAll block.
#
# WHY THIS EXISTS
# ---------------
# test.beforeAll runs once per worker. The restClient fixture is per-test, so
# any loginAsAdmin call in beforeAll only authenticates the fixture instance
# that exists at beforeAll time — subsequent per-test instances are unaffected.
# This makes the call a silent no-op that creates a false sense of security and
# introduces session-bleed risk when tests later switch to a rep session.
#
# The global storageState in playwright.config.ts (MINCRM-192) pre-authenticates
# the browser context for all tests. Tests that need an authenticated restClient
# must call loginAsAdmin(restClient) at the start of their own body, or restore
# admin auth in a finally block after switching to a non-admin session.
#
# ESCAPE HATCH
# ------------
# If a file genuinely needs loginAsAdmin in beforeAll (e.g. because storageState
# is insufficient and the rationale is documented), add the comment:
#   // MINCRM-368-ok: <reason>
# on the same line as the loginAsAdmin call and this script will allow it.
#
# HOW IT WORKS
# ------------
# The script scans each spec file for a multi-line pattern: a beforeAll block
# containing a loginAsAdmin call. It uses awk to track whether execution is
# currently inside a beforeAll block and flags loginAsAdmin calls within one.
#
# KNOWN GAPS
# ----------
# Brace tracking strips // comments and quoted strings before counting, so a brace
# in either does not move block depth. It is still not a parser: a brace inside a
# template literal spanning lines, or one built by concatenation, would miscount.
# No spec writes either shape today.
# ===========================================================================

set -euo pipefail

# A typo'd flag must not silently run the real check and report green.
if [ "$#" -gt 0 ] && [ "${1:-}" != "--self-test" ]; then
  echo "Unknown argument: $1"
  echo "Usage: bash qa/scripts/check-e2e-beforeall.sh [--self-test]"
  exit 2
fi

# --self-test runs this script against a generated corpus, following check-e2e-cleanup.sh.
# TESTS_DIR points at a fixture tree because a planted violation living under
# qa/e2e/tests/ would fail the real run for good.
if [ "${1:-}" = "--self-test" ]; then
  self_test_dir="$(mktemp -d)"
  trap 'rm -rf "$self_test_dir"' EXIT

  # One directory per case, so a run sees exactly one spec.
  write_case() {
    mkdir -p "$self_test_dir/$1"
    cat > "$self_test_dir/$1/x.spec.ts"
  }

  write_case ok-in-test <<'SPEC'
test('does the thing', async ({ restClient }) => {
  await loginAsAdmin(restClient);
});
SPEC

  write_case ok-beforeeach <<'SPEC'
test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});
SPEC

  # The block closed before the call, so tracking must not still consider itself inside.
  write_case ok-after-beforeall <<'SPEC'
test.beforeAll(async () => {
  await seedSomething();
});
test('later', async ({ restClient }) => {
  await loginAsAdmin(restClient);
});
SPEC

  write_case ok-suppressed <<'SPEC'
test.beforeAll(async ({ restClient }) => {
  await loginAsAdmin(restClient); // MINCRM-368-ok: storageState is insufficient here
});
SPEC

  # The non-arrow form: its parameter list holds no braces, so the body brace on the
  # signature line is the one that opens the block.
  write_case ok-function-form <<'SPEC'
test.beforeAll(async function () {
  await seed();
});
test('t', async ({ restClient }) => {
  await loginAsAdmin(restClient);
});
SPEC

  write_case bad-multiline <<'SPEC'
test.beforeAll(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});
SPEC

  # A brace inside a string or comment is not block structure; counting it would end the
  # block early and let the call through.
  write_case brace-in-string <<'SPEC'
test.beforeAll(async ({ restClient }) => {
  const closing = '}';
  await loginAsAdmin(restClient);
});
SPEC

  write_case brace-in-comment <<'SPEC'
test.beforeAll(async ({ restClient }) => {
  // the block closes with }
  await loginAsAdmin(restClient);
});
SPEC

  write_case bad-single-line <<'SPEC'
test.beforeAll(async ({ restClient }) => { await loginAsAdmin(restClient); });
SPEC

  # Prettier wraps a long fixture list, putting the arrow on a later line — a shape an
  # author reaches by running the formatter, not by writing anything unusual.
  write_case bad-wrapped-signature <<'SPEC'
test.beforeAll(
  async ({
    restClient,
    browserContextFixture,
    testDataManagerFixture,
    someOtherLongFixtureName,
  }) => {
    await loginAsAdmin(restClient);
  },
);
SPEC

  # An unbalanced opening brace in a string must not keep the block open past its close,
  # or a call in a later, ordinary test body is flagged.
  write_case ok-opening-brace-in-string <<'SPEC'
test.beforeAll(async () => {
  const opening = '{';
  await seed();
});
test('t', async ({ restClient }) => {
  await loginAsAdmin(restClient);
});
SPEC

  run_case() {
    local output
    output="$(TESTS_DIR="$self_test_dir/$1" bash "$0" 2>&1)" && RUN_CASE_STATUS=0 ||
      RUN_CASE_STATUS=$?
    RUN_CASE_FINDINGS="$(printf '%s\n' "$output" |
      grep -cE ': loginAsAdmin inside test\.beforeAll$' || true)"
  }

  # Findings AND exit status. Counting alone passes a guard that prints its findings and
  # still exits 0, which blocks nothing; status alone cannot tell a correct verdict from
  # one that flagged the wrong line or double-counted a single violation.
  expect_case() {
    local case_name="$1" want_findings="$2" want_status="$3"
    run_case "$case_name"
    if [ "$RUN_CASE_FINDINGS" -ne "$want_findings" ]; then
      echo "SELF-TEST FAIL: $case_name expected $want_findings finding(s), got $RUN_CASE_FINDINGS"
      self_test_failures=$((self_test_failures + 1))
    fi
    if [ "$RUN_CASE_STATUS" -ne "$want_status" ]; then
      echo "SELF-TEST FAIL: $case_name expected exit $want_status, got $RUN_CASE_STATUS"
      self_test_failures=$((self_test_failures + 1))
    fi
  }

  self_test_failures=0
  self_test_total=0
  clean_cases="ok-in-test ok-beforeeach ok-after-beforeall ok-suppressed ok-function-form"
  violation_cases="bad-multiline bad-single-line bad-wrapped-signature brace-in-string
    brace-in-comment"

  for case_name in $clean_cases; do
    expect_case "$case_name" 0 0
    self_test_total=$((self_test_total + 1))
  done
  for case_name in $violation_cases; do
    expect_case "$case_name" 1 1
    self_test_total=$((self_test_total + 1))
  done
  expect_case ok-opening-brace-in-string 0 0
  self_test_total=$((self_test_total + 1))

  # An empty tree must fail, not report OK — that is the fail-open shape a guard whose
  # only failure mode is silence has to rule out.
  mkdir -p "$self_test_dir/empty"
  if TESTS_DIR="$self_test_dir/empty" bash "$0" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: an empty tests directory reported OK"
    self_test_failures=$((self_test_failures + 1))
  fi

  if [ "$self_test_failures" -ne 0 ]; then
    echo "SELF-TEST FAIL: $self_test_failures case(s) wrong."
    exit 1
  fi
  echo "SELF-TEST PASS: $self_test_total cases asserted on findings and exit status," \
    "empty tree rejected."
  exit 0
fi

# Honour a caller-supplied TESTS_DIR (the self-test points it at a fixture tree);
# otherwise resolve it relative to this script.
if [ -z "${TESTS_DIR:-}" ]; then
  TESTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/tests"
fi

if [ ! -d "$TESTS_DIR" ]; then
  echo "tests directory not found: $TESTS_DIR"
  exit 1
fi

FOUND=0
SCANNED=0

while IFS= read -r file; do
  SCANNED=$((SCANNED + 1))
  # Use awk to detect loginAsAdmin calls inside beforeAll blocks.
  # Tracks brace depth from the opening of beforeAll to find its closing brace.
  result=$(awk '
    BEGIN { in_beforeall=0; depth=0; found=0 }
    /test\.beforeAll[[:space:]]*\(/ {
      in_beforeall=1
      depth=0
      signature_line=1
    }
    in_beforeall && /loginAsAdmin/ && !/MINCRM-368-ok/ {
      found=1
      print FILENAME ":" NR ": loginAsAdmin inside test.beforeAll"
    }
    in_beforeall {
      # Count braces from the arrow onward on the signature line. A destructured
      # fixture parameter — async ({ restClient }) => { — opens and closes a brace
      # before the body does, driving depth back to 0 and ending the block on its
      # own first line, so the body was never scanned.
      #
      # Counted AFTER the loginAsAdmin test above so a single-line block is caught.
      line = $0
      if (signature_line) {
        arrow = index(line, "=>")
        if (arrow) {
          line = substr(line, arrow)
          signature_line = 0
        } else if (line ~ /\)[[:space:]]*\{[[:space:]]*$/) {
          # The non-arrow form — test.beforeAll(async function () { — whose parameter
          # list holds no braces, so the body brace on this line is the one to count.
          signature_line = 0
        } else {
          # Arrow on a later line: every brace until then belongs to the parameter list.
          line = ""
        }
      }
      # Drop // comments and quoted strings first. A brace inside either is not block
      # structure, and counting it ends the block early — the under-reporting direction,
      # where a real call goes unflagged and nothing says so.
      sub(/\/\/.*$/, "", line)
      gsub(/'"'"'[^'"'"']*'"'"'/, "", line)
      gsub(/"[^"]*"/, "", line)
      gsub(/`[^`]*`/, "", line)

      for (i=1; i<=length(line); i++) {
        c = substr(line, i, 1)
        if (c == "{") depth++
        if (c == "}") {
          depth--
          if (depth == 0) { in_beforeall=0 }
        }
      }
    }
    END { exit found }
  ' "$file" 2>&1) || {
    echo "$result"
    FOUND=1
  }
done < <(find "$TESTS_DIR" -name "*.spec.ts" | sort)

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "FAIL: loginAsAdmin called inside test.beforeAll in the above files."
  echo ""
  echo "The restClient fixture is per-test — loginAsAdmin in beforeAll is a no-op"
  echo "for subsequent tests and risks session pollution across parallel workers."
  echo ""
  echo "Options:"
  echo "  1. Remove the beforeAll block (admin auth is already set via storageState)."
  echo "  2. Call loginAsAdmin(restClient) at the start of each test body that needs it."
  echo "  3. If beforeAll is genuinely required, add '// MINCRM-368-ok: <reason>' to"
  echo "     the same line as the loginAsAdmin call to suppress this check."
  echo ""
  echo "See qa/e2e/behaviors/README.md for full guidance."
  exit 1
fi

# Scanning nothing is not a pass. An empty or wrong TESTS_DIR would otherwise report OK,
# which is the fail-open shape this guard exists to prevent.
if [ "$SCANNED" -eq 0 ]; then
  echo "FAIL: no spec files found under $TESTS_DIR — nothing was checked."
  exit 1
fi

echo "OK: no loginAsAdmin calls found inside test.beforeAll blocks ($SCANNED specs)."
