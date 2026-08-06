#!/usr/bin/env bash
# =============================================================================
# check-coverage-map-exit-code-parity.sh (MINCRM-703)
#
# Asserts that the pre-push hook's idea of "the committed coverage map is
# corrupt" matches the exit code load-coverage-map.ts actually uses for it.
#
# WHAT BREAKS SILENTLY WITHOUT THIS
# ---------------------------------
# The loader distinguishes two failures that must be handled differently:
#
#   * infrastructure (database unreachable, missing credentials) — best-effort,
#     the push continues, because a developer's local stack being down is not a
#     defect in anything shared; and
#   * a corrupt or truncated committed map — blocking, because that artifact is
#     broken for everyone, and continuing means selecting tests from data
#     nobody noticed was unusable.
#
# The pre-push hook tells them apart by exit code alone. If the loader's code
# changes and the hook's copy does not, every corrupt map is silently reclassed
# as an infrastructure blip and the push proceeds — restoring exactly the
# swallow this ticket removed, at the one point where a human could still have
# acted on it.
#
# WHY A GREP AND NOT AN IMPORT
# ----------------------------
# The hook lives in root scripts/ and importing the loader for one integer
# would pull in a pg.Pool at module load, on a path that runs before every
# push. A source-level check is the only thing that can pin the two together
# without that cost.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Each entry: <file>::<constant name>
DEFINITIONS=(
  "server/src/scripts/load-coverage-map.ts::EXIT_MAP_UNREADABLE"
  "scripts/pre-push-tia.ts::EXIT_MAP_UNREADABLE"
)

failed=0
canonical=""
canonical_source=""

for entry in "${DEFINITIONS[@]}"; do
  file="${entry%%::*}"
  name="${entry##*::}"
  path="${REPO_ROOT}/${file}"

  if [[ ! -f "$path" ]]; then
    echo "ERROR: ${file} does not exist — update DEFINITIONS in $(basename "$0")."
    failed=1
    continue
  fi

  # `|| true` is load-bearing under `set -euo pipefail`: a non-matching grep
  # exits 1, pipefail propagates it, and set -e would abort the script here —
  # before the diagnostic below could name the constant that went missing,
  # which is the likeliest real trigger (a rename).
  value="$(grep --text -E "^[[:space:]]*(export )?const ${name} = " "$path" | head -1 | sed -E 's/^[^=]*= *//; s/;[[:space:]]*$//' || true)"

  if [[ -z "$value" ]]; then
    echo "ERROR: could not find '${name}' in ${file}"
    failed=1
    continue
  fi

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "ERROR: '${name}' in ${file} is not a plain integer: ${value}"
    failed=1
    continue
  fi

  if [[ -z "$canonical" ]]; then
    canonical="$value"
    canonical_source="$file"
  elif [[ "$value" != "$canonical" ]]; then
    echo "ERROR: the corrupt-map exit code has drifted."
    echo "  ${canonical_source}: ${canonical}"
    echo "  ${file}: ${value}"
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  echo
  echo "FAIL: the pre-push hook and the loader must agree on the exit code that"
  echo "means 'the committed coverage map is corrupt'. A mismatch makes the hook"
  echo "treat a broken shared artifact as a local infrastructure blip and push"
  echo "anyway, having selected tests from data it never reported as unusable."
  echo "See this script's header for why these cannot simply share a constant."
  exit 1
fi

echo "PASS: corrupt-map exit code is identical across all ${#DEFINITIONS[@]} definitions (${canonical})."
