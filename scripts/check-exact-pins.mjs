#!/usr/bin/env node
/**
 * Fails when a workspace manifest declares a dependency by range instead of an exact version.
 *
 * Exact pins make the manifest say what is installed, so every bump is a reviewable diff
 * (docs/dev/dependencies.md, "Exact pins"). `.npmrc` sets `save-exact`, which covers
 * `npm install <pkg>`; this catches a hand-edited range and anything the flag misses.
 *
 * Exempt: `//`-prefixed comment keys, local paths (`workspace:`, `file:`, `link:`), and `*`
 * only when it names a workspace sibling. An `npm:` alias passes when its version is exact.
 *
 * Run: node scripts/check-exact-pins.mjs [--self-test]
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];
/** An exact version: no range operator, no wildcard, no tag. */
export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LOCAL_PATH = /^(workspace:|file:|link:)/;
const NPM_ALIAS = /^npm:(?:@[^/@]+\/)?[^@]+@(.+)$/;

/**
 * Every ranged dependency in one manifest.
 *
 * @param {Record<string, unknown>} manifest - A parsed package.json.
 * @param {string} file - Its path, for the report.
 * @param {Set<string>} workspaceNames - Package names of the repo's own workspaces.
 * @returns {{file: string, section: string, name: string, spec: string}[]} One per range.
 */
export function rangedDependencies(manifest, file, workspaceNames = new Set()) {
  const found = [];
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (name.startsWith('//') || typeof spec !== 'string') continue;
      if (LOCAL_PATH.test(spec) || EXACT_VERSION.test(spec)) continue;
      if (spec === '*' && workspaceNames.has(name)) continue;
      const alias = spec.match(NPM_ALIAS);
      if (alias && EXACT_VERSION.test(alias[1])) continue;
      found.push({ file, section, name, spec });
    }
  }
  return found;
}

/**
 * The root manifest and every workspace's, parsed. Workspaces must be literal directories.
 *
 * @param {string} root - The repository root.
 * @returns {{file: string, manifest: Record<string, unknown>}[]} One per package.json.
 */
function workspaceManifests(root = REPO_ROOT) {
  const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const globbed = (rootManifest.workspaces ?? []).filter((ws) => /[*?{[]/.test(ws));
  if (globbed.length > 0) {
    throw new Error(`workspace globs are not expanded here: ${globbed.join(', ')}`);
  }
  const files = [
    'package.json',
    ...(rootManifest.workspaces ?? []).map((ws) => `${ws}/package.json`),
  ];
  return files.map((file) => ({
    file,
    manifest: JSON.parse(readFileSync(resolve(root, file), 'utf8')),
  }));
}

function selfTest() {
  const manifest = {
    dependencies: {
      caret: '^1.2.3',
      tilde: '~1.2.3',
      floor: '>=1.2.3',
      wildcardMinor: '1.x',
      lodash: '*',
      rangedAlias: 'npm:left-pad@^1.0.0',
      exact: '1.2.3',
      prerelease: '2.0.0-rc.1',
      exactAlias: 'npm:@scope/pkg@1.2.3',
      buildMetadata: '1.2.3+build.5',
      prereleaseBuild: '1.2.3-rc.1+b',
      gitSpec: 'git+https://github.com/o/r.git#v1',
      githubShorthand: 'github:o/r',
      tarball: 'https://example.test/pkg.tgz',
      '@minicrm/shared': '*',
      '//note': 'comment keys are prose',
    },
    devDependencies: {
      tag: 'latest',
      linked: 'workspace:*',
      local: 'file:../x',
      symlinked: 'link:../y',
    },
    optionalDependencies: { optionalRange: '^4.0.0', optionalExact: '4.0.0' },
  };
  const found = rangedDependencies(manifest, 'package.json', new Set(['@minicrm/shared'])).map(
    (f) => f.name,
  );
  const want = [
    'caret',
    'tilde',
    'floor',
    'wildcardMinor',
    'lodash',
    'rangedAlias',
    'gitSpec',
    'githubShorthand',
    'tarball',
    'tag',
    'optionalRange',
  ];
  if (found.length !== want.length || want.some((name) => !found.includes(name))) {
    console.error(`SELF-TEST FAIL: flagged [${found.join(', ')}], want [${want.join(', ')}].`);
    process.exit(1);
  }
  console.log(
    `SELF-TEST PASS: ${want.length} non-exact specs flagged, including a non-workspace "*", ` +
      'git/github/tarball sources and an optional; exact, prerelease, build metadata, exact ' +
      'alias, workspace sibling "*", workspace:, file:, link: and comment entries ignored.',
  );
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const manifests = workspaceManifests();
  const workspaceNames = new Set(manifests.map(({ manifest }) => manifest.name));
  const found = manifests.flatMap(({ file, manifest }) =>
    rangedDependencies(manifest, file, workspaceNames),
  );
  if (found.length === 0) {
    console.log(`OK: every dependency in ${manifests.length} manifests is pinned exactly.`);
    return;
  }
  console.error(`${found.length} dependencies declared by range; pin each exactly:`);
  for (const f of found) console.error(`  ${f.file} ${f.section} ${f.name} ${f.spec}`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
