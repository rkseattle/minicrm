#!/usr/bin/env node
//
// npm-audit-evaluate.mjs — decides which high/critical advisories in an
// `npm audit --json` report block the gate. Called only by npm-audit-gate.sh,
// which owns the allowlist and the fail-closed report check.
//
// Decides on ADVISORIES, not on metadata.vulnerabilities. The metadata counts
// packages, and a package inherits the severity of every advisory beneath it:
// one braces advisory makes micromatch, chokidar and markdownlint-cli2
// all count as "high". Subtracting allowlisted packages from
// those counts would either leave the dependents blocking or require guessing
// which counts came from where. Every inherited severity ends at an advisory
// object, so judging the advisory objects alone is exact.
//
// The allowlist admits only dev-only advisories, so an allowlisted advisory that
// also appears in the `--omit=dev` report blocks like any other.
//
// Usage:
//   node scripts/npm-audit-evaluate.mjs <audit.json> <production-audit.json> [GHSA-id ...]
//     Prints JSON { blocking, suppressed, stale } to stdout; exits 1 on an incomplete report.
//   node scripts/npm-audit-evaluate.mjs --self-test

import { readFileSync } from 'node:fs';

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

function advisoryId(advisory) {
  return String(advisory.url || '')
    .split('/')
    .pop();
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function advisoriesIn(report) {
  return Object.values(report.vulnerabilities).flatMap((vulnerability) =>
    vulnerability.via.filter(isPlainObject),
  );
}

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

// A report missing the detail this file reads would otherwise evaluate as clean, so every
// package npm counted must be present, and every via must resolve.
export function assertCompleteReport(report, label) {
  const counts = report?.metadata?.vulnerabilities;
  const packages = report?.vulnerabilities;
  if (!isPlainObject(counts) || !isPlainObject(packages)) {
    throw new Error(`${label}: missing metadata.vulnerabilities or vulnerabilities.`);
  }
  const packageCounts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const [name, vulnerability] of Object.entries(packages)) {
    if (!isPlainObject(vulnerability) || !Array.isArray(vulnerability.via)) {
      throw new Error(`${label}: vulnerabilities.${name} has no via array.`);
    }
    if (!SEVERITIES.includes(vulnerability.severity)) {
      throw new Error(`${label}: vulnerabilities.${name} has no recognized severity.`);
    }
    packageCounts[vulnerability.severity] += 1;
    for (const via of vulnerability.via) {
      if (typeof via === 'string' ? !Object.hasOwn(packages, via) : !isCompleteAdvisory(via)) {
        throw new Error(`${label}: vulnerabilities.${name} has an unresolvable via entry.`);
      }
    }
  }
  const mismatched = SEVERITIES.filter(
    (severity) => (counts[severity] ?? 0) !== packageCounts[severity],
  );
  if (mismatched.length > 0 || (counts.total ?? 0) !== Object.keys(packages).length) {
    throw new Error(`${label}: metadata counts do not match the vulnerabilities map.`);
  }
}

function isCompleteAdvisory(via) {
  return (
    isPlainObject(via) &&
    SEVERITIES.includes(via.severity) &&
    typeof via.url === 'string' &&
    advisoryId(via) !== ''
  );
}

export function evaluateAuditReport(report, productionReport, allowlistedIds) {
  assertCompleteReport(report, 'audit report');
  assertCompleteReport(productionReport, 'production audit report');
  const allowlist = new Set(allowlistedIds);
  const productionIds = new Set(advisoriesIn(productionReport).map(advisoryId));
  const seenIds = new Set();
  const blocking = new Set();
  const suppressed = new Set();

  for (const advisory of advisoriesIn(report)) {
    const id = advisoryId(advisory);
    seenIds.add(id);
    if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue;
    const line = `${id}  ${advisory.severity}  ${advisory.name}`;
    if (!allowlist.has(id)) blocking.add(line);
    else if (productionIds.has(id)) blocking.add(`${line}  (allowlisted, but reaches production)`);
    else suppressed.add(line);
  }

  // An entry whose advisory is gone has been fixed upstream and should be deleted.
  const stale = [...allowlist].filter((id) => !seenIds.has(id));

  return {
    blocking: [...blocking].sort(),
    suppressed: [...suppressed].sort(),
    stale: stale.sort(),
  };
}

function advisory(id, name, severity) {
  return { name, severity, url: `https://github.com/advisories/${id}` };
}

function selfTest() {
  const allowedHigh = advisory('GHSA-allowed-high', 'braces', 'high');
  const otherCritical = advisory('GHSA-other-critical', 'simple-git', 'critical');
  const otherModerate = advisory('GHSA-other-moderate', 'csv-parse', 'moderate');
  const severityRank = (severity) => SEVERITIES.indexOf(severity);
  // Builds metadata from the packages, as npm does, so fixtures reconcile unless a case breaks them.
  const reportOf = (packages, metadataOverride = {}) => {
    const vulnerabilities = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
    for (const { severity } of Object.values(packages)) vulnerabilities[severity] += 1;
    vulnerabilities.total = Object.keys(packages).length;
    return {
      metadata: { vulnerabilities: { ...vulnerabilities, ...metadataOverride } },
      vulnerabilities: packages,
    };
  };
  const reportWith = (...advisories) => {
    const severity = advisories
      .map((entry) => entry.severity)
      .reduce((highest, next) => (severityRank(next) > severityRank(highest) ? next : highest));
    return reportOf({
      leaf: { severity, via: advisories },
      // A dependent inherits severity through a string `via`; it must never count itself.
      dependent: { severity, via: ['leaf'] },
    });
  };

  const emptyReport = reportOf({});
  const cases = [
    ['clean report', emptyReport, emptyReport, [], [0, 0, 0]],
    [
      'allowlisted high and its dependents pass',
      reportWith(allowedHigh),
      emptyReport,
      ['GHSA-allowed-high'],
      [0, 1, 0],
    ],
    [
      'unlisted critical blocks beside an allowlisted high',
      reportWith(allowedHigh, otherCritical),
      emptyReport,
      ['GHSA-allowed-high'],
      [1, 1, 0],
    ],
    [
      'unlisted high blocks with an empty allowlist',
      reportWith(allowedHigh),
      emptyReport,
      [],
      [1, 0, 0],
    ],
    ['moderate never blocks', reportWith(otherModerate), emptyReport, [], [0, 0, 0]],
    [
      'allowlisting a moderate is not stale',
      reportWith(otherModerate),
      emptyReport,
      ['GHSA-other-moderate'],
      [0, 0, 0],
    ],
    [
      'entry with no matching advisory is stale',
      reportWith(otherModerate),
      emptyReport,
      ['GHSA-allowed-high'],
      [0, 0, 1],
    ],
    [
      'duplicate advisory across packages counts once',
      reportOf({
        a: { severity: 'critical', via: [otherCritical] },
        b: { severity: 'critical', via: [otherCritical] },
      }),
      emptyReport,
      [],
      [1, 0, 0],
    ],
    [
      'allowlisted high that reaches production blocks',
      reportWith(allowedHigh),
      reportWith(allowedHigh),
      ['GHSA-allowed-high'],
      [1, 0, 0],
    ],
  ];

  // Each carries the allowlisted high, which is in every real report and must not mask the gap.
  const withAllowedHigh = (packages, metadataOverride) =>
    reportOf({ braces: { severity: 'high', via: [allowedHigh] }, ...packages }, metadataOverride);
  const incompleteReports = [
    ['no vulnerabilities object', { metadata: reportOf({}).metadata }],
    ['no metadata', { vulnerabilities: {} }],
    ['package with no via array', withAllowedHigh({ leaf: { severity: 'critical' } })],
    ['package with no severity', withAllowedHigh({ leaf: { via: [otherCritical] } })],
    ['counted critical missing from the map', withAllowedHigh({}, { critical: 1, total: 2 })],
    ['dangling via reference', withAllowedHigh({ leaf: { severity: 'critical', via: ['gone'] } })],
    [
      'advisory with no severity',
      withAllowedHigh({
        leaf: { severity: 'critical', via: [{ name: 'x', url: otherCritical.url }] },
      }),
    ],
    [
      'advisory with no url',
      withAllowedHigh({
        leaf: { severity: 'critical', via: [{ name: 'x', severity: 'critical' }] },
      }),
    ],
  ];

  let failures = 0;
  for (const [name, report, productionReport, allowlist, expected] of cases) {
    const result = evaluateAuditReport(report, productionReport, allowlist);
    const actual = [result.blocking.length, result.suppressed.length, result.stale.length];
    const passed = actual.every((count, index) => count === expected[index]);
    if (!passed) failures += 1;
    console.log(
      `${passed ? 'ok  ' : 'FAIL'} ${name}: [blocking, suppressed, stale] = [${actual}] expected [${expected}]`,
    );
  }
  for (const [name, report] of incompleteReports) {
    for (const [side, args] of [
      ['full', [report, emptyReport, []]],
      ['production', [emptyReport, report, []]],
    ]) {
      let rejected = false;
      try {
        evaluateAuditReport(...args);
      } catch {
        rejected = true;
      }
      if (!rejected) failures += 1;
      console.log(`${rejected ? 'ok  ' : 'FAIL'} rejects ${side} report: ${name}`);
    }
  }
  const total = cases.length + incompleteReports.length * 2;
  console.log(`${total - failures}/${total} self-test cases passed.`);
  return failures === 0;
}

const [firstArgument, productionReportPath, ...allowlistedIds] = process.argv.slice(2);
if (firstArgument === '--self-test') {
  process.exit(selfTest() ? 0 : 1);
}
if (!firstArgument || !productionReportPath) {
  console.error(
    'Usage: npm-audit-evaluate.mjs <audit.json> <production-audit.json> [GHSA-id ...] | --self-test',
  );
  process.exit(2);
}
const readReport = (path) => JSON.parse(readFileSync(path, 'utf8'));
console.log(
  JSON.stringify(
    evaluateAuditReport(
      readReport(firstArgument),
      readReport(productionReportPath),
      allowlistedIds,
    ),
  ),
);
