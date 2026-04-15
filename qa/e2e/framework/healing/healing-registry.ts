/**
 * HealingRegistry — per-worker singleton audit log for self-healing locator events.
 *
 * Each Playwright worker writes to its own `test-results/healing-<workerId>.json`
 * to avoid cross-worker file collisions. The HealingReporter merges these at the
 * end of the run.
 *
 * MINCRM-124
 */

import fs from 'node:fs';
import path from 'node:path';

/** A single recorded heal event. */
export interface HealEvent {
  timestamp: string;
  testName: string;
  originalStrategy: LocatorStrategyRecord;
  healedStrategy: LocatorStrategyRecord;
  wasAiHeal: boolean;
}

/** Serializable summary of a strategy (no runtime objects). */
export interface LocatorStrategyRecord {
  type: string;
  value: string;
  options?: Record<string, unknown>;
  /** data-testid of the parent container, when the strategy was scoped. */
  within?: string;
}

const OUTPUT_DIR = 'test-results';

/**
 * Returns the worker-safe output file path for this process.
 * Playwright sets PW_WORKER_INDEX on each worker process.
 */
function workerFilePath(): string {
  const workerId = process.env['PW_WORKER_INDEX'] ?? '0';
  return path.join(OUTPUT_DIR, `healing-${workerId}.json`);
}

/**
 * Singleton registry scoped to the current worker process.
 * Call `HealingRegistry.instance` to obtain it.
 */
export class HealingRegistry {
  private static _instance: HealingRegistry | undefined;

  private readonly events: HealEvent[] = [];

  private constructor() {}

  /** Returns the singleton for this worker process. */
  static get instance(): HealingRegistry {
    if (!HealingRegistry._instance) {
      HealingRegistry._instance = new HealingRegistry();
    }
    return HealingRegistry._instance;
  }

  /** Number of heal events recorded so far. */
  get count(): number {
    return this.events.length;
  }

  /**
   * Records a heal event.
   *
   * @param testName - Name of the currently running test.
   * @param originalStrategy - The primary strategy that failed.
   * @param healedStrategy - The fallback strategy that resolved.
   * @param wasAiHeal - Whether this heal was performed by the AI tier (S3).
   */
  record(
    testName: string,
    originalStrategy: LocatorStrategyRecord,
    healedStrategy: LocatorStrategyRecord,
    wasAiHeal = false,
  ): void {
    this.events.push({
      timestamp: new Date().toISOString(),
      testName,
      originalStrategy,
      healedStrategy,
      wasAiHeal,
    });
  }

  /**
   * Writes all recorded events to the worker's JSON file.
   * Creates the output directory if it does not exist.
   * Safe to call multiple times — each call overwrites the file with
   * the full current event list.
   *
   * No-ops when there are no events to avoid unnecessary disk I/O.
   */
  flush(): void {
    if (this.events.length === 0) return;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      workerFilePath(),
      JSON.stringify(
        { workerId: process.env['PW_WORKER_INDEX'] ?? '0', events: this.events },
        null,
        2,
      ),
      'utf-8',
    );
  }

  /**
   * Resets the registry (used in tests only — not for production use).
   * @internal
   */
  _reset(): void {
    this.events.length = 0;
  }
}
