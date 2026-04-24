/**
 * Standalone merge script for shard-aware healing artifacts.
 *
 * After downloading artifacts from all shards into a single directory, run:
 *
 *   tsx qa/scripts/merge-healing-artifacts.ts \
 *     --input ./all-healing-artifacts \
 *     --output ./healing-report.json
 *
 * Writes a zero-heal report and exits 0 if no matching healing-*.json files are found.
 * Deduplicates events where testName + originalStrategy.type + originalStrategy.value
 * are identical.
 *
 * MINCRM-216
 */

import fs from 'node:fs';
import path from 'node:path';
import type { HealEvent } from '../e2e/framework/healing/healing-registry.js';
import type { HealingReport } from '../e2e/framework/healing/healing-reporter.js';

export const HEALING_FILE_PATTERN = /^healing-.*\.json$/;

/** Recursively find all files whose names match the given pattern. */
export function findFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, pattern));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Read events from a single healing artifact file. Returns [] on error. */
export function readWorkerFile(filePath: string): HealEvent[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { events?: HealEvent[] };
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

/** Deduplicate events by testName + originalStrategy.type + originalStrategy.value. */
export function deduplicateEvents(events: HealEvent[]): HealEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.testName}::${e.originalStrategy.type}::${e.originalStrategy.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Print the same summary format as HealingReporter._logSummary(). */
export function logSummary(report: HealingReport): void {
  console.log(
    `\n[HealingReporter] Heal summary — total: ${report.totalHeals}, static: ${report.staticHeals}, AI: ${report.aiHeals}`,
  );
  if (report.aiHeals > 0) {
    console.warn(
      `[HealingReporter] ⚠ ${report.aiHeals} AI heal(s) detected — review before merging.`,
    );
  }
  if (report.totalHeals === 0) {
    console.log('[HealingReporter] No heals recorded. All primary locators resolved.');
  }
}

/** Parse --input and --output from process.argv. */
export function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '';
  let output = '';
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1] !== undefined) {
      input = argv[++i]!;
    } else if (argv[i] === '--output' && argv[i + 1] !== undefined) {
      output = argv[++i]!;
    }
  }
  if (!input || !output) {
    console.error('Usage: merge-healing-artifacts.ts --input <dir> --output <file>');
    process.exit(1);
  }
  return { input, output };
}

export function run(argv: string[]): void {
  const { input, output } = parseArgs(argv);

  const inputFiles = findFiles(input, HEALING_FILE_PATTERN);
  if (inputFiles.length === 0) {
    console.log(
      `[merge-healing-artifacts] No healing-*.json files found in: ${input} — writing zero-heal report`,
    );
  }

  const allEvents: HealEvent[] = [];
  for (const filePath of inputFiles) {
    allEvents.push(...readWorkerFile(filePath));
  }

  const deduplicated = deduplicateEvents(allEvents);
  const aiHeals = deduplicated.filter((e) => e.wasAiHeal).length;
  const staticHeals = deduplicated.length - aiHeals;

  const aiHealCount = aiHeals;
  const estimatedTokenCost = deduplicated
    .filter((e) => e.wasAiHeal)
    .reduce((sum, e) => sum + (e.tokenCost ?? 0), 0);

  const report: HealingReport = {
    generatedAt: new Date().toISOString(),
    totalHeals: deduplicated.length,
    aiHeals,
    staticHeals,
    aiHealCount,
    estimatedTokenCost,
    events: deduplicated,
  };

  const outputDir = path.dirname(output);
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[merge-healing-artifacts] Merged ${inputFiles.length} file(s) → ${output}`);

  logSummary(report);
}

// Only run when invoked directly (not when imported by tests).
// tsx sets process.argv[1] to the script path; when imported as a module,
// this module's filename won't match process.argv[1].
const scriptPath = process.argv[1] ?? '';
if (
  scriptPath.endsWith('merge-healing-artifacts.ts') ||
  scriptPath.endsWith('merge-healing-artifacts.js')
) {
  run(process.argv);
}
