#!/usr/bin/env python3
"""Judges a single promptfoo eval suite's JSON output against its declared
threshold. Used by run-evals.sh — see that file's header comment for why
this exists instead of relying on `promptfoo eval`'s own exit code.

Always exits 0. Prints exactly one line: "PASS <message>" or "FAIL <message>",
which the caller branches on instead of the process exit code (MINCRM-568).

Usage: judge_suite.py <suite.yaml> <suite.json>
"""

import json
import re
import sys


def main() -> int:
    yaml_path, json_path = sys.argv[1], sys.argv[2]

    with open(yaml_path) as f:
        yaml_text = f.read()
    match = re.search(r"^threshold:\s*([0-9.]+)", yaml_text, re.MULTILINE)
    threshold = float(match.group(1)) if match else 1.0

    with open(json_path) as f:
        data = json.load(f)
    stats = data["results"]["stats"]
    successes = stats["successes"]
    failures = stats["failures"]
    errors = stats["errors"]
    total = successes + failures + errors
    pass_rate = successes / total if total > 0 else 0.0

    passed = pass_rate >= threshold and errors == 0
    message = (
        f"{successes}/{total} passed, {pass_rate * 100:.1f}% "
        f"{'>=' if passed else '<'} {threshold * 100:.0f}% threshold"
    )
    if errors > 0:
        message += f", {errors} errors"

    print(f"{'PASS' if passed else 'FAIL'} {message}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
