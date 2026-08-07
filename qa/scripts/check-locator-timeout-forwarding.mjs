#!/usr/bin/env node
/**
 * check-locator-timeout-forwarding — MINCRM-703
 *
 * Fails when a Page Object method accepts a `timeout` but does not forward it to
 * locator RESOLUTION — either by calling `.resolve()` with no argument, or by
 * calling a `*Locator()` helper with none.
 *
 * WHY THIS EXISTS
 * ---------------
 * The healing locator probes each strategy for 2s by default. A caller's timeout
 * only reaches that probe if every layer forwards it, and a layer that drops it
 * is invisible: the method still compiles, still accepts a timeout, and still
 * passes on a fast machine. It fails only under load, as StrategyExhaustedError
 * — which reads as selector drift rather than "the element had not rendered
 * yet", sending the next reader after the wrong bug entirely.
 *
 * The subtle shape is a timeout that reaches only the waitFor that runs AFTER
 * resolution:
 *
 *     const resolved = await this.page.locate(...).resolve();   // 2s, always
 *     await resolved.waitFor({ state: 'visible', timeout });     // generous, too late
 *
 * That reads as "this method honours its timeout" and does not. It is why F-AS2
 * failed on `add-activity-button` in CI while three sibling shards passed.
 *
 * WHY NODE AND NOT BASH
 * ---------------------
 * The sibling checks in this directory are shell scripts, and this started as
 * one. It needs multi-line signature accumulation and brace-depth tracking, and
 * under `set -euo pipefail` an arithmetic update that evaluates to 0 returns
 * exit 1 and silently kills the read loop mid-file — the guard reported PASS
 * while scanning almost nothing. That is precisely the failure mode a guard must
 * not have, so this one is JS. Run with `node`, not `bash`.
 *
 * Self-test: `node check-locator-timeout-forwarding.mjs --self-test` runs the
 * scanner against fixtures for every shape below, including the ones an earlier
 * version silently passed.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Control keywords that look like a call but are not a method signature. */
const NOT_A_SIGNATURE =
  /^(if|for|while|switch|catch|return|await|const|let|var|new|typeof|void)\b/;

/** A real `timeout` PARAMETER — not merely a name containing "timeout". */
const TIMEOUT_PARAM = /(?:\(|,)\s*timeout\s*[?:=,)]/;

/** `async foo(` or `foo(` at the start of a member. */
const SIGNATURE_START = /^(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z0-9_]+)\s*\(/;

/** A `*Locator()` helper invoked with no arguments at all. */
const BARE_LOCATOR_CALL = /\b([A-Za-z0-9_]+Locator)\(\)/;

/**
 * Strips line comments and whole-line block comments. JSDoc routinely names
 * sibling methods in prose ("see AutomationPage.headingLocator() for the
 * identical failure mode"); matching those reports findings that are pure
 * documentation, and a check that cries wolf gets ignored.
 */
function stripComments(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) {
    return '';
  }
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

function scanFile(filePath, displayPath) {
  const findings = [];
  const lines = readFileSync(filePath, 'utf8').split('\n');

  let signature = '';
  let inSignature = false;
  let currentMethod = '';
  let methodHasTimeout = false;
  let depthAtMethod = -1;
  let depth = 0;

  lines.forEach((rawLine, i) => {
    const code = stripComments(rawLine);
    const trimmed = code.trim();
    const lineNo = i + 1;

    // Accumulate a method signature. Signatures wrap across lines constantly;
    // testing only the first line misses those entirely.
    if (!inSignature) {
      const m = trimmed.match(SIGNATURE_START);
      if (m && !NOT_A_SIGNATURE.test(trimmed)) {
        signature = trimmed;
        currentMethod = m[1];
        inSignature = true;
      }
    } else {
      signature += ' ' + trimmed;
    }

    if (inSignature && signature.includes('{')) {
      methodHasTimeout = TIMEOUT_PARAM.test(signature);
      depthAtMethod = methodHasTimeout ? depth : -1;
      inSignature = false;
    }

    if (methodHasTimeout) {
      if (code.includes('.resolve()')) {
        findings.push(
          `  ${displayPath}:${lineNo}: ${currentMethod}() accepts a timeout but calls .resolve() without it`,
        );
      }
      const bare = code.match(BARE_LOCATOR_CALL);
      if (bare) {
        findings.push(
          `  ${displayPath}:${lineNo}: ${currentMethod}() accepts a timeout but calls ${bare[1]}() without it`,
        );
      }
    }

    // Track brace depth so a method's timeout state cannot leak into whatever
    // member follows it (a private sync helper, a getter, an arrow property).
    depth += (code.match(/\{/g) ?? []).length;
    depth -= (code.match(/\}/g) ?? []).length;

    if (methodHasTimeout && depth <= depthAtMethod) {
      methodHasTimeout = false;
      currentMethod = '';
      depthAtMethod = -1;
    }
  });

  return findings;
}

function collectTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function scanDir(dir) {
  return collectTsFiles(dir).flatMap((f) => scanFile(f, relative(dir, f)));
}

// ---------------------------------------------------------------------------
// Self-test — an earlier bash version silently passed every shape below.
// ---------------------------------------------------------------------------
if (process.argv[2] === '--self-test') {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const tmp = mkdtempSync(join(tmpdir(), 'locator-guard-'));
  try {
    writeFileSync(
      join(tmp, 'Bad.ts'),
      `class Bad {
  async multiLineSignature(
    entity: string,
    timeout = 10_000,
  ): Promise<boolean> {
    const resolved = await this.page.locate([], {}).resolve();
    await resolved.waitFor({ state: 'visible', timeout });
    return true;
  }
  async inlineResolve(timeout?: number): Promise<void> {
    await this.page.locate([], {}).resolve();
  }
  async bareLocatorCall(timeout?: number): Promise<void> {
    const l = await this.thingLocator();
    await l.click();
  }
}
`,
    );

    writeFileSync(
      join(tmp, 'Good.ts'),
      `class Good {
  async forwards(timeout?: number): Promise<void> {
    const l = await this.thingLocator(timeout);
    await l.click();
  }
  async forwardsInline(timeout?: number): Promise<void> {
    await this.page.locate([], {}).resolve(timeout);
  }
  /** See OtherPage.headingLocator() for the identical failure mode. */
  async noTimeoutAtAll(): Promise<void> {
    const l = await this.thingLocator();
    await l.click();
  }
  async namedLikeTimeout(pollTimeoutLabel: string): Promise<void> {
    const l = await this.thingLocator();
    await l.click();
  }
  private buildThing(): void {
    void this.otherLocator();
  }
}
`,
    );

    const findings = scanDir(tmp);
    const badCount = findings.filter((f) => f.startsWith('  Bad.ts')).length;
    const goodCount = findings.filter((f) => f.startsWith('  Good.ts')).length;

    findings.forEach((f) => console.log(f));

    if (badCount !== 3 || goodCount !== 0) {
      console.error(
        `SELF-TEST FAIL: caught ${badCount}/3 real defects, ${goodCount} false positives.`,
      );
      process.exit(1);
    }
    console.log('SELF-TEST PASS: 3/3 defects caught, 0 false positives.');
    process.exit(0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const pagesDir = join(SCRIPT_DIR, '..', 'e2e', 'pages');
const findings = scanDir(pagesDir);

if (findings.length > 0) {
  findings.forEach((f) => console.log(f));
  console.log('');
  console.log(`FAIL: ${findings.length} locator resolution(s) drop their caller's timeout.`);
  console.log("The caller's budget must reach resolve(), not just the waitFor that runs");
  console.log('after it — otherwise the probe uses the 2s default and fails under load as');
  console.log('StrategyExhaustedError, which reads as selector drift. Forward it:');
  console.log('    const locator = await this.someLocator(timeout);');
  console.log('    await this.page.locate(...).resolve(timeout);');
  process.exit(1);
}

console.log('PASS: every page-object method with a timeout forwards it to resolution.');
