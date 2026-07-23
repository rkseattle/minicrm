/**
 * Coverage/TIA symbolication service. (MINCRM-615)
 *
 * Resolves a raw coverage dump payload (see CoverageDump.format) back to
 * real source: file path, qualified function/method signature, and
 * branch/block identifiers — the "code side of the map" MINCRM-615
 * requires before MINCRM-614's ingestion can persist meaningful
 * coverage_units rows.
 *
 * Both supported raw formats converge on istanbul-lib-coverage's
 * FileCoverageData shape before this module's own resolution logic runs:
 *  - v8-script-coverage (backend): converted via v8-to-istanbul, which
 *    reads the actual source file at the tagged commit SHA off disk (its
 *    own conversion algorithm needs the file's text, not just offsets).
 *  - istanbul (frontend): already in this shape natively — vite-plugin-istanbul
 *    (MINCRM-605) instruments against original TS/JSX via Babel + sourcemaps,
 *    so window.__coverage__ dumps are pre-resolved to original source
 *    positions with no separate source-map resolution step needed here.
 *    (The `source-map` dependency is retained for a future dump format that
 *    is NOT pre-resolved by its instrumenter; see resolveViaSourceMap below.)
 *
 * Resolution is always anchored to the dump's own tagged commitSha — never
 * the working tree's current HEAD — mirroring coverageConfig.ts's existing
 * discipline for tagging dumps, so a coverage_units row is never
 * accidentally resolved against a different revision's source than the one
 * that actually ran.
 *
 * Unit keys (MINCRM-619): each function's qualified key is derived via
 * structuralKeyService.deriveStructuralUnitKey, keyed on the function's own
 * normalized body text rather than its declaration line number, so in-line
 * edits elsewhere in the file don't change a function's identity. Deriving
 * this requires the function's own source text, which is read directly off
 * the same resolved file path v8-to-istanbul already reads (backend path)
 * or istanbul's own FileCoverageData#path (frontend path) — see
 * readSourceTextForStructuralKey below. When source text can't be read
 * (file missing/unreadable, or a path istanbul reports that doesn't exist
 * on THIS machine — e.g. a frontend dump built on a different host), the
 * legacy name+line key is used as a graceful fallback rather than failing
 * ingestion outright; coverage counts are still valid, only identity
 * stability degrades for that one function.
 */

import { readFile, realpath } from 'fs/promises';
import { fileURLToPath } from 'url';
import { isAbsolute, join, relative } from 'path';
import v8toIstanbul from 'v8-to-istanbul';
import type { CoverageMapData, FileCoverageData, FunctionMapping } from 'istanbul-lib-coverage';
import type { Profiler } from 'inspector';
import logger from '../../logger.js';
import type { CoverageDumpSource } from '../CoverageAgent.js';
import type { NormalizedCoverageUnit, SymbolicationResult } from './normalizedCoverageUnit.js';
import { deriveStructuralUnitKey } from './structuralKeyService.js';

/** Coverage detail level a resolved unit was captured at. */
export type CoverageUnitGranularity = 'branch' | 'function';

/** Raised when a raw dump's format/agent combination is not one this service understands. */
export class UnsupportedCoverageFormatError extends Error {
  readonly code = 'UNSUPPORTED_COVERAGE_FORMAT';
  constructor(format: string) {
    super(`Symbolication does not support coverage format "${format}"`);
    this.name = 'UnsupportedCoverageFormatError';
  }
}

interface SymbolicateOptions {
  /** Repo root the dump's commitSha was checked out at, for resolving script URLs to real files. */
  sourceRoot: string;
}

/**
 * Symbolicates a raw dump payload into NormalizedCoverageUnit rows.
 *
 * @param agent - Which agent produced the dump (determines conversion path).
 * @param format - The dump's declared format (validated against `agent`, see CoverageDump).
 * @param payload - The raw payload as read off disk (parsed JSON).
 */
export async function symbolicateCoverageDump(
  agent: CoverageDumpSource,
  format: string,
  payload: unknown,
  options: SymbolicateOptions,
): Promise<SymbolicationResult> {
  if (agent === 'node-v8' && format === 'v8-script-coverage') {
    const units = await symbolicateV8ScriptCoverage(payload, options.sourceRoot);
    return { agent, units };
  }

  if (agent === 'browser-istanbul' && format === 'istanbul') {
    const units = await symbolicateIstanbulCoverageMap(payload);
    return { agent, units };
  }

  throw new UnsupportedCoverageFormatError(`${agent}/${format}`);
}

/**
 * Converts a raw Profiler.takePreciseCoverage() result array into
 * NormalizedCoverageUnit rows via v8-to-istanbul, which needs the actual
 * instrumented-free source file's text to map V8 byte offsets back to
 * statement/branch positions.
 */
async function symbolicateV8ScriptCoverage(
  payload: unknown,
  sourceRoot: string,
): Promise<NormalizedCoverageUnit[]> {
  const scripts = payload as ReadonlyArray<Profiler.ScriptCoverage>;
  const units: NormalizedCoverageUnit[] = [];

  // Resolved once, up front: every relative()/startsWith comparison below
  // must be done against the SAME (resolved) form of sourceRoot that
  // resolveScriptPath resolves each script's own path to, or a symlinked
  // source root (e.g. macOS os.tmpdir() -> /private/var/...) produces a
  // spurious long ../../.. climb instead of a clean relative path.
  let resolvedSourceRoot: string;
  try {
    resolvedSourceRoot = await realpath(sourceRoot);
  } catch {
    resolvedSourceRoot = sourceRoot;
  }

  for (const script of scripts) {
    const filePath = await resolveScriptPath(script.url, resolvedSourceRoot);
    if (!filePath) {
      // node: builtins, eval()'d code, and other non-file script origins
      // have no source to resolve against — flagged, not silently dropped.
      units.push({
        filePath: script.url,
        unitKey: 'unknown',
        branchId: null,
        granularity: 'function',
        hitCount: 0,
        resolved: false,
        unresolvedReason: `Script URL "${script.url}" does not resolve to a file under the source root`,
      });
      continue;
    }

    const converter = v8toIstanbul(filePath);
    try {
      await converter.load();
      converter.applyCoverage(script.functions);
      const coverageMap = converter.toIstanbul();
      const relativePath = relative(resolvedSourceRoot, filePath);
      units.push(...(await unitsFromFileCoverageMap(coverageMap, relativePath, filePath)));
    } catch (err) {
      logger.warn({ err, filePath }, 'coverageSymbolicationService: failed to symbolicate script');
      units.push({
        filePath: relative(resolvedSourceRoot, filePath),
        unitKey: 'unknown',
        branchId: null,
        granularity: 'function',
        hitCount: 0,
        resolved: false,
        unresolvedReason: err instanceof Error ? err.message : 'v8-to-istanbul conversion failed',
      });
    } finally {
      converter.destroy();
    }
  }

  return units;
}

/**
 * Converts a raw window.__coverage__ payload (already in istanbul-lib-coverage's
 * CoverageMapData shape, already resolved to original TS/JSX by vite-plugin-istanbul's
 * Babel + sourcemap pipeline — see module docblock) into NormalizedCoverageUnit rows.
 */
async function symbolicateIstanbulCoverageMap(payload: unknown): Promise<NormalizedCoverageUnit[]> {
  const coverageMap = payload as CoverageMapData;
  const units: NormalizedCoverageUnit[] = [];

  for (const [filePath, fileCoverage] of Object.entries(coverageMap)) {
    const data = fileCoverage as FileCoverageData;
    // istanbul's own FileCoverageData#path is the absolute path the
    // instrumenting build (vite-plugin-istanbul) recorded at build time —
    // best-effort source for structural-key derivation on this path. It may
    // not exist on THIS machine (e.g. a dump built in CI, ingested locally);
    // readSourceTextForStructuralKey below handles that by returning
    // undefined, which degrades gracefully to the legacy line-based key.
    units.push(
      ...(await unitsFromFileCoverageMap({ [filePath]: fileCoverage }, filePath, data.path)),
    );
  }

  return units;
}

/**
 * Shared conversion from istanbul-lib-coverage's per-file shape into our
 * NormalizedCoverageUnit rows — the point where both the V8 and frontend
 * paths produce an identical output shape for MINCRM-614's ingestion.
 *
 * The branch-vs-function fallback is decided PER FUNCTION, not per file: a
 * file can freely mix branching and non-branching functions (e.g. one
 * function with an `if`, another that's a straight-line getter with no
 * entry in branchMap at all). Deciding it per file would silently drop the
 * non-branching function's own hit count entirely whenever at least one
 * other function in the same file has branches — MINCRM-615's
 * "unresolvable regions flagged rather than silently dropped" AC applies
 * here too: no function's coverage should vanish just because a sibling
 * function happens to branch.
 *
 * sourcePathForKeyDerivation (MINCRM-619) is a best-effort absolute path to
 * read the file's own source text from, purely to derive each function's
 * structural (name + normalized-body-hash) key. It is independent of
 * overrideFilePath, which remains the identity stored on each unit row —
 * reading source text is allowed to fail (wrong machine, deleted file) and
 * falls back to the legacy name+line key without affecting overrideFilePath
 * or any hit-count/branch data.
 */
async function unitsFromFileCoverageMap(
  coverageMap: CoverageMapData,
  overrideFilePath: string,
  sourcePathForKeyDerivation?: string,
): Promise<NormalizedCoverageUnit[]> {
  const units: NormalizedCoverageUnit[] = [];
  const sourceText = sourcePathForKeyDerivation
    ? await readSourceTextForStructuralKey(sourcePathForKeyDerivation)
    : undefined;

  for (const fileCoverage of Object.values(coverageMap)) {
    const data = fileCoverage as FileCoverageData;

    // Branch mappings whose enclosing function has at least one branch —
    // tracked per fnKey so the function-fallback loop below can skip
    // exactly the functions already covered at branch granularity.
    const fnKeysWithBranches = new Set<string>();
    for (const [fnKey, mapping] of Object.entries(data.fnMap)) {
      const hasOwnBranch = Object.values(data.branchMap).some(
        (branchMapping) =>
          branchMapping.line >= mapping.decl.start.line &&
          branchMapping.line <= mapping.loc.end.line,
      );
      if (hasOwnBranch) {
        fnKeysWithBranches.add(fnKey);
      }
    }

    for (const [branchKey, mapping] of Object.entries(data.branchMap)) {
      const unitKey = qualifiedUnitKeyForLine(data, mapping.line, sourceText);
      const hits: number[] = data.b[branchKey] ?? [];
      hits.forEach((hitCount, branchIndex) => {
        units.push({
          filePath: overrideFilePath,
          unitKey,
          branchId: `${branchKey}:${branchIndex}`,
          granularity: 'branch',
          hitCount,
          resolved: true,
          unresolvedReason: null,
        });
      });
    }

    // Every function NOT already represented at branch granularity above —
    // either COVERAGE_GRANULARITY=function was in effect when this dump was
    // captured (branchMap is empty for the whole file), or this particular
    // function genuinely has no branching constructs of its own even though
    // other functions in the same file do.
    for (const [fnKey, mapping] of Object.entries(data.fnMap)) {
      if (fnKeysWithBranches.has(fnKey)) continue;
      units.push({
        filePath: overrideFilePath,
        unitKey: qualifiedUnitKey(mapping.name, mapping.decl.start.line, mapping.loc, sourceText),
        branchId: null,
        granularity: 'function',
        hitCount: data.f[fnKey] ?? 0,
        resolved: true,
        unresolvedReason: null,
      });
    }
  }

  return units;
}

/**
 * Reads a file's source text for structural-key derivation. Returns
 * undefined (never throws) on any failure — a missing/unreadable source
 * file degrades key derivation to the legacy name+line fallback rather than
 * failing symbolication, since the coverage data itself remains valid even
 * when structural-identity derivation isn't possible.
 */
async function readSourceTextForStructuralKey(sourcePath: string): Promise<string | undefined> {
  try {
    return await readFile(sourcePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Builds a function's qualified unit key: the structural (name +
 * normalized-body-hash) key from MINCRM-619 when source text and a body
 * range are available, falling back to the legacy `name@declLine` key
 * otherwise (source unreadable, or the range didn't extract cleanly — see
 * deriveStructuralUnitKey's own null-return contract).
 */
function qualifiedUnitKey(
  name: string,
  declLine: number,
  bodyRange: FunctionMapping['loc'] | undefined,
  sourceText: string | undefined,
): string {
  if (sourceText && bodyRange) {
    const structuralKey = deriveStructuralUnitKey(name, bodyRange, sourceText);
    if (structuralKey) {
      return structuralKey;
    }
  }
  return `${name || '<anonymous>'}@${declLine}`;
}

/** Finds the enclosing function for a branch's line and derives its qualified key. */
function qualifiedUnitKeyForLine(
  data: FileCoverageData,
  line: number,
  sourceText: string | undefined,
): string {
  for (const mapping of Object.values(data.fnMap)) {
    if (line >= mapping.decl.start.line && line <= mapping.loc.end.line) {
      return qualifiedUnitKey(mapping.name, mapping.decl.start.line, mapping.loc, sourceText);
    }
  }
  // No enclosing function found (e.g. top-level module code) — the line
  // number itself is the best available stable-ish identity.
  return `<module>@${line}`;
}

/**
 * Resolves a V8 Profiler.ScriptCoverage#url (a file:// URL for ordinary
 * source files, or a bare specifier like "node:fs"/"" for builtins and
 * eval'd code) to an absolute path under resolvedSourceRoot. Returns
 * undefined for anything that isn't a real file under the source tree.
 *
 * resolvedSourceRoot must already be realpath-resolved by the caller (see
 * symbolicateV8ScriptCoverage) — V8 reports a script's url as the
 * OS-resolved path, so comparing it against an unresolved sourceRoot (e.g.
 * macOS os.tmpdir()'s /var -> /private/var symlink) would spuriously fail
 * the startsWith check for every script under a symlinked source root.
 */
async function resolveScriptPath(
  url: string,
  resolvedSourceRoot: string,
): Promise<string | undefined> {
  if (!url.startsWith('file://')) {
    return undefined;
  }

  let filePath: string;
  try {
    filePath = fileURLToPath(url);
  } catch {
    return undefined;
  }

  const candidate = isAbsolute(filePath) ? filePath : join(resolvedSourceRoot, filePath);

  try {
    const realResolved = await realpath(candidate);
    // A plain realResolved.startsWith(resolvedSourceRoot) string check would
    // wrongly accept a sibling directory that merely shares the root as a
    // string prefix (e.g. resolvedSourceRoot "/app/repo" would incorrectly
    // "contain" "/app/repo-internal/x.js"). relative() plus an escape check
    // is the standard way to test true path containment.
    const relativePath = relative(resolvedSourceRoot, realResolved);
    const isContained =
      relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
    return isContained ? realResolved : undefined;
  } catch {
    // realpath fails if the file doesn't actually exist on disk — not a
    // symlink-resolution concern, just "this script has no real source".
    return undefined;
  }
}

/** Reads and JSON-parses a raw dump payload file. Exported for ingestion's use. */
export async function readRawDumpPayload(payloadPath: string): Promise<unknown> {
  const raw = await readFile(payloadPath, 'utf8');
  return JSON.parse(raw);
}
