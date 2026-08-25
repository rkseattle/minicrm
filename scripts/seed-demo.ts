/**
 * seed-demo.ts — Thin CLI wrapper for seeding demo data.
 * All fixture data and insert logic live in demoService.ts.
 *
 * Usage:
 *   npm run seed:demo               # insert demo data (idempotent — skips if already seeded)
 *   npm run seed:demo -- --dry-run  # show current demo status without writing to the DB
 */

import 'dotenv/config';
import {
  seedDemo,
  getDemoStatus,
  runPostSeedProducers,
} from '../server/src/services/demoService.js';

const isDryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  if (isDryRun) {
    const status = await getDemoStatus();
    console.log(
      `[seed-demo] DRY RUN — demo data currently: ${status.active ? 'present' : 'absent'}`,
    );
    console.log('[seed-demo] Pass without --dry-run to seed.');
    return;
  }

  const result = await seedDemo();
  if (!result.seeded) {
    console.log(
      '[seed-demo] Demo data already exists. Run `npm run remove:demo` first to re-seed.',
    );
    return;
  }
  console.log('[seed-demo] Done — demo data seeded successfully.');

  // Awaited, unlike the admin API path: the CLI would otherwise exit mid-run.
  console.log('[seed-demo] Populating the hygiene queue and coaching insights…');
  await runPostSeedProducers();
  console.log('[seed-demo] Done.');
}

main().catch((err) => {
  console.error('[seed-demo] Fatal error:', err);
  process.exit(1);
});
