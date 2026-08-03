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
#   - inviteUserViaApi creates users and is deliberately outside CREATE_PATTERN,
#     because users are deactivated rather than deleted and TestDataManager
#     tears down via DELETE. Note MINCRM-544 — the incident this family of
#     guards exists to prevent — was caused by accumulated test USERS, so the
#     one path with the worst history is the one this script cannot see.
#     createTestRep/createTestAdmin register a deactivation callback; bare
#     inviteUserViaApi call sites are on their callers.
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
# another user's record gets a 403 that TestDataManager logs and swallows, so
# the record leaks while the run still reports success.
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
resolve_tests_dir

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

readonly CREATE_PATTERN='(create[A-Z][A-Za-z]*ViaApi|convertLeadViaApi)\('
readonly REGISTER_PATTERN='(testData\.register|testData\.registerCustomTeardown|registerAdminTeardown)\('
readonly OPT_OUT_MARKER='MINCRM-686-ok'

# The opt-out marker must carry a reason. A bare `// MINCRM-686-ok` would make a
# deliberate exception indistinguishable from a silenced oversight, which is the
# distinction the marker exists to preserve.
readonly OPT_OUT_WITH_REASON="${OPT_OUT_MARKER}:[[:space:]]*[^[:space:]]"

FOUND=0

while IFS= read -r -d '' spec_file; do
  file_violations=""

  while IFS=: read -r line_no line_text; do
    [ -z "$line_no" ] && continue

    # Skip the helper's own declaration — a spec-local `async function
    # createFooViaApi(...)` is a definition, not a call site. Registration
    # belongs at the call sites below it, which this loop reaches separately.
    if printf '%s' "$line_text" | grep -qE '(async +)?function +(create[A-Z][A-Za-z]*ViaApi|convertLeadViaApi)\('; then
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
    bindings="$(printf '%s' "$line_text" | sed -nE 's/^[[:space:]]*(const|let|var)[[:space:]]+\{([^}]*)\}[[:space:]]*=.*/\2/p' | tr ',' ' ')"
    if [ -z "$bindings" ]; then
      bindings="$(printf '%s' "$line_text" | sed -nE 's/^[[:space:]]*(const|let|var)[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=.*/\2/p')"
    fi

    # A create whose result is discarded (`await createNoteViaApi(...)`) binds no
    # name, so nothing can register it — only the opt-out marker above clears it.
    if [ -n "$bindings" ]; then
      window_text="$(sed -n "${line_no},${window_end}p" "$spec_file")"

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
      # Quoted strings are then blanked, so the entity-type label cannot stand in
      # for a binding name — `testData.register('contact', deal.id, ...)` must
      # not satisfy a leaked binding that happens to be called `contact`.
      register_lines="$(printf '%s' "$window_text" | tail -n +2 |
        grep -vE '^[[:space:]]*(//|\*|/\*)' |
        awk '
          index($0, "testData.register(") || index($0, "testData.registerCustomTeardown(") ||
            index($0, "registerAdminTeardown(") { inside = 1 }
          inside { print }
          inside && /\);[[:space:]]*$/ { inside = 0 }
        ' |
        sed -E "s/'[^']*'/''/g; s/\"[^\"]*\"/\"\"/g" || true)"

      if [ -n "$register_lines" ]; then
        all_registered=1
        for name in $bindings; do
          [ -z "$name" ] && continue

          # Direct: the register call names the binding.
          if printf '%s' "$register_lines" |
            grep -qE "[^A-Za-z0-9_\$]${name}[^A-Za-z0-9_\$]"; then
            continue
          fi

          # Via one alias: `const leadId = created.id` then register(leadId).
          alias="$(printf '%s' "$window_text" | sed -nE "s/^[[:space:]]*(const|let|var)[[:space:]]+([A-Za-z_\$][A-Za-z0-9_\$]*)[[:space:]]*=[[:space:]]*${name}\..*/\2/p" | head -1)"
          if [ -n "$alias" ] && printf '%s' "$register_lines" |
            grep -qE "[^A-Za-z0-9_\$]${alias}[^A-Za-z0-9_\$]"; then
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

echo "OK: every create*ViaApi call site registers its record for teardown."
