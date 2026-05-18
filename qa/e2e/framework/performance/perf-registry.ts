/**
 * perf-registry.ts — Per-worker singleton for accumulating PerfSamples.
 *
 * Follows the same pattern as HealingRegistry: each Playwright worker writes
 * its own perf-<workerId>.json file; PerfReporter merges them at run end.
 *
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PerfSample } from './perf-metrics.js';

const OUTPUT_DIR = 'test-results';

function workerFilePath(): string {
  const workerId = process.env['PW_WORKER_INDEX'] ?? '0';
  const shardIndex = process.env['SHARD_INDEX'];
  if (shardIndex !== undefined) {
    return path.join(OUTPUT_DIR, `perf-shard${shardIndex}-worker${workerId}.json`);
  }
  return path.join(OUTPUT_DIR, `perf-${workerId}.json`);
}

export class PerfRegistry {
  private static _instance: PerfRegistry | undefined;
  private readonly samples: PerfSample[] = [];

  private constructor() {}

  static get instance(): PerfRegistry {
    if (!PerfRegistry._instance) {
      PerfRegistry._instance = new PerfRegistry();
    }
    return PerfRegistry._instance;
  }

  get count(): number {
    return this.samples.length;
  }

  record(sample: PerfSample): void {
    this.samples.push(sample);
  }

  flush(): void {
    if (this.samples.length === 0) return;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      workerFilePath(),
      JSON.stringify(
        { workerId: process.env['PW_WORKER_INDEX'] ?? '0', samples: this.samples },
        null,
        2,
      ),
      'utf-8',
    );
  }

  /** For use in tests only. */
  _reset(): void {
    this.samples.length = 0;
  }
}
