#!/usr/bin/env node
/**
 * Reports root `overrides` pins that have a newer patched version published.
 *
 * This is the half of dependency maintenance Dependabot structurally cannot do. It bumps
 * DECLARED dependencies; an override pins a package nothing in this repo declares, so
 * there is no manifest entry for it to raise a PR against. The pins therefore go stale
 * silently, and the way that surfaces is a red audit gate — which is how five high
 * advisories and then smol-toml each arrived.
 *
 * ADVISORY, never blocking. A newer patch existing is not a defect: several pins are
 * deliberately held (adm-zip 0.6.0 is the exact floor clearing a high, and nothing above
 * it exists). Failing on drift would make the honest answer "silence the check", so it
 * reports and exits 0. The audit gate stays the thing that blocks.
 *
 * Same-major only. Crossing a major is a compatibility decision that needs a human
 * reading a changelog, not a version comparison — and npm's own `fixAvailable` has twice
 * suggested a major DOWNGRADE here (markdownlint-cli2 0.23.2 -> 0.21.0, minio -> 7.1.3).
 *
 * Run: node scripts/check-pin-drift.mjs [--json] [--self-test]
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** An exact version: no range operator, no wildcard, no tag. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Flattens the `overrides` block into one entry per pinned package.
 *
 * Nested groups (`"promptfoo": { "hono": "4.13.5" }`) scope a pin to one dependent, so
 * the same package can appear under several scopes with different versions. The scope is
 * carried through because it is what a reader needs to find the pin again.
 *
 * @param {Record<string, unknown>} overrides - The `overrides` object from package.json.
 * @returns {{name: string, version: string, scope: string|null}[]} One entry per pin.
 */
export function flattenOverrides(overrides) {
  const pins = [];
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (typeof value === 'string') {
      pins.push({ name: key, version: value, scope: null });
      continue;
    }
    if (value && typeof value === 'object') {
      for (const [nested, nestedValue] of Object.entries(value)) {
        if (typeof nestedValue === 'string') {
          pins.push({ name: nested, version: nestedValue, scope: key });
        }
      }
    }
  }
  return pins;
}

/**
 * Parses a semver triple. Returns null for anything that is not an exact version —
 * a range like `^1.2.3` is a deliberate float, not a pin, and has nothing to drift from.
 *
 * @param {string} version - Version string from the overrides block.
 * @returns {{major: number, minor: number, patch: number}|null}
 */
export function parseVersion(version) {
  if (!EXACT_VERSION.test(version)) return null;
  const [core] = version.split(/[-+]/);
  const [major, minor, patch] = core.split('.').map(Number);
  return { major, minor, patch };
}

/**
 * The newest published version sharing a pin's major, or null when the pin is current.
 *
 * Prereleases are skipped: they carry a `-` suffix, and adopting one to clear an
 * advisory trades a known problem for an unknown one.
 *
 * @param {string} pinned - The currently pinned exact version.
 * @param {string[]} published - Every version published for the package.
 * @returns {string|null} A newer same-major version, or null.
 */
export function newerSameMajor(pinned, published) {
  const current = parseVersion(pinned);
  if (!current) return null;

  let best = current;
  let bestRaw = null;
  for (const candidate of published) {
    if (candidate.includes('-')) continue;
    const parsed = parseVersion(candidate);
    if (!parsed || parsed.major !== current.major) continue;
    const newer =
      parsed.minor > best.minor || (parsed.minor === best.minor && parsed.patch > best.patch);
    if (newer) {
      best = parsed;
      bestRaw = candidate;
    }
  }
  return bestRaw;
}

/**
 * @param {string} name - Package name.
 * @returns {string[]} Published versions, or [] when the registry cannot be reached.
 */
function publishedVersions(name) {
  try {
    const out = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // A single unreachable package must not fail the whole report: this check is
    // advisory, and a registry hiccup is not a finding.
    return [];
  }
}

function selfTest() {
  const flat = flattenOverrides({
    undici: '7.29.0',
    'markdownlint-cli2': { 'js-yaml': '4.3.2', 'smol-toml': '1.7.1' },
    ignored: { nested: 42 },
  });
  if (flat.length !== 3) {
    console.error(`SELF-TEST FAIL: flattened ${flat.length} pins, want 3.`);
    process.exit(1);
  }
  const scoped = flat.find((p) => p.name === 'js-yaml');
  if (scoped?.scope !== 'markdownlint-cli2') {
    console.error(`SELF-TEST FAIL: js-yaml scope ${scoped?.scope}, want markdownlint-cli2.`);
    process.exit(1);
  }

  // Must FLAG: a newer patch and a newer minor on the same major.
  const cases = [
    ['1.7.0', ['1.6.0', '1.7.0', '1.7.1', '1.7.2'], '1.7.2'],
    ['4.3.1', ['4.3.1', '4.4.0'], '4.4.0'],
    // Must NOT flag: already newest; only a higher major exists; only a prerelease
    // is newer; a lower version is published.
    ['1.7.2', ['1.7.0', '1.7.1', '1.7.2'], null],
    ['7.29.0', ['7.29.0', '8.0.0', '8.10.2'], null],
    ['1.7.0', ['1.7.0', '1.7.1-rc.0'], null],
    ['2.0.0', ['1.9.9', '2.0.0'], null],
  ];
  let flagged = 0;
  for (const [pinned, published, want] of cases) {
    const got = newerSameMajor(pinned, published);
    if (got !== want) {
      console.error(`SELF-TEST FAIL: ${pinned} -> ${got}, want ${want}.`);
      process.exit(1);
    }
    if (got) flagged++;
  }
  if (flagged !== 2) {
    console.error(`SELF-TEST FAIL: flagged ${flagged} of 6 cases, want 2.`);
    process.exit(1);
  }

  // A range is a float, not a pin: nothing to drift from.
  if (parseVersion('^1.2.3') !== null || newerSameMajor('^1.2.3', ['1.2.4']) !== null) {
    console.error('SELF-TEST FAIL: treated a range as a pin.');
    process.exit(1);
  }

  console.log(
    'SELF-TEST PASS: 3 pins flattened (1 scoped), 2 of 6 version cases flagged, ' +
      '4 correctly ignored, ranges rejected.',
  );
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  const pins = flattenOverrides(manifest.overrides);
  const drifted = [];
  const unreachable = [];

  for (const pin of pins) {
    const published = publishedVersions(pin.name);
    if (published.length === 0) {
      unreachable.push(pin.name);
      continue;
    }
    const newer = newerSameMajor(pin.version, published);
    if (newer) drifted.push({ ...pin, latest: newer });
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ drifted, unreachable }, null, 2));
    return;
  }

  const label = (pin) => (pin.scope ? `${pin.scope} > ${pin.name}` : pin.name);
  if (drifted.length === 0) {
    console.log(`OK: all ${pins.length} override pins are at the newest same-major version.`);
  } else {
    console.log(`${drifted.length} of ${pins.length} override pins have a newer patch:\n`);
    for (const pin of drifted) {
      console.log(`  ${label(pin).padEnd(34)} ${pin.version}  ->  ${pin.latest}`);
    }
    console.log(
      '\nA newer version is not automatically the right one — several pins are held\n' +
        'deliberately. Check the advisory each pin addresses before moving it, and\n' +
        're-resolve with: rm -rf node_modules package-lock.json && npm install',
    );
  }
  if (unreachable.length > 0) {
    console.log(`\nNot checked (registry unreachable): ${unreachable.join(', ')}`);
  }
}

// Only when run directly. Importing this file must not hit the registry — the exported
// helpers above are the unit-testable surface, and a self-test that pays for a network
// scan to reach them would not get written.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
