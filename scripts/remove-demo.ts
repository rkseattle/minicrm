/**
 * remove-demo.ts — Thin CLI wrapper for removing demo data.
 * All removal logic lives in demoService.ts.
 *
 * Usage:
 *   npm run remove:demo
 */

import 'dotenv/config';
import { removeDemo } from '../server/src/services/demoService.js';

async function main(): Promise<void> {
  const result = await removeDemo();
  if (!result.removed) {
    console.log('[remove-demo] No demo data found — nothing to remove.');
    return;
  }
  console.log('[remove-demo] Done — all demo data removed.');
}

main().catch((err) => {
  console.error('[remove-demo] Fatal error:', err);
  process.exit(1);
});
