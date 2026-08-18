#!/usr/bin/env tsx
/**
 * print-capacity-plan.ts
 *
 * Prints the runner-capacity-derived CapacityPlan (shards, workers) as a
 * single line of JSON, for CI steps to capture into $GITHUB_OUTPUT.
 *
 * Usage (from repo root):
 *   npx tsx qa/e2e/scripts/print-capacity-plan.ts
 *
 *
 */

import { getCapacityPlan } from '../framework/reporting/capacity.js';

process.stdout.write(JSON.stringify(getCapacityPlan()) + '\n');
