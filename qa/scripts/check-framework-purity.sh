#!/usr/bin/env bash
# MINCRM-123: CI lint step — fail if qa/e2e/framework/ contains any
# application-domain strings. Framework code must be product-agnostic.
#
# Add known app-domain terms to the FORBIDDEN list as the codebase grows.

set -euo pipefail

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/framework"

FORBIDDEN=(
  "minicrm"
  "MiniCRM"
  "contact"
  "account"
  "deal"
  "activity"
  "pipeline"
  "Prospecting"
  "Qualification"
  "Proposal"
  "Negotiation"
  "Closed Won"
  "Closed Lost"
)

if [ ! -d "$FRAMEWORK_DIR" ]; then
  echo "framework directory not found: $FRAMEWORK_DIR"
  exit 1
fi

FOUND=0
for term in "${FORBIDDEN[@]}"; do
  # grep -r exits 0 if matches found, 1 if none — we want failure on match
  if grep -rn --include="*.ts" "$term" "$FRAMEWORK_DIR" 2>/dev/null; then
    echo "ERROR: application-domain string '$term' found in framework/"
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "FAIL: framework/ contains application-domain references."
  echo "Move app-specific code to pages/, behaviors/, or apps/ instead."
  exit 1
fi

echo "OK: framework/ is free of application-domain strings."
