/**
 * Resolves changed source paths to the spec files that must run — TIA tier 2.
 *
 * Tier 1 selects mapped changes from the coverage map; tier 3 runs everything.
 * This is the middle: a change with no coverage attribution, but a declared
 * blast radius. Three sources, unioned:
 *
 *   1. The impact manifest — path class to scopes, the primary declaration.
 *   2. `impacts` annotations — a spec declaring blast radius its location does
 *      not imply, read statically from source.
 *   3. The directory convention — `functional:<dir>` derived by walking the
 *      tree, so a new spec is scoped correctly the day it is written.
 *
 * Annotations are read STATICALLY, with the TypeScript compiler API, because
 * selection runs before any test does: a runtime `testInfo.annotations.push`
 * would be invisible here. A regex over source is not an option either — the
 * same false-match class structuralKeyService.ts documents applies.
 *
 * Failures are loud. A scope no manifest entry declares, a scope resolving to
 * no spec file, and an `impacts` glob matching nothing all throw, because each
 * one silently selects nothing — the exact failure tier 2 exists to remove, and
 * one that looks identical to "correctly selected nothing".
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { relative, resolve as resolvePath } from 'node:path';
import * as ts from 'typescript';

import { IMPACTS_ANNOTATION } from '@minicrm/shared/testing/impactAnnotation.js';
import {
  ALL_FUNCTIONAL_SCOPE,
  declaredScopes,
  isUnmapped,
  scopesForPath,
} from './impactManifest.js';
import { globToRegExp } from './specGlob.js';

/** Playwright's functional spec root, relative to the repo root. */
const FUNCTIONAL_SPEC_DIR = 'qa/e2e/tests/apps/minicrm/functional';

/** Scope naming one functional subdirectory: `functional:contacts`. */
const DIRECTORY_SCOPE_PREFIX = 'functional:';

/**
 * The outcome of resolving a diff's changed paths.
 *
 * `fullSuite` is not "every spec file listed". `functional:*` means run
 * everything, and a targeted invocation naming every spec is a different
 * execution path from a full-suite run — only the latter carries attestation —
 * so the caller is told the mode, not handed a 98-entry list.
 */
export interface ImpactResolution {
  fullSuite: boolean;
  specFiles: string[];
  matchedScopes: string[];
}

/** A spec file and the source globs it declares itself impacted by. */
interface SpecImpacts {
  specFile: string;
  globs: string[];
}

/** Every `.spec.ts` under the functional tree, repo-root-relative. */
function discoverSpecFiles(repoRoot: string): string[] {
  const functionalDir = resolvePath(repoRoot, FUNCTIONAL_SPEC_DIR);
  if (!existsSync(functionalDir)) return [];

  const found: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolvePath(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
        found.push(relative(repoRoot, full).replace(/\\/g, '/'));
      }
    }
  }
  walk(functionalDir);
  return found;
}

/**
 * Reads the string literal from an annotation object's `description` property,
 * when its `type` is `impacts`.
 *
 * Returns null for anything not statically readable — a computed key, a
 * template with substitutions, a value behind a variable. Selection treats that
 * as "no annotation" rather than an error: a legal Playwright form must not
 * fail the run just because this reader cannot see through it.
 */
function impactsGlobFromAnnotationObject(node: ts.ObjectLiteralExpression): string | null {
  let isImpacts = false;
  let description: string | null = null;

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    const value = property.initializer;
    if (!ts.isStringLiteralLike(value)) continue;

    if (property.name.text === 'type' && value.text === IMPACTS_ANNOTATION) isImpacts = true;
    if (property.name.text === 'description') description = value.text;
  }

  return isImpacts ? description : null;
}

/** Collects `impacts` globs from an `annotation:` property value, which Playwright accepts as one object or an array. */
function impactsGlobsFromAnnotationValue(value: ts.Expression): string[] {
  const objects = ts.isArrayLiteralExpression(value)
    ? value.elements.filter(ts.isObjectLiteralExpression)
    : ts.isObjectLiteralExpression(value)
      ? [value]
      : [];
  return objects
    .map(impactsGlobFromAnnotationObject)
    .filter((glob): glob is string => glob !== null);
}

/**
 * Extracts every `impacts` glob a spec declares.
 *
 * Walks for object literals carrying an `annotation` property rather than
 * matching call signatures positionally: `test(name, details, fn)` and
 * `test.describe(name, details, fn)` both carry it, and a details object built
 * anywhere else in the file is still a declaration its author expects to count.
 */
export function extractImpactsGlobs(sourceText: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const globs: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'annotation'
        ) {
          globs.push(...impactsGlobsFromAnnotationValue(property.initializer));
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Array.from(new Set(globs));
}

/** Reads every functional spec's declared impacts. Staleness is findStaleImpactsGlobs's question, not this one's. */
function readSpecImpacts(repoRoot: string, specFiles: readonly string[]): SpecImpacts[] {
  return specFiles.map((specFile) => {
    const sourceText = readFileSync(resolvePath(repoRoot, specFile), 'utf8');
    return { specFile, globs: extractImpactsGlobs(sourceText, specFile) };
  });
}

/** `functional:<dir>` for a spec, from the directory it lives in. */
function directoryScopeOf(specFile: string): string | null {
  const withinFunctional = specFile.startsWith(`${FUNCTIONAL_SPEC_DIR}/`)
    ? specFile.slice(FUNCTIONAL_SPEC_DIR.length + 1)
    : null;
  const directory = withinFunctional?.split('/')[0];
  return directory ? `${DIRECTORY_SCOPE_PREFIX}${directory}` : null;
}

/**
 * Resolves a diff's changed paths to the spec files tier 2 says must run.
 *
 * @param changedPaths - Repo-root-relative paths from the diff.
 * @param repoRoot - Repo root, for reading spec source and walking the tree.
 * @throws When a changed path is unmapped, a manifest scope is undeclared, or a
 *   scope resolves to no spec file — each selects nothing, silently.
 */
export function resolveImpactedSpecs(
  changedPaths: readonly string[],
  repoRoot: string,
): ImpactResolution {
  const unmapped = changedPaths.filter(isUnmapped);
  if (unmapped.length > 0) {
    throw new Error(
      `No impact-manifest entry covers: ${unmapped.join(', ')}. An unmapped path selects ` +
        'nothing, which is indistinguishable from correctly selecting nothing — add a ' +
        'covered glob or declare the class uncovered.',
    );
  }

  const matchedScopes = Array.from(new Set(changedPaths.flatMap(scopesForPath)));

  const undeclared = matchedScopes.filter((scope) => !declaredScopes().has(scope));
  if (undeclared.length > 0) {
    throw new Error(
      `Impact manifest emitted scope(s) it does not declare: ${undeclared.join(', ')}. ` +
        'A scope with no declared membership resolves to no spec file and selects nothing.',
    );
  }

  if (matchedScopes.includes(ALL_FUNCTIONAL_SCOPE)) {
    return { fullSuite: true, specFiles: [], matchedScopes };
  }

  const specFiles = discoverSpecFiles(repoRoot);
  const selected = new Set<string>();

  for (const scope of matchedScopes) {
    const matching = specFiles.filter((specFile) => directoryScopeOf(specFile) === scope);
    if (matching.length === 0) {
      throw new Error(
        `Scope "${scope}" resolves to no spec file. A scope naming a directory that no ` +
          'longer exists selects nothing, silently.',
      );
    }
    for (const specFile of matching) selected.add(specFile);
  }

  for (const { specFile, globs } of readSpecImpacts(repoRoot, specFiles)) {
    for (const glob of globs) {
      const matcher = globToRegExp(glob);
      if (changedPaths.some((changedPath) => matcher.test(changedPath))) {
        selected.add(specFile);
      }
    }
  }

  return { fullSuite: false, specFiles: Array.from(selected).sort(), matchedScopes };
}

/**
 * Every `impacts` glob in the functional tree that matches no tracked file.
 *
 * Separated from resolution because it asks a different question: resolution
 * asks what THIS diff impacts, this asks whether any declaration has gone
 * stale. A glob left behind by a file move degrades to selecting nothing, so a
 * guard checks it against the whole repo rather than one diff's paths.
 */
export function findStaleImpactsGlobs(
  repoRoot: string,
  trackedPaths: readonly string[],
): { specFile: string; glob: string }[] {
  const stale: { specFile: string; glob: string }[] = [];
  for (const { specFile, globs } of readSpecImpacts(repoRoot, discoverSpecFiles(repoRoot))) {
    for (const glob of globs) {
      const matcher = globToRegExp(glob);
      if (!trackedPaths.some((trackedPath) => matcher.test(trackedPath))) {
        stale.push({ specFile, glob });
      }
    }
  }
  return stale;
}
