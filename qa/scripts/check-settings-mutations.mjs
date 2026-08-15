#!/usr/bin/env node
/**
 * check-settings-mutations — MINCRM-358, MINCRM-552, MINCRM-705
 *
 * CI lint step enforcing two independent invariants about which spec files must
 * carry the `@serial` tag.
 *
 * WHAT THIS CHECKS
 * ----------------
 * INVARIANT A — mutates-shared-state => tagged @serial.
 *   A spec that mutates a global settings singleton must call
 *   ensureSystemDefaults() (or a domain reset) AND tag its tests @serial.
 *   Unlike the bash version this replaces, the set of mutating behavior-layer
 *   wrappers is DERIVED from qa/e2e/behaviors/minicrm/ rather than hand-listed,
 *   so a spec that mutates through a helper is no longer invisible.
 *
 * INVARIANT B — self-serializes => tagged @serial, or allow-listed.
 *   A `test.describe.serial(...)` BLOCK whose tests carry no @serial tag must
 *   appear in SELF_SERIAL_ALLOWLIST with a written reason. describe.serial
 *   orders tests WITHIN a file; it gives no cross-file protection, so a file
 *   relying on it while running in the parallel matrix is a live race.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous bash implementation matched mutation call sites as literal text
 * in the spec file itself, against a hand-maintained MUTATION_PATTERNS list that
 * mixed raw endpoint regexes with two hand-copied wrapper names. That list was a
 * manual mirror of the behavior layer and had drifted: the behavior layer wraps
 * mutations of three endpoint families, of which the list named two wrappers.
 *
 * onboarding.spec.ts escaped for exactly that reason. It calls
 * setOnboardingCompleted(restClient, false), which is
 * `restClient.put('/api/v1/settings/onboarding', ...)` in setup.behaviors.ts —
 * an endpoint ALREADY in the old pattern list. One level of indirection defeated
 * it, so the file mutated a shared row while running in the parallel shard job.
 *
 * data-hygiene.spec.ts escaped the same way via setAiEnabled(), whose own
 * docblock argued no @serial was needed while reasoning about a different
 * resource than the one it actually writes.
 *
 * WHY NODE AND NOT BASH
 * ---------------------
 * Same reasoning as check-locator-timeout-forwarding.mjs, whose bash ancestor
 * "reported PASS while scanning almost nothing". This guard additionally needs
 * multi-line call-site accumulation (test titles and restClient calls are
 * routinely split across lines) and brace-depth tracking through NESTED
 * describes. Run with `node`, not `bash`.
 *
 * Self-test: `node check-settings-mutations.mjs --self-test` runs both scanners
 * against fixtures covering every shape below, including the two-block file that
 * a file-level `grep -q @serial` silently passes.
 *
 * HOW TO FIX A FAILURE
 * --------------------
 * Invariant A, cleanup missing:
 *   Import ensureSystemDefaults from @behaviors/minicrm/settings.behaviors.js
 *   and call it in test.beforeEach/afterEach with an admin-authed restClient.
 *
 * Invariant A, @serial missing:
 *   Add @serial to the TITLE of every mutating test:
 *     test('@functional @serial F9-L1: ...')
 *   The title is authoritative — gen-conflict-group-configs.ts selects files via
 *   findTaggedTestTitles, and CI greps titles. A tag supplied ONLY via the
 *   options object `{ tag: [...] }` is invisible to both, so it is reported.
 *   Then add a RESOURCE_REGISTRY entry naming the resource it touches.
 *
 * Invariant B:
 *   Either tag the block's tests @serial (and register the file), or add the
 *   block to SELF_SERIAL_ALLOWLIST below with a reason from the accepted set.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Invariant B allow-list.
//
// Every entry names a specific verified reason. The accepted reasons are:
//   caller-scoped   — the write targets an ephemeral user's own row, so no
//                     other test can observe it.
//   choreography    — describe.serial orders steps WITHIN a test sequence; the
//                     block writes no shared state.
//   framework-spec  — lives outside tests/apps/.../functional/, so it is not in
//                     gen-conflict-group-configs.ts's scan and never reaches the
//                     functional matrix.
//   not-live        — the file is reachable by no enabled CI job today.
//
// An entry that cannot be justified by one of these, or that exists only to
// make the guard pass, means the guard is wrong — fix the guard, not the list.
// ---------------------------------------------------------------------------
/**
 * Pseudo-block title for `test.describe.configure({ mode: 'serial' })`, which
 * serializes the whole FILE and so has no block name of its own. Allow-list
 * entries use this string as their `block`.
 */
const FILE_LEVEL_SERIAL_BLOCK = '(file-level describe.configure serial mode)';

const SELF_SERIAL_ALLOWLIST = [
  {
    file: 'apps/minicrm/functional/notifications/notifications.spec.ts',
    block: 'Profile page — notification preferences',
    reason: 'caller-scoped',
    // The F10-PP tests create an ephemeral admin and re-authenticate restClient
    // as that user (:57-64, MINCRM-415), so patchNotificationPreferences writes
    // the EPHEMERAL user's own row, not the shared settings singleton. The
    // file's other block (F10-AS) is correctly @serial-tagged and registered —
    // which is exactly why a file-level "@serial" grep passes this file while
    // missing this block.
  },
  {
    file: 'apps/minicrm/functional/concurrency/concurrency.spec.ts',
    block: 'F-CC — Optimistic locking concurrency',
    reason: 'choreography',
    // Each test is a three-step sequence (A reads -> B writes newer version ->
    // A writes stale version) needing deterministic ordering. Every test owns
    // its own records; no system_settings write anywhere in the file.
    // See qa/e2e/PARALLELISM-NOTES.md:116.
  },
  {
    file: 'apps/minicrm/functional/coverage-mapping/coverage-mapping.spec.ts',
    block: FILE_LEVEL_SERIAL_BLOCK,
    reason: 'choreography',
    // COVM-01 ingests the data its own later assertions read, so the tests must
    // run in order WITHIN the file. The spec's docblock (:50-54) already records
    // this distinction explicitly: serial mode orders tests within the file,
    // while the @serial tag would move it to the e2e-serial job — a different
    // thing it does not need. Every assertion is narrowed to this spec's own
    // hardcoded testId, and re-ingesting upserts rather than duplicating.
  },
  {
    file: 'apps/minicrm/functional/coverage-pipeline/coverage-pipeline.spec.ts',
    block: FILE_LEVEL_SERIAL_BLOCK,
    reason: 'choreography',
    // COVP-01 asserts the idempotent-no-op contract by ingesting once and then
    // retrying the SAME dump, so the two steps are order-dependent within the
    // file. Assertions are structural (status codes, response shape) against
    // this spec's own dump ids; it writes no shared settings row.
  },
  {
    file: 'framework/grpc-client.spec.ts',
    block: 'grpcClient fixture teardown',
    reason: 'framework-spec',
    // Sequences two tests so the second asserts post-teardown state from the
    // first. Touches no application shared state.
  },
  {
    file: 'framework/heal-page.fixture.spec.ts',
    block: 'healPage fixture teardown',
    reason: 'framework-spec',
    // Same shape. Its own comment (:204-221) documents the chdir-into-tmpdir
    // containment that keeps flush() out of the tracked heal-trends.json.
  },
];

const ALLOWED_REASONS = new Set([
  'caller-scoped',
  'choreography',
  'framework-spec',
  'not-live',
]);

// ---------------------------------------------------------------------------
// Invariant A — file-level exemptions.
// ---------------------------------------------------------------------------
const MUTATION_EXEMPT = [
  {
    file: 'apps/minicrm/functional/visual/visual-regression.spec.ts',
    reason: 'not-live',
    // Writes non-default nav layouts (setNavLayoutViaAPI 'left'/'hamburger'),
    // but never CONCURRENTLY with anything that reads them:
    //   - ci.yml's e2e-functional excludes it via
    //     --grep-invert "visual-regression|serial";
    //   - ci.yml's update-visual-snapshots is hard-disabled with `if: false`;
    //   - update-baselines.yml DOES run it, but only on workflow_dispatch, alone
    //     and at --workers=1 in its own stack — so no other spec is running.
    // Deliberately recorded as an allow-list entry rather than a silent basename
    // bypass (which is what the bash version did), so that enabling it in a
    // shared-stack job surfaces this decision. If that happens the file must be
    // tagged and registered: its nav_layout writes would race navigation,
    // accessibility and reports-nav.
  },
];

// ---------------------------------------------------------------------------
// Behavior-layer derivation (Invariant A).
// ---------------------------------------------------------------------------

/**
 * Endpoint families whose mutation implies a shared global singleton.
 * /settings/* and /admin/ai/* are both required: the admin/ai family is what
 * data-hygiene.spec.ts reaches, so a /settings-only scan misses it.
 */
const SHARED_ENDPOINT = /\/api\/v1\/(settings|admin\/ai|admin\/feature-flags)\b/;

/**
 * A mutating verb on the REST client.
 *
 * The optional generic parameter is load-bearing, not decoration: wrappers that
 * return a body write `restClient.patch<TestAiConfig>(...)`, and a pattern
 * without it silently skips them. setAiEnabled — the wrapper that makes
 * data-hygiene.spec.ts a live race — is exactly that shape.
 */
const MUTATING_CALL = /restClient\s*\.\s*(?:put|patch|delete)\s*(?:<[^>]*>)?\s*\(/;

/**
 * Behavior functions that mutate a shared setting through the UI (a Page Object
 * save/toggle) rather than through restClient.
 *
 * These CANNOT be derived by scanning for REST calls — the mutation happens in
 * the browser, so the behavior function contains no `restClient.patch(...)` at
 * all. setNavLayoutViaUI drives AdminSettingsPage.selectNavLayoutOption() and
 * writes the same nav_layout row that setNavLayoutViaAPI writes.
 *
 * Kept as an explicit list, deliberately — this is the one part of the old
 * hand-maintained MUTATION_PATTERNS that had a real reason to be hand-maintained,
 * and dropping it in favour of pure derivation lost coverage the bash version
 * had. Anything derivable stays derived; only the underivable is listed here.
 *
 * To extend: add a behavior function that reaches a settings Page Object's
 * save/toggle path. The list is asserted against the behavior layer by
 * --self-test so a rename cannot silently empty it.
 */
const UI_DRIVEN_MUTATORS = ['setNavLayoutViaUI'];

/**
 * Arguments representing a RESET to the documented default rather than a
 * mutation. Resetting to the value every other spec also resets to cannot
 * change what another test observes, so these never require @serial. Carried
 * over deliberately from the bash version, where it lived as an ABSENCE from
 * MUTATION_PATTERNS rather than as code.
 *
 * Evaluated at the CALL SITE, not on the wrapper definition. The wrapper is
 * generic — setSystemDefaultLanguage(restClient, language) is a mutation when
 * passed 'es' and a reset when passed 'en' — so judging the definition would
 * flag leads.spec.ts, whose beforeEach only ever resets to 'en'.
 *
 * Argument POSITION is deliberately not fixed. The two wrappers that take a
 * value disagree on order — setSystemDefaultLanguage(restClient, 'en') versus
 * setNavLayoutViaAPI('top', restClient) — so a position-bound pattern reports
 * whichever one it was not written against. Matching a default literal anywhere
 * in the argument list is what both shapes have in common.
 */
// Bound to a WHOLE argument, not a substring of the argument list: a
// list-wide match would exempt any call that merely happens to contain one of
// these literals somewhere, e.g.
// `setVisibilityPolicy(restClient, { contact: 'private', locale: 'en' })`.
const RESET_ARGUMENT = /(?:\(|,)\s*(?:'(?:top|en)'|null)\s*(?:,|\))/;

/**
 * A payload written by a wrapper that hardcodes the default itself, e.g.
 * `{ layout: 'top' }` or a bare DELETE (which clears to the default by
 * definition). Distinct from RESET_ARGUMENT: this is decidable from the
 * wrapper's own body, whereas RESET_ARGUMENT depends on what the spec passes.
 * Both are needed — resetToTopNav takes no value argument at all, so a
 * call-site-only rule would report it as a mutation.
 */
const RESET_LITERAL = /:\s*'(?:top|en)'|restClient\s*\.\s*delete\s*(?:<[^>]*>)?\s*\(\s*`[^`]*\$\{/;

/**
 * Cleanup helpers whose entire purpose is to RESTORE known-good defaults.
 *
 * Calling one is the prescribed cleanup contract, not a mutation, so a spec must
 * never be forced to `@serial` merely for calling it — that inverts the policy
 * the bash version documented explicitly ("files that call mutation behavior
 * names only as defensive resets do not require @serial").
 *
 * Derivation alone cannot classify these: resetAiSettings and
 * resetVisibilitySettings write explicit default PAYLOADS rather than the bare
 * literals RESET_LITERAL recognizes, so they look like mutations from the
 * inside. Name-shaped detection (`reset*`/`ensure*`) is what distinguishes
 * intent here, and it is the same convention the cleanup check below relies on.
 */
const RESET_HELPER_NAME = /^(?:ensure|reset|restore|clear)[A-Z]/;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/**
 * Finds exported functions in the behavior layer that perform a mutating
 * request to a shared-settings endpoint. Returns the function names.
 *
 * Scans the whole function body (brace-depth tracked from the signature) so a
 * call split across lines, or nested inside a Promise.all, is still found —
 * the exact shapes a line-oriented grep misses.
 */
export function deriveMutatingWrappers(source) {
  const clean = stripComments(source);
  const names = [];
  const alwaysReset = [];
  const signature = /export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(/g;

  let match;
  while ((match = signature.exec(clean)) !== null) {
    const name = match[1];

    // Skip PAST the balanced parameter list before looking for the body brace.
    // Naively taking the first '{' after the name lands inside an inline object
    // TYPE in the parameter list — `patch: { enabled: boolean; ... }` — and the
    // depth walk then ends at that type's closing brace, so the real body is
    // never scanned. updateFeatureFlag, updateFeatureFlagRollout and
    // updateFlagGroup are all that shape, and all three were silently invisible
    // to this guard until MINCRM-705's review caught it. The deleted bash
    // version matched them by name, so missing them was a net regression.
    const parenStart = clean.indexOf('(', match.index);
    if (parenStart === -1) continue;
    let parenDepth = 0;
    let afterParams = parenStart;
    for (; afterParams < clean.length; afterParams += 1) {
      if (clean[afterParams] === '(') parenDepth += 1;
      else if (clean[afterParams] === ')') {
        parenDepth -= 1;
        if (parenDepth === 0) break;
      }
    }

    let i = clean.indexOf('{', afterParams);
    if (i === -1) continue;
    let depth = 0;
    let end = i;
    for (; end < clean.length; end += 1) {
      if (clean[end] === '{') depth += 1;
      else if (clean[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = clean.slice(i, end + 1);

    // Mutating calls to a shared endpoint. Reset-ness has TWO sources and both
    // are needed:
    //   - the wrapper hardcodes a default in its own body
    //     (resetToTopNav -> { layout: 'top' }), decidable here;
    //   - the wrapper is generic and the SPEC passes the default
    //     (setSystemDefaultLanguage(restClient, 'en')), decidable only at the
    //     call site — see RESET_ARGUMENT.
    const calls = body
      .split(/(?=restClient\s*\.)/)
      .filter((chunk) => MUTATING_CALL.test(chunk) && SHARED_ENDPOINT.test(chunk.slice(0, 400)));

    if (calls.length === 0) continue;

    names.push(name);
    // Only defaults written, and no parameter reaches the payload: this wrapper
    // cannot mutate whatever it is passed.
    if (calls.every((chunk) => RESET_LITERAL.test(chunk.slice(0, 400)))) {
      alwaysReset.push(name);
    }
  }
  return { mutating: names, alwaysReset };
}

// ---------------------------------------------------------------------------
// Spec scanning.
// ---------------------------------------------------------------------------

/**
 * Extracts every test declaration with its title, its options-object tags, and
 * the character offset it starts at.
 *
 * Multiline-tolerant: `test(` and its title routinely sit on different lines
 * (ai-usage-dashboard.spec.ts:179-181). Anchoring to line starts silently
 * misses those, which is how an earlier hand-audit of this repo mis-counted.
 */
export function findTestDeclarations(source) {
  const clean = stripComments(source);
  const decls = [];
  const call = /\btest(?:\.(?:only|skip|fixme))?\s*\(/g;

  let match;
  while ((match = call.exec(clean)) !== null) {
    const rest = clean.slice(match.index, match.index + 1200);
    const title = rest.match(/\(\s*(['"`])((?:\\.|(?!\1).)*)\1/);
    if (!title) continue;
    const tagArray = rest.match(/\{\s*tag\s*:\s*\[([^\]]*)\]/);
    decls.push({
      title: title[2] ?? '',
      optionTags: tagArray ? tagArray[1] : '',
      index: match.index,
    });
  }
  return decls;
}

/**
 * Finds every `test.describe.serial(...)` block with its title and the character
 * range it spans. Brace depth is tracked through NESTED describes —
 * navigation.spec.ts:232 contains a nested test.describe at :235, so stopping
 * at the first closing brace would truncate the block.
 */
export function findSerialBlocks(source) {
  const clean = stripComments(source);
  const blocks = [];

  // FILE-LEVEL self-serialization: `test.describe.configure({ mode: 'serial' })`
  // applies serial mode to the whole file rather than a named block, and it is
  // as common in this repo as describe.serial. AC1's wording is "uses
  // test.describe.serial(...) OR OTHERWISE SELF-SERIALIZES", so missing this
  // form would leave the invariant half-enforced — pipeline-stages.spec.ts
  // self-serializes this way with a comment saying it "mutates shared global
  // state (sort_order column)", untagged and unregistered. (MINCRM-705)
  if (/test\.describe\.configure\s*\(\s*\{[^}]*mode:\s*['"]serial['"]/.test(clean)) {
    blocks.push({ title: FILE_LEVEL_SERIAL_BLOCK, start: -1, end: clean.length });
  }

  const open = /test\.describe\.serial\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

  let match;
  while ((match = open.exec(clean)) !== null) {
    // Skip an options object between the title and the callback —
    // `test.describe.serial('t', { tag: [...] }, () => {...})`. Taking the first
    // brace after the title lands on THAT object, so the block range would end
    // at its close and every test in the real body would fall outside it,
    // reporting a correctly-tagged file as a violation. Same hazard, same fix as
    // the parameter-list skip in deriveMutatingWrappers.
    let i = clean.indexOf('{', match.index);
    const arrow = clean.indexOf('=>', match.index);
    if (i !== -1 && arrow !== -1 && i < arrow) {
      let optionsDepth = 0;
      let scan = i;
      for (; scan < clean.length; scan += 1) {
        if (clean[scan] === '{') optionsDepth += 1;
        else if (clean[scan] === '}') {
          optionsDepth -= 1;
          if (optionsDepth === 0) break;
        }
      }
      i = clean.indexOf('{', scan + 1);
    }
    if (i === -1) continue;
    let depth = 0;
    let end = i;
    for (; end < clean.length; end += 1) {
      if (clean[end] === '{') depth += 1;
      else if (clean[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push({ title: match[2] ?? '', start: match.index, end });
  }
  return blocks;
}

/**
 * Returns the source of every `test.<hook>(...)` callback body in a file.
 *
 * Used to verify that cleanup actually happens INSIDE an afterEach rather than
 * merely that the file mentions one somewhere. Depth-tracked from the hook's
 * opening brace so nested blocks inside the callback do not truncate it.
 *
 * The body is located AFTER the arrow, not at the first `{`: these callbacks
 * take a destructured fixture parameter — `async ({ restClient }) => { ... }` —
 * whose own braces come first. Taking the first brace captures the parameter
 * list instead of the body, which reads as "this hook does nothing".
 */
export function extractHookBodies(source, hookName) {
  const bodies = [];
  const hook = new RegExp(`test\\.${hookName}\\s*\\(`, 'g');

  let match;
  while ((match = hook.exec(source)) !== null) {
    const arrow = source.indexOf('=>', match.index);
    if (arrow === -1) continue;
    const brace = source.indexOf('{', arrow);
    if (brace === -1) continue;
    let depth = 0;
    let end = brace;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(source.slice(brace, end + 1));
  }
  return bodies;
}

const hasSerialInTitle = (decl) => decl.title.includes('@serial');
const hasSerialInOptions = (decl) => decl.optionTags.includes('@serial');

function collectSpecFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectSpecFiles(full));
    else if (entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * Scans one spec file for both invariants. `wrappers` is the derived set of
 * mutating behavior-function names.
 */
export function scanSpec(displayPath, source, wrappers) {
  const findings = [];
  const clean = stripComments(source);
  const decls = findTestDeclarations(source);

  // ---- Invariant B: every serial block needs a tagged test or an entry.
  for (const block of findSerialBlocks(source)) {
    const inBlock = decls.filter((d) => d.index > block.start && d.index < block.end);
    if (inBlock.some(hasSerialInTitle)) continue;

    const allowed = SELF_SERIAL_ALLOWLIST.find(
      (a) => a.file === displayPath && a.block === block.title,
    );
    if (allowed) {
      if (!ALLOWED_REASONS.has(allowed.reason)) {
        findings.push(
          `  ${displayPath}\n    allow-list entry for "${block.title}" has unrecognized reason "${allowed.reason}".`,
        );
      }
      continue;
    }

    // An options-only tag satisfies intent but is invisible to the scheduler.
    const optionsOnly = inBlock.some(hasSerialInOptions);
    const where =
      block.title === FILE_LEVEL_SERIAL_BLOCK
        ? "test.describe.configure({ mode: 'serial' }) serializes this file"
        : `test.describe.serial("${block.title}")`;
    findings.push(
      optionsOnly
        ? `  ${displayPath}\n    ${where} but tags @serial ONLY via the options object.\n    gen-conflict-group-configs.ts and CI both match TITLES, so the file is still\n    scheduled in the parallel matrix. Add @serial to each test's title too.`
        : `  ${displayPath}\n    ${where}, but no test is tagged @serial and it is not allow-listed.\n    Self-serialization orders tests within the file only — it gives no cross-file\n    protection. Tag + register the file, or allow-list it with a reason.`,
    );
  }

  // ---- Invariant A: mutating wrapper calls require cleanup + @serial.
  if (MUTATION_EXEMPT.some((e) => e.file === displayPath)) return findings;

  // A wrapper counts as called only where the spec passes a NON-reset argument.
  // leads.spec.ts calls setSystemDefaultLanguage(restClient, 'en') in beforeEach
  // — a reset to the value every other spec also resets to, which cannot change
  // what another test observes.
  // DIRECT calls, not just behavior wrappers. The bash version this replaced
  // carried endpoint patterns (restClient.patch(.*settings, .../settings/sso …)
  // alongside its wrapper names; the rewrite replaced the wrapper half with
  // derivation and dropped the other half, so a spec mutating a singleton with
  // an inline REST call became invisible. 22 such call sites exist today — all
  // in files that happen to be @serial already, so nothing escaped, but the next
  // one would have. Same two regexes the derivation uses, applied to the spec.
  const directMutations = clean
    .split(/(?=restClient\s*\.)/)
    .filter((chunk) => {
      if (!MUTATING_CALL.test(chunk)) return false;
      const head = chunk.slice(0, 400);
      if (!SHARED_ENDPOINT.test(head) || RESET_ARGUMENT.test(head)) return false;
      // A DELETE of an INTERPOLATED id is teardown of a record this spec
      // created, not a write to a shared singleton — stage-exit-requirements.ts
      // deletes the pipeline stage it made two lines earlier. The singleton
      // endpoints this guard cares about are fixed paths; an ${id} in the path
      // means the target is per-record.
      if (/restClient\s*\.\s*delete\s*(?:<[^>]*>)?\s*\(\s*`[^`]*\$\{/.test(head)) return false;
      return true;
    })
    .map((chunk) => {
      const endpoint = chunk.match(/\/api\/v1\/[A-Za-z0-9/_-]+/);
      return endpoint ? endpoint[0] : 'a shared settings endpoint';
    });

  const called = wrappers.mutating.filter((name) => {
    if (wrappers.alwaysReset.includes(name)) return false;
    // Calling the prescribed cleanup helper is not a mutation — see
    // RESET_HELPER_NAME.
    if (RESET_HELPER_NAME.test(name)) return false;
    const site = new RegExp(`\\b${name}\\s*\\(([^;]*)`, 'g');
    let m;
    while ((m = site.exec(clean)) !== null) {
      if (!RESET_ARGUMENT.test(`(${m[1]}`)) return true;
    }
    return false;
  });
  // Both routes to a mutation feed one set of checks below.
  const mutationSources = [...called, ...new Set(directMutations)];
  if (mutationSources.length === 0) return findings;

  // Cleanup may be ensureSystemDefaults or a domain-specific reset. The domain
  // forms are real and varied — resetAiFieldExclusion, resetAiCostRates,
  // resetVisibilitySettings — so matching only `reset*Settings` reports
  // correctly-cleaned files (ai-field-exclusions, ai-usage-dashboard) as
  // defects.
  //
  // A BARE `test.afterEach(` is deliberately NOT accepted — that would reduce
  // this invariant to a syntax-presence check, satisfied by an empty hook or one
  // that only tears down test data.
  //
  // But restoration does not always go through a `reset*`-named helper:
  // feature-flags.spec.ts restores by calling updateFeatureFlag() with default
  // values inside its afterEach, and the ai/ specs re-call setAiEnabled() there.
  // Requiring a name-shaped helper would report all nine as defects. So the rule
  // is "the afterEach BODY calls something that writes a shared setting" —
  // restoration by any means, verified by inspecting the hook rather than
  // trusting its presence.
  // Helpers defined IN THIS FILE whose own body writes a shared endpoint.
  // mfa.spec.ts's resetMfaRequired() is exactly this: a local function doing the
  // real restore, called from a finally. Accepting it by NAME alone would be
  // fail-open (clearCookies would qualify); accepting it because its body
  // provably writes the endpoint is not.
  const localRestorers = [...clean.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => {
      const bodyStart = clean.indexOf('{', match.index + match[0].length - 1);
      if (bodyStart === -1) return null;
      let depth = 0;
      let end = bodyStart;
      for (; end < clean.length; end += 1) {
        if (clean[end] === '{') depth += 1;
        else if (clean[end] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const body = clean.slice(bodyStart, end + 1);
      return MUTATING_CALL.test(body) && SHARED_ENDPOINT.test(body) ? match[1] : null;
    })
    .filter((name) => name !== null);

  const afterEachBodies = extractHookBodies(clean, 'afterEach');
  /**
   * Does this block actually RESTORE a shared setting?
   *
   * A name-shaped match alone is not enough, and accepting one is fail-OPEN:
   * clearCookies(), clearFilters() and resetPassword() all exist in this suite
   * and restore nothing, so a spec could satisfy the cleanup requirement with a
   * helper that never touches a settings row — the exact escape this guard
   * exists to close. The callee must be either ensureSystemDefaults, a DERIVED
   * mutating wrapper (which by construction writes a shared endpoint), or a
   * direct REST write to one.
   *
   * The direct-write arm matters: pipeline-stages.spec.ts PUTs back the order it
   * captured in beforeEach, and mfa.spec.ts PATCHes mfa_required to false —
   * neither goes through a named helper.
   */
  const restoresSharedState = (body) =>
    /\bensureSystemDefaults\s*\(/.test(body) ||
    wrappers.mutating.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(body)) ||
    localRestorers.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(body)) ||
    (MUTATING_CALL.test(body) && SHARED_ENDPOINT.test(body));

  const restoresInAfterEach = afterEachBodies.some(restoresSharedState);

  // Restricted to hook bodies. Scanning the whole file would accept unrelated
  // helpers that merely match the name shape — clearCookies(), clearFilters(),
  // resetPassword() all appear in test BODIES in this suite — which would
  // reduce the check to "the file mentions something reset-ish somewhere".
  const beforeEachBodies = extractHookBodies(clean, 'beforeEach');
  const hookBodies = [...beforeEachBodies, ...afterEachBodies].join('\n');
  // A `finally` block is cleanup too, and is how several specs restore a
  // setting they changed for one test only — deal-health-check.spec.ts sets the
  // visibility policy, then calls resetVisibilitySettings() in a finally rather
  // than an afterEach, so the reset runs even when the assertion throws. Scoping
  // recognition to hooks alone would report it as uncleaned while it cleans up
  // correctly.
  const finallyBlocks = clean.match(/\bfinally\s*\{[\s\S]{0,600}?\}/g) ?? [];
  const restoresInFinally = finallyBlocks.some(restoresSharedState);

  const hasCleanup = restoresSharedState(hookBodies) || restoresInAfterEach || restoresInFinally;

  if (!hasCleanup) {
    findings.push(
      `  ${displayPath}\n    mutates shared settings via ${mutationSources.join(', ')} but never calls ensureSystemDefaults().\n    Add beforeEach/afterEach calling ensureSystemDefaults(restClient).`,
    );
    return findings;
  }

  // KNOWN LIMIT, stated so it is not mistaken for coverage: this check is
  // FILE-level, unlike Invariant B which is per-block. A file where one test is
  // tagged and a DIFFERENT, untagged test performs the mutation satisfies this
  // and still runs the mutating test in the parallel matrix.
  //
  // Closing it needs per-test attribution — mapping each mutating call site to
  // its enclosing test body — which is a materially larger change than the
  // block-scoping Invariant B needed, and no instance exists in the tree today
  // (verified: every file reported by this guard has its mutation and its tags
  // on the same tests). Left file-level deliberately rather than silently.
  if (!decls.some(hasSerialInTitle)) {
    const optionsOnly = decls.some(hasSerialInOptions);
    findings.push(
      optionsOnly
        ? `  ${displayPath}\n    mutates shared settings via ${mutationSources.join(', ')} and tags @serial ONLY via the options object.\n    Add @serial to the test titles so the scheduler can see it.`
        : `  ${displayPath}\n    mutates shared settings via ${mutationSources.join(', ')} but no test is tagged @serial.\n    Add @serial to the title of every mutating test, then add a RESOURCE_REGISTRY entry.`,
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
if (process.argv[2] === '--self-test') {
  const BEHAVIORS = `
export async function setOnboardingCompleted(restClient, completed) {
  await restClient.put('/api/v1/settings/onboarding', { onboarding_completed: completed });
}
export async function setAiEnabled(restClient, enabled) {
  await restClient.patch('/api/v1/admin/ai/master-toggle', { enabled });
}
export async function setNavLayoutViaAPI(layout, restClient) {
  await restClient.patch('/api/v1/settings/nav-layout', { layout });
}
export async function resetToTopNav(restClient) {
  await restClient.patch('/api/v1/settings/nav-layout', { layout: 'top' });
}
export async function ensureSystemDefaults(restClient) {
  await restClient.patch('/api/v1/settings/nav-layout', { layout: 'top' });
  await restClient.delete('/api/v1/settings/branding');
}
export async function setUserLanguage(restClient, language) {
  await restClient.patch('/api/v1/users/me/language', { language });
}
export async function setSystemDefaultLanguage(restClient, language) {
  await restClient.patch('/api/v1/settings/default-language', { language });
}
export async function resetAiFieldExclusion(restClient, entity, field) {
  await restClient.delete(\`/api/v1/admin/ai/field-exclusions/\${entity}/\${field}\`);
}
export async function updateFeatureFlag(
  restClient: RestClient,
  key: string,
  patch: {
    enabled: boolean;
    role_overrides?: Record<string, boolean> | null;
    enable_at?: string | null;
  },
): Promise<TestFeatureFlag> {
  const res = await restClient.patch(\`/api/v1/admin/feature-flags/\${key}\`, patch);
  return res.body;
}
export async function resetAiSettings(restClient) {
  await restClient.patch('/api/v1/admin/ai/master-toggle', { enabled: false });
}
`;
  const derived = deriveMutatingWrappers(BEHAVIORS);
  const wrappers = derived;
  const expectWrappers = [
    'setOnboardingCompleted',
    // Returns a body, so the call carries a generic parameter. A pattern that
    // does not tolerate `<T>` skips it — the data-hygiene miss.
    'setAiEnabled',
    'setNavLayoutViaAPI',
    // Generic in its argument: a mutation or a reset depending on the call site.
    'setSystemDefaultLanguage',
    'resetAiFieldExclusion',
    // Reset helpers still WRITE a shared endpoint, so the derivation lists them.
    // They are neutralized at the call site (RESET_ARGUMENT) or by counting as
    // cleanup, not by being excluded from the derived set — judging reset-ness
    // from a wrapper's own body cannot work for a wrapper whose argument decides
    // it.
    'resetToTopNav',
    'ensureSystemDefaults',
    // Inline object type in the parameter list — the shape that made three real
    // feature-flag wrappers invisible until the body extractor learned to skip
    // past the balanced parameter list.
    'updateFeatureFlag',
    'resetAiSettings',
  ];
  const missing = expectWrappers.filter((w) => !derived.mutating.includes(w));
  const extra = derived.mutating.filter((w) => !expectWrappers.includes(w));
  // resetAiSettings and ensureSystemDefaults are deliberately ABSENT. Neither is
  // classifiable by body inspection alone: resetAiSettings writes an explicit
  // default payload (`{ enabled: false }`) rather than a bare literal, and
  // ensureSystemDefaults DELETEs fixed singleton paths — which no longer count
  // as an automatic reset, because a fixed-path DELETE of a settings row is a
  // mutation in the general case (only an interpolated per-record path is
  // inherently teardown). Both are neutralized by RESET_HELPER_NAME at the call
  // site instead, which is exactly why that second mechanism exists; the
  // "calling only the cleanup helper" and "domain reset helper alone" cases
  // above pin the behaviour that matters.
  const expectAlwaysReset = ['resetToTopNav', 'resetAiFieldExclusion'];
  const resetMismatch =
    JSON.stringify([...derived.alwaysReset].sort()) !== JSON.stringify([...expectAlwaysReset].sort());

  const cases = [
    {
      name: 'untagged serial block (the onboarding shape)',
      path: 'apps/minicrm/functional/x/x.spec.ts',
      src: `test.describe.serial('Onboarding', () => {
        test('@functional F-OB1: widget shows', async () => {});
      });`,
      expect: 1,
    },
    {
      name: 'two blocks, only one tagged (the notifications shape)',
      path: 'apps/minicrm/functional/y/y.spec.ts',
      src: `test.describe.serial('Untagged block', () => {
        test('@functional A1: thing', async () => {});
      });
      test.describe.serial('Tagged block', () => {
        test('@functional @serial A2: thing', async () => {});
      });`,
      expect: 1,
    },
    {
      name: 'nested describe inside a tagged serial block',
      path: 'apps/minicrm/functional/z/z.spec.ts',
      src: `test.describe.serial('Layout-mutating tests', () => {
        test.describe('Top Nav layout', () => {
          test('@functional @serial N1: thing', async () => {});
        });
      });`,
      expect: 0,
    },
    {
      name: 'options-object-only @serial tag is reported',
      path: 'apps/minicrm/functional/o/o.spec.ts',
      src: `test.describe.serial('Opts', () => {
        test('A1: thing', { tag: ['@functional', '@serial'] }, async () => {});
      });`,
      expect: 1,
    },
    {
      name: 'multiline test declaration is seen',
      path: 'apps/minicrm/functional/m/m.spec.ts',
      src: `test.describe.serial('Multi', () => {
        test(
          'F-AI-UD-6: persists rates @functional @serial',
          { tag: ['@functional', '@serial'] },
          async () => {},
        );
      });`,
      expect: 0,
    },
    {
      name: 'mutation via wrapper, cleanup present, untagged (the data-hygiene shape)',
      path: 'apps/minicrm/functional/d/d.spec.ts',
      src: `await ensureSystemDefaults(restClient);
      test('@functional D1: thing', async () => { await setAiEnabled(restClient, true); });`,
      expect: 1,
    },
    {
      name: 'mutation via wrapper with no cleanup',
      path: 'apps/minicrm/functional/n/n.spec.ts',
      src: `test('@functional N1: thing', async () => { await setNavLayoutViaAPI('left', restClient); });`,
      expect: 1,
    },
    {
      name: 'mutation via wrapper, cleanup + @serial (correct file)',
      path: 'apps/minicrm/functional/g/g.spec.ts',
      src: `test.beforeEach(async ({ restClient }) => { await ensureSystemDefaults(restClient); });
      test('@functional @serial G1: thing', async () => { await setAiEnabled(restClient, true); });`,
      expect: 0,
    },
    {
      name: 'reset-to-default wrapper is not a mutation',
      path: 'apps/minicrm/functional/r/r.spec.ts',
      src: `test('@functional R1: thing', async () => { await resetToTopNav(restClient); });`,
      expect: 0,
    },
    {
      name: "reset ARGUMENT at the call site is not a mutation (the leads shape)",
      path: 'apps/minicrm/functional/l/l.spec.ts',
      src: `test.beforeEach(async ({ restClient }) => {
        await setSystemDefaultLanguage(restClient, 'en').catch(() => null);
      });
      test('@functional L1: thing', async () => {});`,
      expect: 0,
    },
    {
      name: 'reset literal FIRST in the arg list (the accessibility shape)',
      path: 'apps/minicrm/functional/a11y/a11y.spec.ts',
      src: `test('@functional @serial A11Y-N1: thing', async () => {
        await setNavLayoutViaAPI('top', restClient);
      });`,
      expect: 0,
    },
    {
      name: 'non-reset argument first IS a mutation',
      path: 'apps/minicrm/functional/a11y2/a11y2.spec.ts',
      src: `test('@functional A2: thing', async () => {
        await setNavLayoutViaAPI('hamburger', restClient);
      });`,
      expect: 1,
    },
    {
      name: 'non-reset argument to the same wrapper IS a mutation',
      path: 'apps/minicrm/functional/l2/l2.spec.ts',
      src: `test('@functional L2: thing', async () => {
        await setSystemDefaultLanguage(restClient, 'es');
      });`,
      expect: 1,
    },
    {
      name: 'generic type parameter does not hide the call (the data-hygiene shape)',
      path: 'apps/minicrm/functional/dh/dh.spec.ts',
      src: `test.afterEach(async ({ restClient }) => { await resetAiSettings(restClient); });
      test('@functional DH1: thing', async () => { await setAiEnabled(restClient, true); });`,
      expect: 1,
    },
    {
      name: 'domain-specific reset counts as cleanup (the ai-field-exclusions shape)',
      path: 'apps/minicrm/functional/fe/fe.spec.ts',
      src: `test.afterEach(async ({ restClient }) => {
        await resetAiFieldExclusion(restClient, 'contact', 'department');
      });
      test('F-AI-FE-1: thing @functional @serial', { tag: ['@functional', '@serial'] }, async () => {
        await setAiEnabled(restClient, true);
      });`,
      expect: 0,
    },
    {
      name: 'calling only the cleanup helper does NOT require @serial',
      path: 'apps/minicrm/functional/cl/cl.spec.ts',
      src: `test.afterEach(async ({ restClient }) => { await ensureSystemDefaults(restClient); });
      test('@functional CL1: read-only assertion', async () => {});`,
      expect: 0,
    },
    {
      name: 'a domain reset helper alone does NOT require @serial',
      path: 'apps/minicrm/functional/cl2/cl2.spec.ts',
      src: `test.afterEach(async ({ restClient }) => { await resetAiSettings(restClient); });
      test('@functional CL2: read-only assertion', async () => {});`,
      expect: 0,
    },
    {
      name: 'a reset literal elsewhere in the arg list does NOT exempt a mutation',
      path: 'apps/minicrm/functional/rl/rl.spec.ts',
      src: `test('@functional RL1: thing', async () => {
        await setSystemDefaultLanguage(restClient, 'es', { fallback: 'en' });
      });`,
      expect: 1,
    },
    {
      name: 'an unrelated clear*() in a test body is NOT cleanup',
      path: 'apps/minicrm/functional/cb/cb.spec.ts',
      src: `test.afterEach(async () => { /* nothing */ });
      test('@functional @serial CB1: thing', async ({ page, restClient }) => {
        await clearFilters({ page });
        await setAiEnabled(restClient, true);
      });`,
      expect: 1,
    },
    {
      name: 'a no-op clear*() in a hook does NOT satisfy cleanup (fail-open guard)',
      path: 'apps/minicrm/functional/fo/fo.spec.ts',
      src: `test.beforeEach(async ({ page }) => { await clearCookies({ page }); });
      test('@functional @serial FO1: thing', async ({ restClient }) => {
        await setAiEnabled(restClient, true);
      });`,
      expect: 1,
    },
    {
      name: 'a LOCAL helper whose body restores the endpoint DOES satisfy cleanup',
      path: 'apps/minicrm/functional/lr/lr.spec.ts',
      src: `async function resetTheThing(restClient) {
        await restClient.patch('/api/v1/settings/mfa-required', { mfa_required: false });
      }
      test('@functional @serial LR1: thing', async ({ restClient }) => {
        try {
          await setAiEnabled(restClient, true);
        } finally {
          await resetTheThing(restClient);
        }
      });`,
      expect: 0,
    },
    {
      name: 'a bare afterEach does NOT satisfy the cleanup requirement',
      path: 'apps/minicrm/functional/be/be.spec.ts',
      src: `test.afterEach(async () => { /* tears down test data only */ });
      test('@functional @serial BE1: thing', async () => {
        await setAiEnabled(restClient, true);
      });`,
      expect: 1,
    },
    {
      name: 'describe.serial with an options object is parsed correctly',
      path: 'apps/minicrm/functional/opt/opt.spec.ts',
      src: `test.describe.serial('Block', { tag: ['@functional'] }, () => {
        test('@functional @serial OPT1: thing', async () => {});
      });`,
      expect: 0,
    },
    {
      name: "describe.configure({ mode: 'serial' }) untagged is caught (pipeline-stages shape)",
      path: 'apps/minicrm/functional/ps/ps.spec.ts',
      src: `test.describe.configure({ mode: 'serial' });
      test('@functional PS1: reorders stages', async () => {});`,
      expect: 1,
    },
    {
      name: "describe.configure serial WITH a title tag passes",
      path: 'apps/minicrm/functional/ps2/ps2.spec.ts',
      src: `test.describe.configure({ mode: 'serial' });
      test('@functional @serial PS2: reorders stages', async () => {});`,
      expect: 0,
    },
    {
      name: 'describe.configure with a non-serial mode is not a serial block',
      path: 'apps/minicrm/functional/ps3/ps3.spec.ts',
      src: `test.describe.configure({ mode: 'parallel' });
      test('@functional PS3: thing', async () => {});`,
      expect: 0,
    },
    {
      name: 'UI-driven mutator is caught even with no restClient call',
      path: 'apps/minicrm/functional/ui/ui.spec.ts',
      src: `test('@functional UI1: switches layout via the admin UI', async ({ page }) => {
        await setNavLayoutViaUI('hamburger', { page });
      });`,
      expect: 1,
      wrappers: { mutating: ['setNavLayoutViaUI'], alwaysReset: [] },
    },
    {
      name: 'inline object type in params does not hide the mutation',
      path: 'apps/minicrm/functional/ff/ff.spec.ts',
      src: `test('@functional FF1: disables a global flag', async ({ restClient }) => {
        await updateFeatureFlag(restClient, 'mobile_access', { enabled: false });
      });`,
      expect: 1,
    },
    {
      name: 'allow-listed block passes',
      path: 'apps/minicrm/functional/concurrency/concurrency.spec.ts',
      src: `test.describe.serial('F-CC — Optimistic locking concurrency', () => {
        test('F-CC1: thing', { tag: ['@functional'] }, async () => {});
      });`,
      expect: 0,
    },
    {
      name: 'commented-out serial block is ignored',
      path: 'apps/minicrm/functional/c/c.spec.ts',
      src: `// test.describe.serial('Commented', () => {
      /* test.describe.serial('Blocked', () => {}); */
      test('@functional C1: thing', async () => {});`,
      expect: 0,
    },
  ];

  let failures = 0;
  for (const c of cases) {
    const found = scanSpec(c.path, c.src, c.wrappers ?? wrappers);
    if (found.length !== c.expect) {
      console.error(`SELF-TEST FAIL [${c.name}]: expected ${c.expect}, got ${found.length}`);
      found.forEach((f) => console.error(f));
      failures += 1;
    }
  }

  if (missing.length || extra.length) {
    console.error(
      `SELF-TEST FAIL [derivation]: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`,
    );
    failures += 1;
  }

  if (UI_DRIVEN_MUTATORS.length === 0) {
    console.error(
      'SELF-TEST FAIL [ui-driven]: UI_DRIVEN_MUTATORS is empty — UI-driven settings mutations would be invisible.',
    );
    failures += 1;
  }

  if (resetMismatch) {
    console.error(
      `SELF-TEST FAIL [alwaysReset]: expected ${JSON.stringify(expectAlwaysReset.sort())}, got ${JSON.stringify([...derived.alwaysReset].sort())}`,
    );
    failures += 1;
  }

  if (failures > 0) {
    console.error(`SELF-TEST FAIL: ${failures} case(s) failed.`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASS: ${cases.length} scanner cases + wrapper derivation.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
//
// Guarded so importing this module for a unit test does not run the scan and
// process.exit() out of the test worker — the same reasoning as
// build-conflict-graph.ts's `require.main === module` guard.
// ---------------------------------------------------------------------------
const INVOKED_DIRECTLY = Boolean(
  process.argv[1] && process.argv[1].endsWith('check-settings-mutations.mjs'),
);

function main() {
  const behaviorsDir = join(SCRIPT_DIR, '..', 'e2e', 'behaviors', 'minicrm');
  const testsDir = join(SCRIPT_DIR, '..', 'e2e', 'tests');

  const derivations = readdirSync(behaviorsDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => deriveMutatingWrappers(readFileSync(join(behaviorsDir, f), 'utf8')));

  const wrappers = {
    mutating: [...new Set([...derivations.flatMap((d) => d.mutating), ...UI_DRIVEN_MUTATORS])],
    alwaysReset: [...new Set(derivations.flatMap((d) => d.alwaysReset))],
  };

  // A UI-driven mutator that no longer exists in the behavior layer means the list
  // has gone stale through a rename, and stale entries here are silent coverage
  // loss — the failure mode this whole guard exists to prevent.
  const behaviorSource = readdirSync(behaviorsDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(behaviorsDir, f), 'utf8'))
    .join('\n');
  const staleUiMutators = UI_DRIVEN_MUTATORS.filter(
    (name) => !new RegExp(`export\\s+async\\s+function\\s+${name}\\b`).test(behaviorSource),
  );
  // An allow-list entry naming a file that no longer exists silently never
  // matches — so it stops documenting anything while still reading like a
  // considered decision. Same staleness hazard as UI_DRIVEN_MUTATORS below.
  //
  // Only file existence is checked, deliberately. A RENAMED block needs no check
  // here because it fails safe on its own: the entry stops matching, so the
  // block is reported as unallow-listed and the operator is told. It is the
  // missing FILE that is silent, because there is then no block to report.
  const staleAllowlist = [...SELF_SERIAL_ALLOWLIST, ...MUTATION_EXEMPT].filter(
    (entry) => !existsSync(join(testsDir, entry.file)),
  );

  // Both lists carry a `reason`; both are held to the same vocabulary. An
  // unrecognised reason means an exemption was added without one of the verified
  // justifications, which is the shape this guard exists to make impossible.
  const badReasons = [...SELF_SERIAL_ALLOWLIST, ...MUTATION_EXEMPT].filter(
    (entry) => !ALLOWED_REASONS.has(entry.reason),
  );
  if (badReasons.length > 0) {
    console.error(
      `FAIL: allow-list entr(ies) with an unrecognised reason: ${badReasons
        .map((e) => `${e.file} (${e.reason})`)
        .join(', ')}.`,
    );
    console.error(`Accepted reasons: ${[...ALLOWED_REASONS].join(', ')}.`);
    process.exit(1);
  }
  if (staleAllowlist.length > 0) {
    console.error(
      `FAIL: SELF_SERIAL_ALLOWLIST names file(s) that no longer exist: ${staleAllowlist
        .map((e) => e.file)
        .join(', ')}.`,
    );
    console.error('Update the paths, or drop the entries if the specs are gone.');
    process.exit(1);
  }

  if (staleUiMutators.length > 0) {
    console.error(
      `FAIL: UI_DRIVEN_MUTATORS names no-longer-exported function(s): ${staleUiMutators.join(', ')}.`,
    );
    console.error('Rename them in the list, or remove them if the behavior is gone.');
    process.exit(1);
  }

  if (wrappers.mutating.length === 0) {
    // A derivation that returns nothing would pass every spec silently — the
    // exact failure mode this guard's --self-test exists to prevent.
    console.error('FAIL: derived zero mutating behavior wrappers — the derivation is broken.');
    process.exit(1);
  }

  const findings = collectSpecFiles(testsDir).flatMap((file) =>
    scanSpec(relative(testsDir, file), readFileSync(file, 'utf8'), wrappers),
  );

  if (findings.length > 0) {
    findings.forEach((f) => {
      console.log(f);
      console.log('');
    });
    console.log(`FAIL: ${findings.length} spec file issue(s).`);
    console.log('See MINCRM-358, MINCRM-552 and MINCRM-705, and docs/dev/e2e-authoring.md.');
    process.exit(1);
  }

  console.log(
    `PASS: settings mutations are tagged and cleaned up; every describe.serial block is tagged or allow-listed (${wrappers.mutating.length} mutating wrappers derived + ${UI_DRIVEN_MUTATORS.length} UI-driven, ${wrappers.alwaysReset.length} reset-only).`,
  );
}

if (INVOKED_DIRECTLY) {
  main();
}
