#!/usr/bin/env bash
# MINCRM-204: CI lint step — fail if qa/e2e/pages/ or qa/e2e/behaviors/ contain
# direct Playwright element-locator or action calls that bypass the self-healing
# framework.
#
# ALL element lookups must go through:
#   healPage.locate([...]).resolve(testName)   — for locating
#   healPage.click([...])                       — for clicking
#   healPage.fill(value, [...])                 — for filling
#
# The following raw page.* calls are ALLOWED because they are navigation or
# browser-state primitives that have no healing equivalent:
#   page.goto()             — URL navigation
#   page.url()              — read current URL
#   page.waitForURL()       — wait for URL pattern
#   page.waitForLoadState() — wait for network/DOM state
#   page.waitForTimeout()   — explicit sleep (rare but permitted)
#   page.reload()           — full page reload
#   page.goBack()           — browser history back
#   page.goForward()        — browser history forward
#   page.keyboard.*         — keyboard input (no locator equivalent)
#   page.mouse.*            — pointer input (no locator equivalent)
#   page.title()            — read document title
#   page.context()          — access browser context
#   page.viewportSize()     — read viewport dimensions
#   page.evaluate()         — run JS in browser (no locator equivalent)
#
# The following raw page.* calls are FORBIDDEN because they locate elements
# or perform actions on elements without going through the healing framework:
#   page.getByTestId / getByRole / getByLabel / getByText / getByPlaceholder
#   page.getByAltText / getByTitle
#   page.locator()
#   page.waitForSelector()
#   page.click / fill / type / check / uncheck / selectOption
#   page.hover / focus / tap / dispatchEvent
#   page.innerHTML / innerText / inputValue / textContent / getAttribute
#   page.isVisible / isEnabled / isChecked / isDisabled / isEditable / isHidden
#
# Note: page.locator() INSIDE the framework's buildLocator() is intentional and
# lives under qa/e2e/framework/ — that directory is excluded from this check.

set -euo pipefail

PAGES_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/pages"
BEHAVIORS_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/behaviors"

# Forbidden fixed strings — each is a method call that bypasses the framework.
# Using fixed-string matching avoids regex portability issues across grep variants.
FORBIDDEN=(
  "page.getByTestId("
  "page.getByRole("
  "page.getByLabel("
  "page.getByText("
  "page.getByPlaceholder("
  "page.getByAltText("
  "page.getByTitle("
  "page.locator("
  "page.waitForSelector("
  "page.click("
  "page.fill("
  "page.type("
  "page.check("
  "page.uncheck("
  "page.selectOption("
  "page.hover("
  "page.focus("
  "page.tap("
  "page.dispatchEvent("
  "page.innerHTML("
  "page.innerText("
  "page.inputValue("
  "page.textContent("
  "page.getAttribute("
  "page.isVisible("
  "page.isEnabled("
  "page.isChecked("
  "page.isDisabled("
  "page.isEditable("
  "page.isHidden("
)

found_violations=0

check_dir() {
  local dir="$1"
  local label="$2"

  if [ ! -d "$dir" ]; then
    echo "WARNING: $label directory not found: $dir"
    return 0
  fi

  local dir_violations=0

  while IFS= read -r -d '' file; do
    local lineno=0
    while IFS= read -r line; do
      lineno=$((lineno + 1))

      # Skip blank lines.
      [ -z "${line// }" ] && continue

      # Skip lines that are entirely single-line comments.
      trimmed="${line#"${line%%[! ]*}"}"  # ltrim
      [[ "$trimmed" == //* ]] && continue

      # Skip lines that are JSDoc comment lines (* ...).
      [[ "$trimmed" == \** ]] && continue

      for forbidden in "${FORBIDDEN[@]}"; do
        if [[ "$line" == *"$forbidden"* ]]; then
          echo "  $file:$lineno: $forbidden"
          echo "    $line"
          dir_violations=1
          found_violations=1
        fi
      done
    done < "$file"
  done < <(find "$dir" -name "*.ts" -print0)

  return "$dir_violations"
}

echo "Checking pages/ and behaviors/ for raw Playwright element calls..."
echo ""

pages_ok=0
behaviors_ok=0

if ! check_dir "$PAGES_DIR" "pages/"; then
  echo ""
  echo "Violations found in pages/"
  pages_ok=1
fi

if ! check_dir "$BEHAVIORS_DIR" "behaviors/"; then
  echo ""
  echo "Violations found in behaviors/"
  behaviors_ok=1
fi

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "FAIL: pages/ or behaviors/ contains raw Playwright element calls."
  echo "All element lookups must go through healPage.locate([...]).resolve()"
  echo "or healPage.click() / healPage.fill()."
  exit 1
fi

echo "OK: pages/ and behaviors/ use the self-healing framework correctly."
