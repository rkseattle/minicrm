#!/usr/bin/env bash
# =============================================================================
# check-token-refresh-parity.sh (MINCRM-703)
#
# Asserts that the QA suite's assumed session-token lifetime matches the one the
# server actually issues.
#
# WHAT BREAKS SILENTLY WITHOUT THIS
# ---------------------------------
# Two consumers outside the server compute their own refresh schedule from an
# assumed token lifetime. Both break the same way if the server's window moves
# and theirs does not — they wait too long, refresh after the token is already
# dead, and every request from then on fails as unauthorized:
#
#   * The E2E suite. This is how the coverage-dump ingest step failed: a
#     ~1000-iteration loop crossed the 30-minute window mid-run and reported a
#     partial map.
#   * The browser client, which is worse — REAL USERS get logged out
#     mid-session with ?reason=session_expired, not just a batch script.
#
# In both cases the failure reads as a permissions or infrastructure problem
# rather than a token lifetime that moved, which is what makes it expensive to
# diagnose.
#
# WHY A GREP AND NOT AN IMPORT
# ----------------------------
# The three server-side copies this originally guarded were consolidated into
# server/src/auth/sessionCookie.ts, because they lived in one workspace and had
# no reason to be separate. The remaining copies genuinely cannot be: qa/ must
# not import server modules at runtime (they pull in a pg.Pool and dotenv), and
# the browser bundle must not either. A source-level check is the only thing
# that can pin all three together.
#
# WHY VALUES, NOT SOURCE TEXT
# ---------------------------
# Unlike check-sha-pattern-parity.sh, which pins a regex where the characters
# themselves are the rule, both sides here are arithmetic. Comparing text would
# fail on `60 * 30` versus `30 * 60` — identical policy, different spelling —
# and catches nothing a value comparison misses. So each expression is extracted
# and evaluated.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Each entry: <file>::<constant name>::<divisor to normalize to seconds>
#
# The browser client states the same window in milliseconds, so it is divided
# by 1000 before comparison — the units differ, the policy must not.
DEFINITIONS=(
  "server/src/auth/sessionCookie.ts::JWT_IDLE_EXPIRY_SECONDS::1"
  "qa/e2e/framework/auth/token-expiry.ts::EXPECTED_TOKEN_LIFETIME_SECONDS::1"
  "client/src/hooks/useSessionRefresh.ts::IDLE_EXPIRY_MS::1000"
)

failed=0
canonical=""
canonical_source=""

for entry in "${DEFINITIONS[@]}"; do
  file="${entry%%::*}"          # before the first ::
  divisor="${entry##*::}"       # after the last ::
  name="${entry#*::}"           # strip file
  name="${name%%::*}"           # strip divisor
  path="${REPO_ROOT}/${file}"

  if [[ ! -f "$path" ]]; then
    echo "ERROR: ${file} does not exist — update DEFINITIONS in $(basename "$0")."
    failed=1
    continue
  fi

  # Anchored to the start of the line so a mention inside a docblock cannot be
  # picked up instead: both files carry long comments that name the constant.
  # `--text` so a file with an unexpected byte reports its content rather than
  # "Binary file matches", which would compare as equal to nothing.
  # `|| true` is load-bearing under `set -euo pipefail`: when grep finds no
  # match it exits 1, pipefail propagates that, and set -e would abort the
  # script HERE — before the diagnostic below ever runs. The guard would then
  # exit non-zero with an empty log on the most likely real trigger, a rename,
  # turning an actionable message into a silent failure.
  expression="$(grep --text -E "^[[:space:]]*(export )?const ${name} = " "$path" | head -1 | sed -E 's/^[^=]*= *//; s/;[[:space:]]*$//' || true)"

  if [[ -z "$expression" ]]; then
    echo "ERROR: could not find '${name}' in ${file}"
    failed=1
    continue
  fi

  # Reject anything that is not plain integer arithmetic before evaluating it,
  # so this never executes whatever a future edit puts on that line.
  if [[ ! "$expression" =~ ^[0-9*+\ ()-]+$ ]]; then
    echo "ERROR: '${name}' in ${file} is not a plain arithmetic expression: ${expression}"
    echo "       This guard evaluates the value; keep the declaration arithmetic."
    failed=1
    continue
  fi

  value=$(( (expression) / divisor ))

  if [[ -z "$canonical" ]]; then
    canonical="$value"
    canonical_source="$file"
  elif [[ "$value" != "$canonical" ]]; then
    echo "ERROR: the session-token lifetime has drifted."
    echo "  ${canonical_source}:"
    echo "    ${canonical} seconds"
    echo "  ${file}:"
    echo "    ${value} seconds"
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  echo
  echo "FAIL: every consumer's assumed token lifetime must match the server's."
  echo "A mismatch makes that consumer refresh its session too late (or never),"
  echo "after which every authenticated request fails as unauthorized — a failure"
  echo "that reads as a permissions bug rather than an expired session. On the"
  echo "browser client that logs real users out mid-session, not just a script."
  echo "See this script's header for why these cannot simply share a constant."
  exit 1
fi

echo "PASS: session-token lifetime is identical across all ${#DEFINITIONS[@]} definitions (${canonical}s)."
