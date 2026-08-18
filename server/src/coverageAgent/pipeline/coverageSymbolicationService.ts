/**
 * Coverage/TIA symbolication service.
 *
 * Resolves a raw coverage dump payload (see CoverageDump.format) back to
 * real source: file path, qualified function/method signature, and
 * branch/block identifiers — the "code side of the map"
 * requires before that change's ingestion can persist meaningful
 * coverage_units rows.
 *
 * Both supported raw formats converge on istanbul-lib-coverage's
 * FileCoverageData shape before this module's own resolution logic runs:
 *  - v8-script-coverage (backend): converted via v8-to-istanbul, which
 *    reads the actual source file at the tagged commit SHA off disk (its
 *    own conversion algorithm needs the file's text, not just offsets).
 *  - istanbul (frontend): already in this shape natively — vite-plugin-istanbul
 * instruments against original TS/JSX via Babel + sourcemaps,
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
 * Unit keys: each function's qualified key is derived via
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
import type { CoverageDumpSource } from '../sdk/CoverageAgentPlugin.js';
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
    const units = await symbolicateIstanbulCoverageMap(payload, options.sourceRoot);
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
async function symbolicateIstanbulCoverageMap(
  payload: unknown,
  sourceRoot: string,
): Promise<NormalizedCoverageUnit[]> {
  const coverageMap = payload as CoverageMapData;
  const units: NormalizedCoverageUnit[] = [];

  // Resolved once, up front — same discipline as symbolicateV8ScriptCoverage's
  // own resolvedSourceRoot: a symlinked source root (macOS os.tmpdir() ->
  // /private/var/...) must be compared against in its resolved form on both
  // sides of every relative()/containment check below, or every path under a
  // symlinked root spuriously fails containment.
  let resolvedSourceRoot: string;
  try {
    resolvedSourceRoot = await realpath(sourceRoot);
  } catch {
    resolvedSourceRoot = sourceRoot;
  }

  for (const [filePath, fileCoverage] of Object.entries(coverageMap)) {
    // A null/malformed per-file entry would otherwise crash on data.path
    // below before unitsFromFileCoverageMap's own guard for the same
    // condition ever runs — this is a separate, earlier access to the same
    // untrusted value, not a duplicate of that guard (found via a real
    // local coverage-map generation run,; see
    // unitsFromFileCoverageMap's own docblock for the full context).
    if (fileCoverage == null || typeof fileCoverage !== 'object') {
      logger.warn(
        { filePath },
        'coverageSymbolicationService: file coverage entry was null/malformed — skipping rather than failing the whole dump',
      );
      continue;
    }
    const data = fileCoverage as FileCoverageData;
    // istanbul's own FileCoverageData#path is the absolute path the
    // instrumenting build (vite-plugin-istanbul) recorded at build time.
    // Stored verbatim, this is a per-machine host path (e.g.
    // /Users/rob/dev/minicrm/client/src/...) that can never match the
    // repo-root-relative paths changeUnitResolver.ts derives from `git
    // diff` output — every findTestsForUnitAcrossBranches lookup would
    // silently return zero matches forever, degrading every PR to a
    // full-suite fallback (found via a real local coverage-map generation
    // run). Relativized against sourceRoot here, exactly
    // like symbolicateV8ScriptCoverage's own relativePath, so both agents'
    // units share one consistent, portable filePath identity. Falls back to
    // the raw path when it isn't actually under sourceRoot (a dump built on
    // a different machine and ingested elsewhere) — degraded but no longer
    // silently wrong, and readSourceTextForStructuralKey below still
    // degrades key derivation gracefully via data.path regardless.
    //
    // data.path itself must ALSO be realpath-resolved before comparison,
    // not just sourceRoot — otherwise a symlinked source root (macOS
    // os.tmpdir()'s /var -> /private/var, the exact case a real test caught,
    //) compares an unresolved path against a resolved root
    // and spuriously fails containment for every file under it. Falls back
    // to the raw (unresolved) data.path when realpath fails — a synthetic
    // path with no real file backing it on this machine at all (test
    // fixtures, or a dump built elsewhere) degrades to the same "not
    // contained" outcome the resolved comparison would have reached anyway.
    let resolvedDataPath: string;
    try {
      resolvedDataPath = await realpath(data.path);
    } catch {
      resolvedDataPath = data.path;
    }
    const isContained = isPathContainedIn(resolvedSourceRoot, resolvedDataPath);
    const overrideFilePath = isContained
      ? relative(resolvedSourceRoot, resolvedDataPath)
      : filePath;
    // An uncontained path is never repo-root-relative and so can never match
    // changeUnitResolver.ts's own lookups — flagged as unresolved rather than
    // silently stored as if resolution had succeeded, matching
    // symbolicateV8ScriptCoverage's convention for its own unresolvable case
    // (The unresolvable regions flagged rather than silently
    // dropped" AC). Coverage counts themselves are still real and valid;
    // only cross-machine path-identity resolution failed.
    const unresolvedReason = isContained
      ? undefined
      : `File path "${filePath}" is not under sourceRoot "${sourceRoot}" — likely a dump captured on a different machine`;
    units.push(
      ...(await unitsFromFileCoverageMap(
        { [filePath]: fileCoverage },
        overrideFilePath,
        data.path,
        unresolvedReason,
      )),
    );
  }

  return units;
}

/**
 * Shared conversion from istanbul-lib-coverage's per-file shape into our
 * NormalizedCoverageUnit rows — the point where both the V8 and frontend
 * paths produce an identical output shape for that work's ingestion.
 *
 * The branch-vs-function fallback is decided PER FUNCTION, not per file: a
 * file can freely mix branching and non-branching functions (e.g. one
 * function with an `if`, another that's a straight-line getter with no
 * entry in branchMap at all). Deciding it per file would silently drop the
 * non-branching function's own hit count entirely whenever at least one
 * other function in the same file has branches — 's
 * "unresolvable regions flagged rather than silently dropped" AC applies
 * here too: no function's coverage should vanish just because a sibling
 * function happens to branch.
 *
 * sourcePathForKeyDerivation is a best-effort absolute path to
 * read the file's own source text from, purely to derive each function's
 * structural (name + normalized-body-hash) key. It is independent of
 * overrideFilePath, which remains the identity stored on each unit row —
 * reading source text is allowed to fail (wrong machine, deleted file) and
 * falls back to the legacy name+line key without affecting overrideFilePath
 * or any hit-count/branch data.
 *
 * unresolvedReason: set by symbolicateIstanbulCoverageMap
 * when overrideFilePath couldn't be relativized under sourceRoot (a dump
 * captured on a different machine). Every unit still gets stored —
 * coverage_units never drops resolved=false rows, matching this module's
 * "flagged rather than silently dropped" convention — but resolved=false
 * excludes it from coverage_test_links (see coverageIngestionService's own
 * `.filter((unit) => unit.resolved)`), since an unportable path can never
 * match a repo-root-relative changeUnitResolver.ts lookup anyway; storing
 * it as if resolution had succeeded would silently misrepresent this data
 * as usable for test selection when it structurally cannot be.
 */
/**
 * Clamps a raw hit count to a valid non-negative integer, warning once per
 * call site when the input needed correcting.
 *
 * coverage_units.hit_count has a DB-level `CHECK (hit_count >= 0)` (this
 * table has no legitimate reason to record negative coverage), but nothing
 * between V8's raw Profiler.takePreciseCoverage() output and that INSERT
 * validated the value — a single corrupted/overflowed counter (observed in
 * practice: -534773760 on a hot node_modules/bcryptjs branch under heavy
 * local test-suite repetition, first-seen on that row, not accumulated) took
 * down the ENTIRE dump's ingestion with an unhandled 500, discarding every
 * other unit's real, valid coverage data in the same request. Clamping the
 * one bad unit to 0 and logging it is far preferable to an all-or-nothing
 * failure on unrelated data (found via a real local coverage-map generation
 * run).
 */
function sanitizeHitCount(
  rawHitCount: number,
  context: { filePath: string; unitKey: string },
): number {
  if (Number.isInteger(rawHitCount) && rawHitCount >= 0) return rawHitCount;
  logger.warn(
    { rawHitCount, ...context },
    'coverageSymbolicationService: raw hit count was negative or non-integer — clamped to 0 rather than failing the whole dump',
  );
  return 0;
}

async function unitsFromFileCoverageMap(
  coverageMap: CoverageMapData,
  overrideFilePath: string,
  sourcePathForKeyDerivation?: string,
  unresolvedReason?: string,
): Promise<NormalizedCoverageUnit[]> {
  const units: NormalizedCoverageUnit[] = [];
  const sourceText = sourcePathForKeyDerivation
    ? await readSourceTextForStructuralKey(sourcePathForKeyDerivation)
    : undefined;

  for (const fileCoverage of Object.values(coverageMap)) {
    const data = fileCoverage as FileCoverageData;

    // A malformed/null entry (observed in practice from v8-to-istanbul's
    // own toIstanbul() output on at least one real dump — found via a real
    // local coverage-map generation run) would otherwise
    // crash Object.entries(data.fnMap) below and take down the whole
    // dump's ingestion. Flagged and skipped, not silently dropped, matching
    // this module's existing unresolved-unit convention (see the
    // resolveScriptPath/converter.load() failure paths above).
    if (data == null || typeof data !== 'object' || data.fnMap == null || data.branchMap == null) {
      logger.warn(
        { overrideFilePath },
        'coverageSymbolicationService: file coverage entry was null/malformed — skipping rather than failing the whole dump',
      );
      continue;
    }

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
      hits.forEach((rawHitCount, branchIndex) => {
        units.push({
          filePath: overrideFilePath,
          unitKey,
          branchId: `${branchKey}:${branchIndex}`,
          granularity: 'branch',
          hitCount: sanitizeHitCount(rawHitCount, { filePath: overrideFilePath, unitKey }),
          resolved: unresolvedReason == null,
          unresolvedReason: unresolvedReason ?? null,
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
      const unitKey = qualifiedUnitKey(
        mapping.name,
        mapping.decl.start.line,
        mapping.loc,
        sourceText,
      );
      units.push({
        filePath: overrideFilePath,
        unitKey,
        branchId: null,
        granularity: 'function',
        hitCount: sanitizeHitCount(data.f[fnKey] ?? 0, { filePath: overrideFilePath, unitKey }),
        resolved: unresolvedReason == null,
        unresolvedReason: unresolvedReason ?? null,
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
 * normalized-body-hash) key from that change when source text and a body
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
/**
 * True containment test: is `candidate` equal to or strictly under `root`?
 * A plain `candidate.startsWith(root)` string check would wrongly accept a
 * sibling directory that merely shares the root as a string prefix (e.g.
 * root "/app/repo" would incorrectly "contain" "/app/repo-internal/x.js").
 * relative() plus an escape check is the standard way to test true path
 * containment. Both arguments must already be in the SAME (resolved-or-not)
 * form — callers are responsible for realpath-resolving both sides
 * consistently, or a symlinked root (macOS os.tmpdir()'s /var ->
 * /private/var) spuriously fails containment for every real match.
 */
function isPathContainedIn(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

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
    return isPathContainedIn(resolvedSourceRoot, realResolved) ? realResolved : undefined;
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
