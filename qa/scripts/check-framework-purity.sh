#!/usr/bin/env bash
# ===========================================================================
# check-framework-purity.sh  (MINCRM-123, MINCRM-213, MINCRM-232)
#
# CI lint step — fail if qa/e2e/framework/ contains application-domain strings.
# Framework code must be product-agnostic so it can be adopted by other projects
# without modification.
#
# WHAT THIS CHECKS
# ----------------
# The FORBIDDEN array below lists known-bad strings grouped by contamination
# category.  Each group has a comment explaining what it catches and why.
# Currently guarded categories:
#   1. MiniCRM brand names           — "minicrm", "MiniCRM"
#   2. CRM pipeline stage names      — "Prospecting", "Qualification", …
#   3. MiniCRM API route paths       — /api/contacts, /api/deals, …
#   4. CRM i18n namespace prefixes   — contacts., accounts., deals., …
#      (dot-anchored; matches "contacts.save" but not the standalone word)
#   5. CRM-specific test data fields — first_name, last_name, company_name, …
#
# KNOWN LIMITATIONS
# -----------------
# This is a reactive allowlist: it catches known-bad strings but CANNOT catch
# unknown-bad strings.  If a developer introduces a new CRM concept (e.g. a
# new entity like "Opportunity") and adds code that references it in framework/,
# this check will not detect it until the string is explicitly added here.
# The check is valuable for preventing known contamination patterns from
# silently re-entering the codebase as the project grows.
#
# EXCLUSIONS
# ----------
# - i18n/locale.ts  is excluded from the i18n-namespace-prefix check because
#   it IS the locale lookup table — it legitimately defines keys like
#   "contacts.save" as strings in a data structure, not as code references.
#   All other framework files must still avoid these patterns.
#
# HOW TO ADD NEW PATTERNS
# -----------------------
# 1. Identify the app-domain string that should not appear in framework code.
# 2. Add it to the FORBIDDEN array below under the appropriate group comment.
#    Use regex syntax if needed — the string is passed to grep -E.
# 3. If the pattern could match legitimate framework content (e.g. a locale
#    map), add a targeted --exclude or --exclude-dir flag to the grep call for
#    that pattern group and document the exclusion above.
# 4. Run this script locally against the current framework/ tree to confirm
#    zero false positives before committing.
# ===========================================================================

set -euo pipefail

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/framework"

FORBIDDEN=(
  # -------------------------------------------------------------------------
  # 1. MiniCRM brand names and ticket references — these should never appear
  #    in product-agnostic code. MINCRM- catches any Jira ticket reference
  #    (e.g. MINCRM-126, MINCRM-213).
  # -------------------------------------------------------------------------
  "minicrm"
  "MiniCRM"
  "MINCRM-"

  # -------------------------------------------------------------------------
  # 2. CRM pipeline stage names — hardcoded stage strings belong in app helpers
  #    or shared schemas, not in the framework layer.
  # -------------------------------------------------------------------------
  "Prospecting"
  "Qualification"
  "Proposal"
  "Negotiation"
  "Closed Won"
  "Closed Lost"

  # -------------------------------------------------------------------------
  # 3. MiniCRM API route paths — these are application-specific REST endpoints.
  #    Generic framework code should never reference a concrete API route;
  #    callers pass paths as arguments.
  # -------------------------------------------------------------------------
  "/api/contacts"
  "/api/accounts"
  "/api/deals"
  "/api/leads"
  "/api/activities"
  "/api/reports"
  "/api/settings"
  "/api/automation"

  # -------------------------------------------------------------------------
  # 4. CRM i18n namespace prefixes — dot-anchored so "contacts\." matches
  #    "contacts.save" but not the standalone word "contacts" in prose or
  #    variable names.  Violations indicate a framework file is coupling to
  #    application-specific translation keys.
  #    NOTE: i18n/locale.ts is excluded from this check (see header comments).
  # -------------------------------------------------------------------------
  "contacts\."
  "accounts\."
  "deals\."
  "leads\."
  "activities\."
  "tags\."
  "pipeline\."

  # -------------------------------------------------------------------------
  # 5. CRM-specific test data field names — these belong in app helpers
  #    (e.g. apps/minicrm/helpers.ts), not in framework infrastructure.
  #    Presence in framework code implies the framework is coupled to a specific
  #    data model.
  # -------------------------------------------------------------------------
  "first_name"
  "last_name"
  "company_name"
  "deal_value"
  "pipeline_stage"

)

if [ ! -d "$FRAMEWORK_DIR" ]; then
  echo "framework directory not found: $FRAMEWORK_DIR"
  exit 1
fi

FOUND=0

for term in "${FORBIDDEN[@]}"; do
  # i18n namespace prefixes (group 4) are dot-anchored extended-regex patterns.
  # locale.ts is the locale lookup table and legitimately contains these keys as
  # data — exclude it; all other framework files must not reference them.
  # All other forbidden terms are plain-string checked across all .ts files.
  if [[ "$term" =~ \\\. ]]; then
    # Dot-anchored i18n prefix — use -E (extended regex) and exclude locale.ts.
    if grep -rn -E --include="*.ts" \
        --exclude="locale.ts" \
        "$term" "$FRAMEWORK_DIR" 2>/dev/null; then
      echo "ERROR: CRM i18n namespace prefix '$term' found in framework/ (outside locale.ts)"
      FOUND=1
    fi
  else
    # Plain-string match across all .ts files in framework/.
    if grep -rn --include="*.ts" "$term" "$FRAMEWORK_DIR" 2>/dev/null; then
      echo "ERROR: application-domain string '$term' found in framework/"
      FOUND=1
    fi
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "FAIL: framework/ contains application-domain references."
  echo "Move app-specific code to pages/, behaviors/, or apps/ instead."
  exit 1
fi

echo "OK: framework/ is free of application-domain strings."
