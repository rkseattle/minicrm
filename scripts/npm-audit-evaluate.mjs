#!/usr/bin/env node
//
// npm-audit-evaluate.mjs — decides which high/critical advisories in an
// `npm audit --json` report block the gate. Called only by npm-audit-gate.sh,
// which owns the allowlist and the fail-closed report check.
//
// Decides on ADVISORIES, not on metadata.vulnerabilities. The metadata counts
// packages, and a package inherits the severity of every advisory beneath it:
// one braces advisory makes micromatch, chokidar, tailwindcss and
// markdownlint-cli2 all count as "high". Subtracting allowlisted packages from
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

// A report missing the detail this file reads would otherwise evaluate as clean.
export function assertCompleteReport(report, label) {
  const counts = report?.metadata?.vulnerabilities;
  if (!isPlainObject(counts) || !isPlainObject(report.vulnerabilities)) {
    throw new Error(`${label}: missing metadata.vulnerabilities or vulnerabilities.`);
  }
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (!isPlainObject(vulnerability) || !Array.isArray(vulnerability.via)) {
      throw new Error(`${label}: vulnerabilities.${name} has no via array.`);
    }
  }
  const countedBlocking = (counts.high || 0) + (counts.critical || 0);
  const detailedBlocking = advisoriesIn(report).some((advisory) =>
    BLOCKING_SEVERITIES.has(advisory.severity),
  );
  if (countedBlocking > 0 && !detailedBlocking) {
    throw new Error(
      `${label}: metadata counts ${countedBlocking} high/critical but no advisory carries that severity.`,
    );
  }
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
  const metadataFor = (advisories) => {
    const vulnerabilities = { moderate: 0, high: 0, critical: 0 };
    for (const { severity } of advisories) vulnerabilities[severity] += 1;
    return { vulnerabilities };
  };
  const reportWith = (...advisories) => ({
    metadata: metadataFor(advisories),
    vulnerabilities: {
      leaf: { via: advisories },
      // A dependent inherits severity through a string `via`; it must never count itself.
      dependent: { severity: 'high', via: ['leaf'] },
    },
  });

  const emptyReport = { metadata: metadataFor([]), vulnerabilities: {} };
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
      {
        metadata: metadataFor([otherCritical]),
        vulnerabilities: { a: { via: [otherCritical] }, b: { via: [otherCritical] } },
      },
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

  const incompleteReports = [
    ['no vulnerabilities object', { metadata: metadataFor([otherCritical]) }],
    ['no metadata', { vulnerabilities: {} }],
    [
      'package with no via array',
      { metadata: metadataFor([]), vulnerabilities: { leaf: { severity: 'high' } } },
    ],
    [
      'counted high with no advisory detail',
      { metadata: metadataFor([allowedHigh]), vulnerabilities: { leaf: { via: ['other'] } } },
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
