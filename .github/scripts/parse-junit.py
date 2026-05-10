"""
parse-junit.py — JUnit XML and coverage JSON helpers for CI PR comment generation.

Usage:
  python3 parse-junit.py summary <xml_file>
      Prints: "<status>|<tests>|<passed>|<failed>|<skipped>"
      Status is "✅ Passed" or "❌ Failed".
      Prints "❓ Unknown|0|0|0|0" on any error.

  python3 parse-junit.py summary-unit <xml_file>
      Like summary, but counts suite-level failures/errors attributes (not child elements).
      Used for Vitest/Jest XML where suite attributes are accurate.
      Handles missing files by printing "⏭ Skipped|—|—|—|—".

  python3 parse-junit.py failures <xml_file> <project>
      Prints a markdown <details> block for each failed/errored test case.
      Prints nothing if there are no failures.
      Prints an error note on parse failure.

  python3 parse-junit.py coverage-summary <json_file>
      Parses a Vitest/Jest json-summary coverage file.
      Prints: "<lines>|<funcs>|<branches>|<statements>"
      Prints "—|—|—|—" if the file does not exist; "?|?|?|?" on parse error.

MINCRM-135, MINCRM-350
"""

import sys
import json
import os
import xml.etree.ElementTree as ET


def load_suites(xml_file):
    root = ET.parse(xml_file).getroot()
    return root.findall('testsuite') if root.tag == 'testsuites' else [root]


def cmd_summary(xml_file):
    try:
        suites = load_suites(xml_file)
        tests = sum(int(s.attrib.get('tests', 0)) for s in suites)
        skipped = sum(int(s.attrib.get('skipped', 0)) for s in suites)
        # Count <failure>/<error> child elements directly: Playwright sets
        # suite-level failures/errors attributes to 0 even when test cases fail.
        failed = sum(
            1 for s in suites
            for tc in s.findall('testcase')
            if tc.find('failure') is not None or tc.find('error') is not None
        )
        passed = tests - failed - skipped
        status = '✅ Passed' if failed == 0 else '❌ Failed'
        print(f'{status}|{tests}|{passed}|{failed}|{skipped}')
    except Exception:
        print('❓ Unknown|0|0|0|0')


def cmd_summary_unit(xml_file):
    if not os.path.exists(xml_file):
        print('⏭ Skipped|—|—|—|—')
        return
    try:
        suites = load_suites(xml_file)
        tests = sum(int(s.attrib.get('tests', 0)) for s in suites)
        failures = sum(int(s.attrib.get('failures', 0)) for s in suites)
        errors = sum(int(s.attrib.get('errors', 0)) for s in suites)
        skipped = sum(int(s.attrib.get('skipped', 0)) for s in suites)
        failed = failures + errors
        passed = tests - failed - skipped
        status = '✅ Passed' if failed == 0 else '❌ Failed'
        print(f'{status}|{tests}|{passed}|{failed}|{skipped}')
    except Exception:
        print('❓ Unknown|0|0|0|0')


def cmd_coverage_summary(json_file):
    if not os.path.exists(json_file):
        print('—|—|—|—')
        return
    try:
        with open(json_file) as f:
            data = json.load(f)
        t = data.get('total', {})
        lines = t.get('lines', {}).get('pct', '?')
        funcs = t.get('functions', {}).get('pct', '?')
        branch = t.get('branches', {}).get('pct', '?')
        stmts = t.get('statements', {}).get('pct', '?')
        print(f'{lines}|{funcs}|{branch}|{stmts}')
    except Exception:
        print('?|?|?|?')


def cmd_failures(xml_file, project):
    try:
        suites = load_suites(xml_file)
        failures = []
        for suite in suites:
            for tc in suite.findall('testcase'):
                fail = tc.find('failure') if tc.find('failure') is not None else tc.find('error')
                if fail is not None:
                    name = tc.attrib.get('classname', '') + ' › ' + tc.attrib.get('name', '')
                    msg = (fail.text or fail.attrib.get('message', '')).strip()[:2000]
                    failures.append((name, msg))
        if failures:
            print(f'\n### Failed Tests ({project})\n')
            for name, msg in failures:
                print(f'<details><summary>{name}</summary>\n\n```\n{msg}\n```\n</details>\n')
    except Exception as e:
        print(f'\n### Failed Tests ({project})\n\n_(could not parse results: {e})_\n')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: parse-junit.py summary <xml> | failures <xml> <project>', file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]
    if command == 'summary':
        cmd_summary(sys.argv[2])
    elif command == 'summary-unit':
        cmd_summary_unit(sys.argv[2])
    elif command == 'coverage-summary':
        cmd_coverage_summary(sys.argv[2])
    elif command == 'failures':
        if len(sys.argv) < 4:
            print('failures requires: <xml_file> <project>', file=sys.stderr)
            sys.exit(1)
        cmd_failures(sys.argv[2], sys.argv[3])
    else:
        print(f'Unknown command: {command}', file=sys.stderr)
        sys.exit(1)
