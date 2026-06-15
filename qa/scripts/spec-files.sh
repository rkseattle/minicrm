#!/usr/bin/env bash
# ===========================================================================
# spec-files.sh — shared file-discovery helpers for QA lint scripts
#
# Source this file and call find_spec_files.
# Expects the caller to set TESTS_DIR before sourcing, or call
# resolve_tests_dir first.
#
# Usage:
#   source "$(dirname "$0")/spec-files.sh"
#   resolve_tests_dir      # sets TESTS_DIR relative to this script's parent
#   while IFS= read -r -d '' spec_file; do
#     ...
#   done < <(find_spec_files)
# ===========================================================================

# resolve_tests_dir — sets TESTS_DIR to qa/e2e/tests relative to the
# directory that contains the calling script.
resolve_tests_dir() {
  TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[1]}")/.." && pwd)/e2e/tests"
  if [ ! -d "$TESTS_DIR" ]; then
    echo "tests directory not found: $TESTS_DIR"
    exit 1
  fi
}

# find_spec_files — prints all *.spec.ts paths under $TESTS_DIR,
# NUL-delimited (suitable for `while IFS= read -r -d '' spec_file`).
find_spec_files() {
  find "$TESTS_DIR" -name "*.spec.ts" -print0
}
