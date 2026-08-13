#!/usr/bin/env python3
"""Validate composite actions under .github/actions/.

actionlint parses workflows only — pointed at an action.yml it reports "jobs section is
missing" rather than validating it, so composite actions had no linting at all. That
mattered little while every action was a convenience wrapper, but MINCRM-704 moved the
npm audit gate's ONLY definition into .github/actions/npm-audit/, and a shell error there
fails a scheduled job whose failure signal is the very thing it exists to provide.

Checks three things that actually break a composite action:

1. Structure — valid YAML with the keys `uses:` requires (`name`, `description`,
   `runs.using`). A file missing `runs.using` parses fine and is silently inert.
2. Per-step requirements — every `run:` step in a composite action must declare `shell:`.
   This is the likeliest breakage and the one neither other check can see: it is valid
   YAML and valid shell, and fails only at run time in every caller.
3. Shell — every `run:` block is extracted and passed to shellcheck. GitHub expression
   syntax is blanked first, since `${{ ... }}` is not valid shell and would otherwise be
   reported as an error.

Run with no arguments from the repo root. Exits non-zero on the first problem found.
(MINCRM-704)
"""

from __future__ import annotations

import glob
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

# GitHub accepts action.yml and action.yaml equally; a file named .yaml would
# otherwise be silently unvalidated while the "no actions matched" guard still
# passed on the .yml siblings. (MINCRM-704)
ACTION_GLOB = ".github/actions/*/action.y*ml"
REQUIRED_TOP_LEVEL_KEYS = ("name", "description", "runs")
# `${{ ... }}` is GitHub expression syntax, not shell. Replaced with a placeholder token
# so shellcheck sees a syntactically valid script.
# Non-greedy up to the closing "}}" rather than [^}]*, so an expression containing
# a brace — ${{ fromJSON('{"a":1}') }} — is still blanked rather than leaving a
# fragment that shellcheck reports as a spurious error. (MINCRM-704)
GITHUB_EXPRESSION = re.compile(r"\$\{\{.*?\}\}", re.DOTALL)
EXPRESSION_PLACEHOLDER = "GH_EXPR"


def validate_structure(path: str, document: object) -> list[str]:
    """Returns a list of structural problems; empty means the action is well-formed."""
    if not isinstance(document, dict):
        return [f"{path}: not a YAML mapping"]

    problems = [f"{path}: missing required key: {key}" for key in REQUIRED_TOP_LEVEL_KEYS if key not in document]

    runs = document.get("runs")
    if isinstance(runs, dict):
        if "using" not in runs:
            # Without this the action is silently inert when referenced by `uses:`.
            problems.append(f"{path}: runs.using is missing")
        problems.extend(validate_composite_steps(path, runs))
    elif "runs" in document:
        problems.append(f"{path}: runs is not a mapping")

    return problems


def validate_composite_steps(path: str, runs: dict) -> list[str]:
    """Checks the per-step requirements GitHub enforces only at run time.

    `shell:` is mandatory on every `run:` step inside a composite action. Omitting it is
    neither a YAML error nor a shell error, so neither the structural check above nor
    shellcheck below would catch it — but every caller fails at run time with "Required
    property is missing: shell". That matters here because .github/actions/npm-audit is
    the only definition of the audit gate for both ci.yml's blocking job and the nightly
    security-audit.yml, so this validator reporting OK on a broken action would take out
    both. (MINCRM-704)
    """
    if runs.get("using") != "composite":
        return []

    problems = []
    for index, step in enumerate(runs.get("steps") or []):
        if not isinstance(step, dict):
            problems.append(f"{path}: runs.steps[{index}] is not a mapping")
            continue
        if "run" in step and "shell" not in step:
            label = step.get("name", f"steps[{index}]")
            problems.append(f"{path}: composite run step '{label}' is missing required key: shell")

    return problems


def shellcheck_run_blocks(path: str, document: dict) -> list[str]:
    """Shellchecks every `run:` block in a composite action's steps."""
    runs = document.get("runs")
    if not isinstance(runs, dict) or runs.get("using") != "composite":
        return []

    problems: list[str] = []
    steps = runs.get("steps") or []

    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            continue
        script = step.get("run")
        if not script:
            continue

        sanitized = GITHUB_EXPRESSION.sub(EXPRESSION_PLACEHOLDER, script)
        with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as handle:
            handle.write("#!/usr/bin/env bash\n")
            handle.write(sanitized)
            block_path = handle.name

        result = subprocess.run(
            ["shellcheck", "--shell=bash", "--severity=warning", block_path],
            capture_output=True,
            text=True,
            check=False,
        )
        Path(block_path).unlink(missing_ok=True)

        if result.returncode != 0:
            label = step.get("name", f"step {index}")
            problems.append(f"{path}: shellcheck failed for {label}:\n{result.stdout}{result.stderr}")

    return problems


def main() -> int:
    action_paths = sorted(glob.glob(ACTION_GLOB))
    if not action_paths:
        print(f"ERROR: no composite actions matched {ACTION_GLOB} — has the directory moved?")
        return 1

    problems: list[str] = []
    for path in action_paths:
        try:
            document = yaml.safe_load(Path(path).read_text())
        except yaml.YAMLError as error:
            problems.append(f"{path}: invalid YAML: {error}")
            continue

        structural = validate_structure(path, document)
        problems.extend(structural)
        if not structural and isinstance(document, dict):
            problems.extend(shellcheck_run_blocks(path, document))

    if problems:
        for problem in problems:
            print(f"ERROR: {problem}")
        return 1

    print(f"OK: validated {len(action_paths)} composite action(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
