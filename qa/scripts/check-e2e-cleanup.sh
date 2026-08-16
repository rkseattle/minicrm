#!/usr/bin/env bash
# ===========================================================================
# check-e2e-cleanup.sh  (MINCRM-686)
#
# CI lint step — fail if a spec creates a record via a create*ViaApi helper
# without registering it for teardown.
#
# WHAT THIS CHECKS
# ----------------
# Scans every *.spec.ts file under qa/e2e/tests/ for calls matching
#   create<Entity>ViaApi(   |   convertLeadViaApi(
# and requires each call site to be followed, within a short window, by one of:
#   - testData.register(...)
#   - testData.registerCustomTeardown(...)
#   - registerAdminTeardown(...)          (helpers.ts — re-auths as admin first)
#   - an explicit opt-out marker (see ESCAPE HATCH below)
#
# The check is per CALL SITE, not per file. A file that registers its teams but
# not its contacts is exactly the case MINCRM-686 was filed against
# (owner-filter.spec.ts: six contacts created, zero cleaned), and a
# "does this file contain the word register" test cannot see it.
#
# Only qa/e2e/tests/ is scanned. Behavior modules and apps/minicrm/helpers.ts
# are NOT scanned — no behavior calls another create*ViaApi today (the helper
# layer is where registration is implemented, not consumed), and this guard's
# purpose is stopping a NEW SPEC from reintroducing the gap. Do not read a
# passing run as evidence about files outside qa/e2e/tests/.
#
# KNOWN SCOPE GAPS — a passing run does NOT prove these are clean:
#   - Records created through the BROWSER (a "New Session" click, a create form)
#     match no create*ViaApi call and are invisible here. ai.spec.ts's F-AI4 is
#     one such site; it registers explicitly.
#   - Users created through the browser (an invite submitted through the UI)
#     are invisible here for the same reason as any other browser-created
#     record.
#   - Records created by a raw entity POST (`restClient.post('/api/v1/teams', …)`)
#     rather than a create*ViaApi helper. Only the users/invite endpoint is
#     matched by path; every other entity relies on the helper naming
#     convention. MINCRM-668 converted twelve such sites in iam/ by hand.
#   - An invite POSTed through a PATH CONSTANT (`const P = '/api/v1/users/invite'`
#     then `post(P, ...)`) is invisible: the call line carries no literal. The
#     endpoint literal is matched wherever it appears on a line, so a wrapped
#     call or a wrapper function (bearerPost) IS seen, but a constant defeats
#     any line-based scanner. No spec uses that shape today.
#
# CLOSED GAP — user creation (MINCRM-668)
#   inviteUserViaApi and raw `POST /api/v1/users/invite` used to sit outside
#   CREATE_PATTERN, on the reasoning that users are deactivated rather than
#   deleted. That left the path with the worst history — MINCRM-544 was caused
#   by accumulated test USERS — as the one this script could not see, and four
#   call sites duly drifted into deactivating outside any try/finally, leaking
#   a user on every failing run. Both forms are now matched, and
#   registerUserDeactivation counts as registration alongside the other three
#   forms. Helpers that register internally (createTestUser, createTestRep,
#   createTestAdmin) are exempt at their call sites via
#   SELF_REGISTERING_PATTERN, since their cleanup is not visible to the caller.
#
# WHY THIS EXISTS
# ---------------
# TestDataManager deletes only what a test registers — it never truncates or
# bulk-deletes (see its docblock). The create*ViaApi behavior helpers do not
# register what they create, so a spec that forgets leaves the record behind on
# every run. reset-e2e-data.ts masks this locally by clearing accumulation
# between sessions, but it does not run between spec files and does not run in
# CI at all, so leakage accumulates for the length of a run.
#
# The cost is not hypothetical: MINCRM-544 exists because accumulated test
# users reached 50k+ and caused user-list pagination timeouts that cascaded
# into unrelated suites.
#
# HOW TO FIX A FAILURE
# --------------------
# Register the record immediately after creating it:
#
#   const contact = await createContactViaApi(restClient, { ... });
#   testData.register('contact', contact.id, `/api/v1/contacts/${contact.id}`);
#
# If the test re-authenticates restClient as a non-admin at any point, use
# registerAdminTeardown() from @apps/minicrm/helpers.js instead — teardown runs
# with the client in whatever auth state the test left it, and a rep deleting
# another user's record gets a 403, so the record is never cleaned up. That 403
# is now reported rather than swallowed — TestDataManager records success:false
# and the test is annotated teardown-failed — but the record still leaks, so
# the helper is still what you want. (MINCRM-668)
#
# Prefer the createTest* helpers in apps/minicrm/helpers.ts where they fit —
# they create and register in one call.
#
# ESCAPE HATCH
# ------------
# A record that is deliberately left behind, or is already cleaned up by other
# means, opts out with a same-line marker on the create call or on the line
# immediately following it:
#
#   const s = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach
#
# The reason is required — that is what makes a deliberate exception
# distinguishable from an oversight, rather than both looking like silence.
# ===========================================================================

set -euo pipefail

# shellcheck source=spec-files.sh
source "$(dirname "$0")/spec-files.sh"

# --self-test runs this script against a generated corpus of known-good and
# known-bad specs and asserts the verdict for each. Without it the guard's own
# correctness rests on a manual spot-check, and a guard that has silently
# stopped guarding is worse than none because it is trusted. (MINCRM-668)
if [ "${1:-}" = "--self-test" ]; then
  self_test_dir="$(mktemp -d)"
  trap 'rm -rf "$self_test_dir"' EXIT

  # One directory per case, so a run sees exactly one spec.
  write_case() {
    mkdir -p "$self_test_dir/${1%.spec.ts}"
    cat > "$self_test_dir/${1%.spec.ts}/$1"
  }

  # --- Cases that MUST pass ---------------------------------------------
  write_case 'ok-registered.spec.ts' <<'CASE'
test('registers what it creates', async ({ testData, restClient }) => {
  const contact = await createContactViaApi(restClient, { first_name: 'A' });
  testData.register('contact', contact.id, `/api/v1/contacts/${contact.id}`);
});
CASE

  write_case 'ok-invite-registered.spec.ts' <<'CASE'
test('registers an invited user', async ({ testData, restClient }) => {
  const { user, inviteToken } = await inviteUserViaApi(restClient, { role: 'rep' });
  registerUserDeactivation(testData, restClient, user.id, 'rep');
  await setUserPassword(restClient, inviteToken, 'x');
});
CASE

  write_case 'ok-raw-post-registered.spec.ts' <<'CASE'
test('registers a raw-POST invite', async ({ testData, restClient }) => {
  const inviteRes = await restClient.post('/api/v1/users/invite', { role: 'viewer' });
  const { user } = inviteRes.body;
  registerUserDeactivation(testData, restClient, user.id, 'viewer');
});
CASE

  write_case 'ok-self-registering.spec.ts' <<'CASE'
test('needs no registration of its own', async ({ testData, restClient }) => {
  const rep = await createTestUser(testData, restClient, { role: 'rep' });
  await loginAs(restClient, rep.email, 'pw');
});
CASE

  write_case 'ok-opted-out.spec.ts' <<'CASE'
test('opts out with a reason', async ({ restClient }) => {
  // MINCRM-686-ok: expected to fail with 409 — no user row is created.
  await inviteUserViaApi(restClient, { role: 'rep' });
});
CASE

  write_case 'ok-register-immediate.spec.ts' <<'CASE'
test('registers before the steps that can throw', async ({ testData, restClient }) => {
  const { user, inviteToken } = await inviteUserViaApi(restClient, { role: 'rep' });
  registerUserDeactivation(testData, restClient, user.id, 'rep');
  await restClient.post('/api/v1/users/set-password', { token: inviteToken, password: 'x' });
});
CASE

  write_case 'ok-comment-mentions-invite.spec.ts' <<'CASE'
// The server exposes post '/api/v1/users/invite' for admins only.
test('discusses the endpoint without calling it', async ({ restClient }) => {
  const res = await restClient.get('/api/v1/users');
  expect(res.status).toBe(200);
});
CASE

  # --- Cases that MUST fail ---------------------------------------------
  write_case 'bad-unregistered.spec.ts' <<'CASE'
test('leaks a contact', async ({ restClient }) => {
  const contact = await createContactViaApi(restClient, { first_name: 'A' });
  expect(contact.id).toBeTruthy();
});
CASE

  write_case 'bad-invite-unregistered.spec.ts' <<'CASE'
test('leaks an invited user', async ({ restClient }) => {
  const { user } = await inviteUserViaApi(restClient, { role: 'rep' });
  expect(user.id).toBeTruthy();
});
CASE

  write_case 'bad-raw-post-unregistered.spec.ts' <<'CASE'
test('leaks a raw-POST invite', async ({ restClient }) => {
  const inviteRes = await restClient.post('/api/v1/users/invite', { role: 'viewer' });
  expect(inviteRes.status).toBe(201);
});
CASE

  write_case 'bad-register-after-await.spec.ts' <<'CASE'
test('registers after a step that can throw', async ({ testData, restClient }) => {
  const { user, inviteToken } = await inviteUserViaApi(restClient, { role: 'rep' });
  await restClient.post('/api/v1/users/set-password', { token: inviteToken, password: 'x' });
  registerUserDeactivation(testData, restClient, user.id, 'rep');
});
CASE

  write_case 'bad-wrapped-post.spec.ts' <<'CASE'
test('prettier wrapped the url onto its own line', async ({ restClient }) => {
  const res = await restClient.post<{ user: { id: string } }>(
    '/api/v1/users/invite',
    { name: 'X', role: 'rep' },
  );
  expect(res.status).toBe(201);
});
CASE

  write_case 'bad-mixed-same-line.spec.ts' <<'CASE'
test('self-registering helper must not exempt its line-mate', async ({ testData, restClient }) => {
  const u = await createTestUser(testData, restClient), c = await createContactViaApi(restClient);
  expect(u.id && c.id).toBeTruthy();
});
CASE

  write_case 'bad-opt-out-without-reason.spec.ts' <<'CASE'
test('bare marker does not count', async ({ restClient }) => {
  // MINCRM-686-ok
  const contact = await createContactViaApi(restClient, { first_name: 'A' });
  expect(contact.id).toBeTruthy();
});
CASE

  # Assert the exact number of findings, not just the exit status. An exit-only
  # check passes on an unscanned or empty TESTS_DIR — verified: pointing it at a
  # nonexistent directory prints OK and exits 0 — so every "should pass" case
  # would go green without the fixture ever being read. Both sibling guards
  # (check-locator-timeout-forwarding.mjs, check-settings-mutations.mjs) count
  # findings for this reason.
  # Captures BOTH the finding count and the exit status. A pipe would discard
  # the status, so a script that crashed before scanning would look identical to
  # one that found nothing — and every "should pass" case would go green on a
  # guard that never ran.
  run_case() {
    local case_dir="$self_test_dir/$1"
    local output status
    output="$(TESTS_DIR="$case_dir" bash "$0" 2>&1)" && status=0 || status=$?
    RUN_CASE_FINDINGS="$(printf '%s\n' "$output" | grep -cE '^    [0-9]+:' || true)"
    RUN_CASE_STATUS="$status"
  }

  self_test_failures=0
  ok_cases="ok-registered ok-invite-registered ok-raw-post-registered
    ok-self-registering ok-opted-out ok-comment-mentions-invite
    ok-register-immediate"
  bad_cases="bad-unregistered bad-invite-unregistered
    bad-raw-post-unregistered bad-wrapped-post bad-mixed-same-line
    bad-register-after-await bad-opt-out-without-reason"
  self_test_total=0

  for expected_pass in $ok_cases; do
    self_test_total=$((self_test_total + 1))
    if [ ! -f "$self_test_dir/${expected_pass}/${expected_pass}.spec.ts" ]; then
      echo "  FAIL  $expected_pass — fixture missing, so the case proves nothing"
      self_test_failures=$((self_test_failures + 1))
      continue
    fi
    run_case "$expected_pass"
    if [ "$RUN_CASE_FINDINGS" -eq 0 ] && [ "$RUN_CASE_STATUS" -eq 0 ]; then
      echo "  PASS  $expected_pass (0 findings, exit 0, as expected)"
    else
      echo "  FAIL  $expected_pass reported $RUN_CASE_FINDINGS finding(s)" \
        "and exit $RUN_CASE_STATUS; expected 0 and 0"
      self_test_failures=$((self_test_failures + 1))
    fi
  done

  for expected_fail in $bad_cases; do
    self_test_total=$((self_test_total + 1))
    if [ ! -f "$self_test_dir/${expected_fail}/${expected_fail}.spec.ts" ]; then
      echo "  FAIL  $expected_fail — fixture missing, so the case proves nothing"
      self_test_failures=$((self_test_failures + 1))
      continue
    fi
    run_case "$expected_fail"
    if [ "$RUN_CASE_FINDINGS" -eq 1 ] && [ "$RUN_CASE_STATUS" -eq 1 ]; then
      echo "  PASS  $expected_fail (1 finding, exit 1, as expected)"
    else
      echo "  FAIL  $expected_fail reported $RUN_CASE_FINDINGS finding(s)" \
        "and exit $RUN_CASE_STATUS; expected 1 and 1"
      self_test_failures=$((self_test_failures + 1))
    fi
  done

  if [ "$self_test_failures" -gt 0 ]; then
    echo "SELF-TEST FAIL: $self_test_failures case(s) behaved incorrectly."
    exit 1
  fi
  echo "SELF-TEST OK: all $self_test_total cases classified correctly."
  exit 0
fi

# Honour a caller-supplied TESTS_DIR (the self-test points it at a fixture
# tree); otherwise resolve it relative to this script.
#
# The caller-supplied path is validated too. resolve_tests_dir is the only place
# that checked, so skipping it made the guard FAIL OPEN: a bad path printed OK
# and exited 0, which for a guard is worse than not existing, because it is
# trusted. Same reasoning as the stale-data guard's fail-closed rule.
if [ -z "${TESTS_DIR:-}" ]; then
  resolve_tests_dir
elif [ ! -d "$TESTS_DIR" ]; then
  echo "tests directory not found: $TESTS_DIR"
  exit 1
fi

# How many lines after a create call may contain its registration. Registration
# is required "immediately after" creation so cleanup survives a mid-setup
# failure, but the create call itself is usually a multi-line object literal.
readonly REGISTRATION_WINDOW=12

# How many lines above a create call may carry its opt-out marker, so a
# multi-line justification can sit in a comment block above the call.
readonly OPT_OUT_LOOKBACK=3

# How many lines a register call's arguments may span below its opening line.
# registerAdminTeardown(testData, restClient, 'contact', c.id, `/path/${c.id}`)
# formats to six lines under this repo's printWidth, so the id argument sits
# well below the call name.
readonly REGISTER_ARG_SPAN=6

# convertLeadViaApi needs its own, larger window: it produces three entities and
# each registration may be `if`-guarded and wrapped, so all three can legitimately
# sit ~25 lines below the create (see leads.spec.ts's F9-V2).
readonly CONVERT_REGISTRATION_WINDOW=30

# User creation reaches the database by three routes, and until MINCRM-668 this
# script saw none of them: inviteUserViaApi does not match the create*ViaApi
# shape, and several iam/ specs POST the invite endpoint directly. That gap is
# what let four call sites deactivate outside any try/finally and leak a user on
# every failing run.
readonly CREATE_PATTERN='(create[A-Z][A-Za-z]*ViaApi|convertLeadViaApi|inviteUserViaApi)\(|['"'"'"`]/api/v1/users/invite['"'"'"`]'

# Helpers that register their own teardown internally, so their call sites need
# no adjacent register() line. These are the safe path — the whole point of
# MINCRM-668 was moving registration inside them — so requiring a registration
# the caller cannot see would push authors back to hand-rolled cleanup.
readonly SELF_REGISTERING_PATTERN='(createTestUser|createTestRep|createTestAdmin)\('

# Bindings that are not records and therefore cannot be registered. An invite
# returns `{ user, inviteToken }`; the token is a string, not a row. Requiring
# it to appear in a register() call would fail every correctly-registered site.
# Matched against the ORIGINAL destructured key (the `user` in `{ user: rep }`),
# because that is what names the thing, not the caller's local alias.
readonly NON_RECORD_BINDINGS_KEY='^(inviteToken|token|password)([[:space:]]*:.*)?$'
readonly REGISTER_PATTERN='(testData\.register|testData\.registerCustomTeardown|registerAdminTeardown|registerUserDeactivation)\('
readonly OPT_OUT_MARKER='MINCRM-686-ok'

# The opt-out marker must carry a reason. A bare `// MINCRM-686-ok` would make a
# deliberate exception indistinguishable from a silenced oversight, which is the
# distinction the marker exists to preserve.
readonly OPT_OUT_WITH_REASON="${OPT_OUT_MARKER}:[[:space:]]*[^[:space:]]"

FOUND=0
SCANNED=0

while IFS= read -r -d '' spec_file; do
  SCANNED=$((SCANNED + 1))
  file_violations=""

  while IFS=: read -r line_no line_text; do
    [ -z "$line_no" ] && continue

    # Skip the helper's own declaration — a spec-local `async function
    # createFooViaApi(...)` is a definition, not a call site. Registration
    # belongs at the call sites below it, which this loop reaches separately.
    if printf '%s' "$line_text" | grep -qE '(async +)?function +(create[A-Z][A-Za-z]*ViaApi|convertLeadViaApi)\('; then
      continue
    fi

    # Skip comment lines. The raw-POST alternation matches prose, and these
    # specs routinely name the invite endpoint in docblocks.
    if printf '%s' "$line_text" | grep -qE '^[[:space:]]*(//|\*|/\*)'; then
      continue
    fi

    # A self-registering helper cleans up internally, so its call needs no
    # adjacent register(). Blank the call rather than skipping the line: a line
    # holding BOTH a self-registering helper and another create would otherwise
    # exempt the second one too.
    line_text="$(printf '%s' "$line_text" | sed -E "s/${SELF_REGISTERING_PATTERN}//g")"
    if ! printf '%s' "$line_text" | grep -qE "$CREATE_PATTERN"; then
      continue
    fi

    window_end=$((line_no + REGISTRATION_WINDOW))

    # Never look past the end of the current test — a register() in the NEXT
    # test cannot clean up a record created in this one.
    next_test="$(awk -v s="$((line_no + 1))" 'NR >= s && /^[[:space:]]*(test|test\.describe)\(/ { print NR; exit }' "$spec_file")"
    if [ -n "$next_test" ] && [ "$next_test" -le "$window_end" ]; then
      window_end=$((next_test - 1))
    fi

    # The opt-out marker may sit on the create line, just after it, or in a
    # comment block immediately above it — a multi-line reason reads better
    # above the call than trailing it, so look both ways.
    # The marker must annotate THIS create: either trailing on its own line, or
    # in the contiguous comment block directly above it with no intervening
    # non-comment line. Scanning a fixed range instead would let one marker
    # silence every create within it — a spec could opt out an AI session and
    # silently leak the contact and deal created two lines below.
    marker_found=0
    if sed -n "${line_no}p" "$spec_file" | grep -qE "$OPT_OUT_WITH_REASON"; then
      marker_found=1
    else
      probe=$((line_no - 1))
      while [ "$probe" -ge 1 ] && [ $((line_no - probe)) -le "$OPT_OUT_LOOKBACK" ]; do
        probe_line="$(sed -n "${probe}p" "$spec_file")"
        # Stop at the first line that is not a comment — the block has ended.
        printf '%s' "$probe_line" | grep -qE '^[[:space:]]*(//|\*|/\*)' || break
        if printf '%s' "$probe_line" | grep -qE "$OPT_OUT_WITH_REASON"; then
          marker_found=1
          break
        fi
        probe=$((probe - 1))
      done
    fi
    [ "$marker_found" -eq 1 ] && continue

    # Bind the registration to the identifier this call assigned to, so a
    # register() for a DIFFERENT entity cannot satisfy this one. Without this,
    # a spec that creates a contact and a team and registers only the team
    # passes — which is exactly owner-filter.spec.ts, the case MINCRM-686 was
    # filed against. A positional window alone cannot express "this record is
    # registered".
    # convertLeadViaApi creates THREE entities (contact, account, deal) from one
    # call, so no single binding name can express whether all three were
    # registered — and the two real call sites use different binding forms
    # (destructured, and a single `conversion` object). Require all three id
    # fields to appear in the window's register statements, whichever form is
    # used. Registering the contact and deal but not the account is a real leak
    # that the binding check alone cannot see.
    if printf '%s' "$line_text" | grep -q 'convertLeadViaApi('; then
      # Three registrations, each of which may be guarded by an `if (...)` and
      # wrapped across several lines, need far more room than a single create.
      convert_end=$((line_no + CONVERT_REGISTRATION_WINDOW))
      # Restricted to register statements for the same reason as the
      # single-entity path below: searching the whole window would let a bare
      # `expect(conversion.account_id).toBeDefined()` satisfy the guard while
      # the account leaks. convertLeadViaApi creates three records per call, so
      # this is the highest-leakage shape in the suite.
      convert_window="$(sed -n "${line_no},${convert_end}p" "$spec_file" | tail -n +2 |
        grep -vE '^[[:space:]]*(//|\*|/\*)' |
        grep -A "$REGISTER_ARG_SPAN" -E "$REGISTER_PATTERN" || true)"
      missing_ids=""
      for id_field in contact_id account_id deal_id; do
        if ! printf '%s' "$convert_window" | grep -qE "[^A-Za-z0-9_\$]${id_field}[^A-Za-z0-9_\$]"; then
          missing_ids="${missing_ids} ${id_field}"
        fi
      done
      if [ -z "$missing_ids" ]; then
        continue
      fi
      file_violations+="$(sed -n "${line_no}p" "$spec_file" | sed "s/^/    ${line_no}: /")"$'\n'
      file_violations+="        (unregistered from this conversion:${missing_ids})"$'\n'
      continue
    fi

    # Names this call binds. Two forms occur:
    #   const contact = await createContactViaApi(...)          -> "contact"
    #   const { contact_id, deal_id } = await convertLeadViaApi -> "contact_id deal_id"
    # A destructuring create must have EVERY name it binds registered.
    # `{ user: managerUser }` renames the binding; only the LOCAL name
    # (managerUser) exists in scope, so collapse `outer: local` to `local`
    # before splitting, or the two halves split into separate bogus tokens.
    bindings="$(printf '%s' "$line_text" |
      sed -nE 's/^[[:space:]]*(const|let|var)[[:space:]]+\{([^}]*)\}[[:space:]]*=.*/\2/p' |
      tr ',' '\n' |
      sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' |
      { grep -vE "$NON_RECORD_BINDINGS_KEY" || true; } |
      sed -E 's/^[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*:[[:space:]]*//' |
      tr '\n' ' ')"
    if [ -z "$bindings" ]; then
      bindings="$(printf '%s' "$line_text" | sed -nE 's/^[[:space:]]*(const|let|var)[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=.*/\2/p')"
    fi

    # A create whose result is discarded (`await createNoteViaApi(...)`) binds no
    # name, so nothing can register it — only the opt-out marker above clears it.
    if [ -n "$bindings" ]; then
      window_text="$(sed -n "${line_no},${window_end}p" "$spec_file")"

      # ORDERING, not just presence. The header promises registration happens
      # "immediately after" creation so cleanup survives a mid-setup failure —
      # but a window check alone accepts `create → await something → register`,
      # which is exactly the shape MINCRM-668 removed from createTestRep,
      # createTestAdmin and five visibility.spec.ts sites. If an `await` sits
      # between the create statement and the registration, the row exists while
      # that call can throw, and nothing would clean it up.
      #
      # The create statement itself usually spans several lines (a multi-line
      # object literal), so the scan starts after its closing `});` rather than
      # at the create line.
      # End of the create STATEMENT: the first line at or after the create that
      # closes it with `);` or `});`. Bounded by the registration line so the
      # test function's own closing brace further down cannot be mistaken for it.
      create_end="$(printf '%s' "$window_text" |
        { grep -nE '\)\s*;\s*$' || true; } | head -1 | cut -d: -f1)"
      [ -z "$create_end" ] && create_end=1
      register_offset="$(printf '%s' "$window_text" | { grep -nE "$REGISTER_PATTERN" || true; } | head -1 | cut -d: -f1)"

      if [ -n "$register_offset" ] && [ "$register_offset" -gt "$create_end" ]; then
        between="$(printf '%s' "$window_text" |
          sed -n "$((create_end + 1)),$((register_offset - 1))p" |
          grep -vE '^\s*(//|\*|/\*)' |
          grep -E '\bawait\b' || true)"
        if [ -n "$between" ]; then
          first_await="$(printf '%s' "$between" | head -1 | sed -E 's/^[[:space:]]+//')"
          file_violations="${file_violations}    ${line_no}: registration is not immediate — \`${first_await}\` can throw first
"
          continue
        fi
      fi

      # ONLY the text of register statements — from each REGISTER_PATTERN match
      # through the following few lines that carry its arguments. A register call
      # spans several lines (`registerAdminTeardown(` then its arguments), so the
      # binding name is usually not on the matched line itself.
      #
      # Restricting to these lines is load-bearing. Searching the whole window
      # would let ANY use of the created entity satisfy the guard — including
      # `createDealViaApi(restClient, { account_id: account.id })`, which is the
      # dominant shape in this suite, so a leaked parent would pass while its
      # child was registered.
      # Each register STATEMENT, from its opening call to the line closing it —
      # not a fixed number of following lines. A fixed span bleeds past the
      # statement, so the next line of the test (`expect(acct.id)...`, or a
      # subsequent create taking `acct.id` as an argument) lands inside the
      # window and satisfies a binding that was never registered.
      #
      # Commented-out lines are stripped first: a `// testData.register(...)`
      # left behind during debugging would otherwise satisfy the check while
      # registering nothing.
      #
      # Template literals are blanked too — the delete PATH is a template
      # literal, and a nested path like `/api/v1/accounts/${account.id}/deals/...`
      # would otherwise let a leaked PARENT satisfy the guard through its child's
      # registration.
      #
      # Quoted strings are then blanked, so the entity-type label cannot stand in
      # for a binding name — `testData.register('contact', deal.id, ...)` must
      # not satisfy a leaked binding that happens to be called `contact`.
      register_lines="$(printf '%s' "$window_text" | tail -n +2 |
        grep -vE '^[[:space:]]*(//|\*|/\*)' |
        awk '
          index($0, "testData.register(") || index($0, "testData.registerCustomTeardown(") ||
            index($0, "registerAdminTeardown(") || index($0, "registerUserDeactivation(") { inside = 1 }
          inside { print }
          inside && /\);[[:space:]]*$/ { inside = 0 }
        ' |
        sed -E "s/'[^']*'/''/g; s/\"[^\"]*\"/\"\"/g; s/\`[^\`]*\`/\`\`/g" || true)"

      if [ -n "$register_lines" ]; then
        all_registered=1
        for name in $bindings; do
          [ -z "$name" ] && continue

          # Direct: the register call names the binding.
          if printf '%s' "$register_lines" |
            grep -qE "[^A-Za-z0-9_\$]${name}[^A-Za-z0-9_\$]"; then
            continue
          fi

          # Via a destructure: `const { user } = inviteRes.body` then
          # register(user.id). The invite endpoints return an envelope, so the
          # thing that gets registered is a field of the create's binding rather
          # than the binding itself.
          destructured="$(printf '%s' "$window_text" |
            sed -nE "s/^[[:space:]]*(const|let|var)[[:space:]]+\{([^}]*)\}[[:space:]]*=[[:space:]]*${name}(\.[A-Za-z0-9_\$]+)*[[:space:]]*;.*/\2/p" |
            tr ',' ' ' | sed -E 's/[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*:[[:space:]]*//g')"
          destructure_registered=0
          for field in $destructured; do
            if printf '%s' "$register_lines" |
              grep -qE "[^A-Za-z0-9_\$]${field}[^A-Za-z0-9_\$]"; then
              destructure_registered=1
              break
            fi
          done
          if [ "$destructure_registered" -eq 1 ]; then
            continue
          fi

          # Via one alias: `const leadId = created.id` then register(leadId).
          # `const|let|var` is optional: a test that declared the variable
          # earlier (`let repId: string | null = null`) assigns bare.
          # ALL aliases, not just the first. A create's id is often assigned
          # more than once (`logged = user.email` above `const id = user.id`),
          # and taking only the first produced a false positive on a correctly
          # registered site.
          aliases="$(printf '%s' "$window_text" | sed -nE "s/^[[:space:]]*((const|let|var)[[:space:]]+)?([A-Za-z_\$][A-Za-z0-9_\$]*)[[:space:]]*=[[:space:]]*${name}\..*/\3/p")"
          alias_registered=0
          for alias in $aliases; do
            if printf '%s' "$register_lines" |
              grep -qE "[^A-Za-z0-9_\$]${alias}[^A-Za-z0-9_\$]"; then
              alias_registered=1
              break
            fi
          done
          if [ "$alias_registered" -eq 1 ]; then
            continue
          fi

          all_registered=0
          break
        done
        [ "$all_registered" -eq 1 ] && continue
      fi
    fi

    file_violations+="$(sed -n "${line_no}p" "$spec_file" | sed "s/^/    ${line_no}: /")"$'\n'
  done < <(grep -nE "$CREATE_PATTERN" "$spec_file" || true)

  if [ -n "$file_violations" ]; then
    echo "ERROR: $spec_file creates records that are never registered for teardown."
    echo "  Unregistered create call(s):"
    printf '%s' "$file_violations"
    echo "  Fix: register immediately after creation, e.g."
    echo "    testData.register('contact', c.id, \`/api/v1/contacts/\${c.id}\`);"
    echo "  If the client may not be an admin at teardown, use registerAdminTeardown()."
    echo "  Deliberate exceptions opt out with a // ${OPT_OUT_MARKER}: <reason> marker."
    echo "  See MINCRM-686 and docs/dev/e2e-authoring.md for guidance."
    echo ""
    FOUND=1
  fi
done < <(find_spec_files)

if [ "$FOUND" -eq 1 ]; then
  echo "FAIL: one or more specs create records with no teardown registration."
  echo "See MINCRM-686 for the required pattern."
  exit 1
fi

# Scanning nothing is not a pass. An empty or wrong TESTS_DIR would otherwise
# report OK, which is the fail-open shape this guard exists to prevent.
if [ "$SCANNED" -eq 0 ]; then
  echo "FAIL: no spec files found under $TESTS_DIR — nothing was checked."
  exit 1
fi

echo "OK: every create*ViaApi call site registers its record for teardown."
