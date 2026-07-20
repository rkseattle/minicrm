/**
 * Backend coverage agent using Node's V8 inspector API. (MINCRM-604)
 *
 * Attaches to the running server process via the stable `node:inspector`
 * module (not `node:inspector/promises`, which is still experimental on the
 * Node versions this repo declares support for) — no source instrumentation,
 * no build step. Coverage is controlled on demand (reset/snapshot/dump)
 * while the process stays up, per MINCRM-604's "long-running web server,
 * not shutdown-based" requirement.
 *
 * V8 constraint: Profiler.takePreciseCoverage() resets accumulated call
 * counts as a side effect of reading them. There is no CDP-level
 * non-destructive read, so snapshot() is not truly non-destructive despite
 * the name — see docs/dev/coverage.md.
 */

import { Session } from 'inspector';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import logger from '../logger.js';
import type { CoverageAgent, CoverageDump, CoverageDumpFormat } from './CoverageAgent.js';
import type { CoverageGranularity } from './coverageConfig.js';
import { DumpIndex } from './dumpIndex.js';

const V8_SCRIPT_COVERAGE_FORMAT: CoverageDumpFormat = 'v8-script-coverage';

interface ScriptCoverageResult {
  result: unknown;
}

export interface NodeV8CoverageAgentOptions {
  /** Directory dumps and the index are written under. */
  dumpsRoot: string;
  /** Commit SHA to tag every dump with. */
  commitSha: string;
  /** Block/branch vs. function-only coverage detail. */
  granularity: CoverageGranularity;
}

/**
 * CoverageAgent backed by the current process's own V8 inspector session.
 * One instance should be constructed per server process.
 */
export class NodeV8CoverageAgent implements CoverageAgent {
  private readonly session = new Session();
  private readonly dumpIndex: DumpIndex;
  private started = false;

  constructor(private readonly options: NodeV8CoverageAgentOptions) {
    this.dumpIndex = new DumpIndex(options.dumpsRoot);
  }

  /** Directory this agent writes dumps and its index under. */
  get dumpsRoot(): string {
    return this.options.dumpsRoot;
  }

  /**
   * Promisified wrapper around inspector.Session#post, which is
   * callback-only on the stable (non-`/promises`) module.
   */
  private post<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.session.post(method, params, (err, result) => {
        if (err) reject(err);
        else resolve(result as T);
      });
    });
  }

  /** Enables the profiler and starts precise coverage collection. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.session.connect();
    await this.post('Profiler.enable');
    await this.post('Profiler.startPreciseCoverage', {
      callCount: true,
      detailed: this.options.granularity === 'block',
    });
    this.started = true;
    logger.info(
      { granularity: this.options.granularity },
      'NodeV8CoverageAgent: precise coverage started',
    );
  }

  /** Stops coverage collection and disconnects the inspector session. */
  async stop(): Promise<void> {
    if (!this.started) return;
    await this.post('Profiler.stopPreciseCoverage');
    this.session.disconnect();
    this.started = false;
  }

  async reset(): Promise<void> {
    this.assertStarted();
    // No non-destructive "clear" exists — reading and discarding IS the reset.
    await this.post('Profiler.takePreciseCoverage');
  }

  async snapshot(label: string): Promise<CoverageDump> {
    this.assertStarted();
    const { result } = await this.post<ScriptCoverageResult>('Profiler.takePreciseCoverage');
    return this.persist(label, result, { writeToDisk: false });
  }

  async dump(label: string): Promise<CoverageDump> {
    this.assertStarted();
    const { result } = await this.post<ScriptCoverageResult>('Profiler.takePreciseCoverage');
    return this.persist(label, result, { writeToDisk: true });
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new Error(
        'NodeV8CoverageAgent: start() must be called before reset/snapshot/dump. ' +
          'This means COVERAGE_INSTRUMENTATION was not enabled at server boot.',
      );
    }
  }

  private async persist(
    label: string,
    payload: unknown,
    { writeToDisk }: { writeToDisk: boolean },
  ): Promise<CoverageDump> {
    const dumpId = randomUUID();
    const capturedAt = new Date().toISOString();
    const relativePath = join(this.options.commitSha, `${dumpId}.json`);
    const dump: CoverageDump = {
      dumpId,
      agent: 'node-v8',
      label,
      commitSha: this.options.commitSha,
      capturedAt,
      format: V8_SCRIPT_COVERAGE_FORMAT,
      path: relativePath,
    };

    if (writeToDisk) {
      const payloadPath = join(this.options.dumpsRoot, relativePath);
      const metaPath = join(this.options.dumpsRoot, this.options.commitSha, `${dumpId}.meta.json`);
      await mkdir(dirname(payloadPath), { recursive: true });
      await writeFile(payloadPath, JSON.stringify(payload), 'utf8');
      await writeFile(metaPath, JSON.stringify(dump, null, 2), 'utf8');
      await this.dumpIndex.append(dump, metaPath);
    }

    return dump;
  }
}
