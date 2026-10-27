/**
 * Email body sanitizer — style allowlist in a real browser
 *
 * sanitizeEmailHtml keeps an inline style only by re-reading it through the browser's own
 * CSS parser, and its unit test runs that under jsdom, whose parser is not Chromium's. A
 * value jsdom rejects but Chromium accepts (or expands differently) would pass the unit
 * test and still reach a reader. This runs the unit test's own corpus through the real
 * sanitizer in the browser that renders the mail.
 *
 * No app state: the sanitizer is bundled from source at test time and loaded into a blank
 * page, so this needs no login, no records and no flag, and is safe in the parallel job.
 *
 * Reads two client/ source files at test time. qa/ cannot import client modules, which
 * need a DOM and a bundler, and a copied corpus would let the two runs drift apart
 * unnoticed — the failure this spec exists to catch. Both files are import-safe:
 * sanitizeEmailHtml.ts pulls in only dompurify, and the corpus is dependency-free.
 * Both match ci.yml's `client` filter, which gates e2e-functional, but that only runs the
 * job: app coverage never sees this spec's own bundle, so the `impacts` annotations below
 * are what make the selector pick it when either file changes.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw page calls in this file — all through @behaviors/* imports
 */

import path from 'node:path';
import { build } from 'esbuild';
import { test, expect } from '@apps/minicrm/fixtures.js';
import { sanitizeStyleCorpusInBrowser } from '@behaviors/minicrm/email-messages.behaviors.js';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../..');

/** The window property the bundle assigns; unlikely to collide with anything on a blank page. */
const PROBE_GLOBAL = '__emailSanitizerProbe';

/** What the sanitizer must never keep: a remote load, or a function that can resolve to one. */
const LOADING_CSS = /url|image-set|var\(/i;

/** Bundles the client sanitizer and its corpus into one IIFE that a blank page can run. */
async function bundleSanitizerProbe(): Promise<string> {
  const result = await build({
    stdin: {
      contents: [
        "export { sanitizeEmailHtml } from './client/src/utils/sanitizeEmailHtml.ts';",
        'export { HOSTILE_EMAIL_STYLES, DISALLOWED_FUNCTION_STYLES }',
        "  from './client/src/utils/__fixtures__/hostileEmailStyles.ts';",
      ].join('\n'),
      resolveDir: REPO_ROOT,
      loader: 'ts',
      sourcefile: 'email-sanitizer-probe.ts',
    },
    bundle: true,
    format: 'iife',
    globalName: PROBE_GLOBAL,
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  const [bundle] = result.outputFiles;
  if (!bundle) throw new Error('esbuild produced no output for the sanitizer probe');
  return bundle.text;
}

test(
  'F-ES1 — no hostile inline style survives the sanitizer in a real browser @functional',
  {
    annotation: [
      { type: 'impacts', description: 'client/src/utils/sanitizeEmailHtml.ts' },
      { type: 'impacts', description: 'client/src/utils/__fixtures__/hostileEmailStyles.ts' },
    ],
  },
  async ({ page }) => {
    const bundleSource = await bundleSanitizerProbe();

    const corpus = await sanitizeStyleCorpusInBrowser({ page }, bundleSource, PROBE_GLOBAL);

    // An empty corpus would pass every check below, so its presence is asserted first.
    expect(corpus.hostile.length).toBeGreaterThan(0);
    expect(corpus.disallowedFunction.length).toBeGreaterThan(0);
    for (const { style, html } of corpus.hostile) {
      expect.soft(html, `kept a remote host from: ${style}`).not.toContain('evil.test');
      expect.soft(html, `kept loading CSS from: ${style}`).not.toMatch(LOADING_CSS);
    }
    for (const { style, keptStyle } of corpus.disallowedFunction) {
      expect.soft(keptStyle, `kept a style calling a disallowed function: ${style}`).toBeNull();
    }
  },
);
