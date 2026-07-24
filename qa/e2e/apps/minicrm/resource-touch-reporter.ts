/**
 * MiniCRM's concrete ResourceTouchReporter — subclasses the domain-agnostic
 * BaseResourceTouchReporter (framework/reporting/resource-touch-reporter.ts)
 * with a lookup backed by RESOURCE_REGISTRY.
 *
 * Registered in playwright.config.ts alongside the other always-on
 * reporters. Lives in apps/ (not framework/) because it statically imports
 * MiniCRM-specific resource key strings, which framework-purity checks
 * forbid inside framework/.
 *
 * MINCRM-661
 */

import { BaseResourceTouchReporter } from '../../framework/reporting/resource-touch-reporter.js';
import type { ResourceTouchLookup } from '../../framework/reporting/resource-touch-utils.js';
import { RESOURCE_REGISTRY } from './resource-registry.js';

/**
 * Looks up resource touches for a given spec file + test title.
 *
 * Matching rules:
 * - `testTitleContains` entries only match titles containing that substring.
 * - File-wide entries (no `testTitleContains`) match any title in that file.
 * - If multiple entries match, their reads/writes are unioned.
 * - Returns null when no entry matches (test touches no tracked resource).
 */
export const lookupResourceTouch: ResourceTouchLookup = (file, title) => {
  const matches = RESOURCE_REGISTRY.filter(
    (entry) =>
      entry.file === file && (!entry.testTitleContains || title.includes(entry.testTitleContains)),
  );

  if (matches.length === 0) return null;

  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const entry of matches) {
    for (const r of entry.reads) reads.add(r);
    for (const w of entry.writes) writes.add(w);
  }

  return { reads: [...reads], writes: [...writes] };
};

export class ResourceTouchReporter extends BaseResourceTouchReporter {
  protected lookup: ResourceTouchLookup = lookupResourceTouch;
}

export default ResourceTouchReporter;
