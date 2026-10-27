/**
 * The test stack's database names, one definition for every workspace that creates, guards
 * or points at them: a server script, a qa script and the root setup script cannot import
 * one another, and a name that drifts between them sends a run to a database nobody
 * migrated. Dependency-free, like every file here.
 */
export const E2E_DB_NAME = 'minicrm_e2e_test';
export const COVERAGE_E2E_DB_NAME = 'minicrm_coverage_e2e_test';

/** Names these databases had before they took a _test suffix, mapped to today's. */
export const RETIRED_TEST_DATABASES: ReadonlyMap<string, string> = new Map([
  ['minicrm_e2e', E2E_DB_NAME],
  ['minicrm_coverage_e2e', COVERAGE_E2E_DB_NAME],
]);

/**
 * Why setup refuses to create a database whose retired name still exists: creating it would
 * strand the old data and TIA mappings, and the stack would look healthy while empty.
 */
export function retiredDatabaseMessage(retired: string, current: string): string {
  return (
    `${retired} exists but ${current} does not: this stack predates the rename. Stop ` +
    `minicrm-test-server and rename it in place, keeping its data:\n` +
    `  docker exec minicrm-test-db psql -U minicrm -d postgres -c ` +
    `'ALTER DATABASE ${retired} RENAME TO ${current}'\n` +
    'then re-run. See docs/dev/troubleshooting.md, E2E.'
  );
}

/** The retired name a current database was created under, or undefined. */
export function retiredNameOf(current: string): string | undefined {
  for (const [retired, renamed] of RETIRED_TEST_DATABASES) {
    if (renamed === current) return retired;
  }
  return undefined;
}
