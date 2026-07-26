/**
 * Coverage/TIA instrumentation types shared by every coverage agent. (MINCRM-604, MINCRM-606)
 *
 * Re-exported from sdk/CoverageAgentPlugin.ts, which formalizes this same
 * contract as the versioned agent SDK MINCRM-636 calls for. Kept as a
 * re-export (not deleted) purely so this file's existing import path stays
 * valid — no external consumer of this internal module exists yet, so this
 * is a same-commit move, not a deprecation window.
 */

export type {
  CoverageAgentPlugin as CoverageAgent,
  CoverageDump,
  CoverageDumpFormat,
  CoverageDumpSource,
} from './sdk/CoverageAgentPlugin.js';
