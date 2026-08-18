/**
 * Audit script: cross-reference data-testid attributes in the application
 * source against testId strategy values referenced in E2E Page Objects,
 * behaviors, and functional specs.
 *
 * Usage:
 *   tsx qa/scripts/audit-testids.ts
 *
 * Exit codes:
 *   0 — no stale testids found (unexercised testids are informational only)
 *   1 — one or more stale testids found (broken locators, CI-blocking)
 *
 *
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestidOccurrence {
  value: string;
  file: string;
  line: number;
}

// ---------------------------------------------------------------------------
// File traversal
// ---------------------------------------------------------------------------

function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Build a character-offset → line number lookup for a file's content. */
function buildLineOffsets(content: string): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of content.split('\n')) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

/** Binary-search the line offsets array to find the 1-based line number for a char offset. */
function lineAt(offsets: number[], charPos: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= charPos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ---------------------------------------------------------------------------
// Application-side collection
// ---------------------------------------------------------------------------

/**
 * Parse all data-testid= occurrences from application source files.
 *
 * Handles four forms:
 *   data-testid="some-value"            → static string (double-quoted)
 *   data-testid={'some-value'}          → static string (single-quoted in braces)
 *   data-testid={`prefix-${expr}`}     → template literal — extract prefix up to first $
 *   testId: 'some-value'               → prop-driven testid (BulkAction, StatCard, etc.)
 *                                         These are passed to data-testid via a prop.
 *
 * Returns two arrays: statics (exact values) and dynamics (prefix + "*").
 */
export function collectAppTestids(srcDir: string): {
  statics: TestidOccurrence[];
  dynamics: TestidOccurrence[];
} {
  const statics: TestidOccurrence[] = [];
  const dynamics: TestidOccurrence[] = [];

  const files = findFiles(srcDir, ['.tsx', '.ts']);

  // JSX attribute forms.
  // Group 1: double-quoted static    data-testid="value"
  // Group 2: single-quoted static    data-testid={'value'}
  // Group 3: template literal        data-testid={`...`}
  const RE_ATTR = /data-testid=(?:"([^"]+)"|{'\s*([^']+?)\s*'}|{`([^`]*)`})/g;

  // Prop-driven form: testId: 'value' or testId: "value"
  // Matches the BulkAction/StatCard/DetailRow patterns where the testid value
  // is stored in a data object and forwarded to data-testid by the component.
  const RE_PROP = /\btestId\s*:\s*(?:'([^']+)'|"([^"]+)")/g;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const offsets = buildLineOffsets(content);
    const relPath = path.relative(process.cwd(), filePath);

    // --- JSX data-testid= attributes ---
    RE_ATTR.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RE_ATTR.exec(content)) !== null) {
      const lineNumber = lineAt(offsets, match.index);

      if (match[1] !== undefined) {
        statics.push({ value: match[1], file: relPath, line: lineNumber });
      } else if (match[2] !== undefined) {
        statics.push({ value: match[2], file: relPath, line: lineNumber });
      } else if (match[3] !== undefined) {
        const raw = match[3];
        const dollarIdx = raw.indexOf('${');
        if (dollarIdx === -1) {
          statics.push({ value: raw, file: relPath, line: lineNumber });
        } else if (dollarIdx === 0) {
          // Fully variable prefix (e.g. `${prefix}stage-column-${slug}`)
          dynamics.push({
            value: `*-${raw.replace(/\$\{[^}]+\}/g, '*')}`,
            file: relPath,
            line: lineNumber,
          });
        } else {
          const prefix = raw.slice(0, dollarIdx);
          dynamics.push({ value: `${prefix}*`, file: relPath, line: lineNumber });
        }
      }
    }
    RE_ATTR.lastIndex = 0;

    // --- Prop-driven testId: 'value' ---
    RE_PROP.lastIndex = 0;
    while ((match = RE_PROP.exec(content)) !== null) {
      const value = match[1] ?? match[2];
      if (value !== undefined) {
        statics.push({ value, file: relPath, line: lineAt(offsets, match.index) });
      }
    }
    RE_PROP.lastIndex = 0;
  }

  return { statics, dynamics };
}

// ---------------------------------------------------------------------------
// Test-side collection
// ---------------------------------------------------------------------------

/**
 * Parse all { type: 'testId', value: '...' } strategy objects from test files.
 *
 * Handles:
 *   { type: 'testId', value: 'some-value' }    → static
 *   { type: 'testId', value: `template-${x}` } → dynamic (extract prefix)
 */
export function collectTestTestids(dirs: string[]): {
  statics: TestidOccurrence[];
  dynamics: TestidOccurrence[];
} {
  const statics: TestidOccurrence[] = [];
  const dynamics: TestidOccurrence[] = [];

  const RE_STATIC = /\{\s*type\s*:\s*'testId'\s*,\s*value\s*:\s*'([^']+)'\s*\}/g;
  const RE_STATIC_DQ = /\{\s*type\s*:\s*'testId'\s*,\s*value\s*:\s*"([^"]+)"\s*\}/g;
  const RE_TEMPLATE = /\{\s*type\s*:\s*'testId'\s*,\s*value\s*:\s*`([^`]+)`\s*\}/g;

  for (const dir of dirs) {
    const files = findFiles(dir, ['.ts', '.tsx']);

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const offsets = buildLineOffsets(content);
      const relPath = path.relative(process.cwd(), filePath);

      for (const RE of [RE_STATIC, RE_STATIC_DQ]) {
        RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = RE.exec(content)) !== null) {
          statics.push({ value: match[1], file: relPath, line: lineAt(offsets, match.index) });
        }
        RE.lastIndex = 0;
      }

      RE_TEMPLATE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = RE_TEMPLATE.exec(content)) !== null) {
        const raw = match[1];
        const dollarIdx = raw.indexOf('${');
        const lineNumber = lineAt(offsets, match.index);
        if (dollarIdx === -1) {
          statics.push({ value: raw, file: relPath, line: lineNumber });
        } else if (dollarIdx === 0) {
          dynamics.push({
            value: `*-${raw.replace(/\$\{[^}]+\}/g, '*')}`,
            file: relPath,
            line: lineNumber,
          });
        } else {
          const prefix = raw.slice(0, dollarIdx);
          dynamics.push({ value: `${prefix}*`, file: relPath, line: lineNumber });
        }
      }
      RE_TEMPLATE.lastIndex = 0;
    }
  }

  return { statics, dynamics };
}

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

/**
 * A test-referenced testid is considered "matched" if:
 *   - It exactly equals a static app testid, OR
 *   - It starts with the prefix of a dynamic app testid
 *     (e.g. test value "contact-link-abc123" matches app dynamic "contact-link-*")
 */
export function isMatchedByApp(
  testValue: string,
  appStaticValues: Set<string>,
  appDynamicPrefixes: string[],
): boolean {
  if (appStaticValues.has(testValue)) return true;
  for (const prefix of appDynamicPrefixes) {
    const bare = prefix.endsWith('*') ? prefix.slice(0, -1) : prefix;
    if (bare && testValue.startsWith(bare)) return true;
  }
  return false;
}

/**
 * A static app testid is "exercised" if:
 *   - It exactly equals a static test-referenced testid, OR
 *   - It starts with a prefix from a dynamic test-referenced testid
 *     (e.g. app value "contact-link-abc" matched by test dynamic "contact-link-*")
 */
export function isExercised(
  appValue: string,
  testStaticValues: Set<string>,
  testDynamicPrefixes: string[],
): boolean {
  if (testStaticValues.has(appValue)) return true;
  for (const prefix of testDynamicPrefixes) {
    const bare = prefix.endsWith('*') ? prefix.slice(0, -1) : prefix;
    if (bare && appValue.startsWith(bare)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(params: {
  stale: TestidOccurrence[];
  unexercised: TestidOccurrence[];
  appDynamics: TestidOccurrence[];
  testDynamics: TestidOccurrence[];
  matchedCount: number;
  timestamp: string;
}): string {
  const { stale, unexercised, appDynamics, testDynamics, matchedCount, timestamp } = params;

  const allDynamics: Array<TestidOccurrence & { source: 'app' | 'test' }> = [
    ...appDynamics.map((d) => ({ ...d, source: 'app' as const })),
    ...testDynamics.map((d) => ({ ...d, source: 'test' as const })),
  ];

  const lines: string[] = [
    '# data-testid Audit Report',
    `Generated: ${timestamp}`,
    '',
    '## Summary',
    `- Matched: ${matchedCount}`,
    `- Stale (broken locators): ${stale.length}`,
    `- Unexercised (in app, not in tests): ${unexercised.length}`,
    `- Dynamic (manual review required): ${allDynamics.length}`,
    '',
  ];

  lines.push('## Stale testids (action required)');
  if (stale.length === 0) {
    lines.push('_None — all test-referenced testids are present in the application source._');
  } else {
    lines.push('| testid | Test file | Line |');
    lines.push('|--------|-----------|------|');
    for (const s of stale) {
      lines.push(`| \`${s.value}\` | ${s.file} | ${s.line} |`);
    }
  }
  lines.push('');

  lines.push('## Unexercised testids (review required)');
  if (unexercised.length === 0) {
    lines.push('_None — all static application testids are referenced by at least one test._');
  } else {
    lines.push('| testid | App file | Line |');
    lines.push('|--------|----------|------|');
    for (const u of unexercised) {
      lines.push(`| \`${u.value}\` | ${u.file} | ${u.line} |`);
    }
  }
  lines.push('');

  lines.push('## Dynamic testids (manual review)');
  if (allDynamics.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| pattern | File | Line | Source |');
    lines.push('|---------|------|------|--------|');
    for (const d of allDynamics) {
      lines.push(`| \`${d.value}\` | ${d.file} | ${d.line} | ${d.source} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function run(): void {
  const repoRoot = path.resolve(process.cwd());

  const appSrcDir = path.join(repoRoot, 'client', 'src');
  const testDirs = [
    path.join(repoRoot, 'qa', 'e2e', 'pages', 'minicrm'),
    path.join(repoRoot, 'qa', 'e2e', 'behaviors', 'minicrm'),
    path.join(repoRoot, 'qa', 'e2e', 'tests', 'apps'),
  ];

  const { statics: appStatics, dynamics: appDynamics } = collectAppTestids(appSrcDir);
  const { statics: testStatics, dynamics: testDynamics } = collectTestTestids(testDirs);

  const appStaticValues = new Set(appStatics.map((s) => s.value));
  const appDynamicPrefixes = appDynamics.map((d) => d.value);

  const testStaticValues = new Set(testStatics.map((s) => s.value));
  const testDynamicPrefixes = testDynamics.map((d) => d.value);

  // Stale: test-referenced static testids not present in app source (static or dynamic).
  const stale = testStatics.filter(
    (t) => !isMatchedByApp(t.value, appStaticValues, appDynamicPrefixes),
  );

  // Unexercised: app static testids not referenced in test code (static or dynamic).
  const unexercised = appStatics.filter(
    (a) => !isExercised(a.value, testStaticValues, testDynamicPrefixes),
  );

  // Matched count: test statics that ARE matched.
  const matchedCount = testStatics.length - stale.length;

  const timestamp = new Date().toISOString();

  const reportContent = generateReport({
    stale,
    unexercised,
    appDynamics,
    testDynamics,
    matchedCount,
    timestamp,
  });

  const reportPath = path.join(repoRoot, 'qa', 'scripts', 'audit-testids-report.md');
  fs.writeFileSync(reportPath, reportContent, 'utf-8');

  // Print summary to stdout.
  const summaryLines = [
    '',
    '=== data-testid Audit Summary ===',
    `Matched:                       ${matchedCount}`,
    `Stale (broken locators):       ${stale.length}`,
    `Unexercised (app, not tested): ${unexercised.length}`,
    `Dynamic (manual review):       ${appDynamics.length + testDynamics.length}`,
    '',
    `Full report written to: ${path.relative(repoRoot, reportPath)}`,
    '',
  ];

  if (stale.length > 0) {
    summaryLines.push('STALE testids found (action required):');
    for (const s of stale) {
      summaryLines.push(`  [STALE] "${s.value}" at ${s.file}:${s.line}`);
    }
    summaryLines.push('');
  }

  console.log(summaryLines.join('\n'));

  if (stale.length > 0) {
    process.exit(1);
  }
}

const scriptPath = process.argv[1] ?? '';
if (scriptPath.endsWith('audit-testids.ts') || scriptPath.endsWith('audit-testids.js')) {
  run();
}
