/**
 * Migration 095: Add pipeline_stage_id FK to deals, backfill from stage name, enforce NOT NULL.
 * (MINCRM-499)
 *
 * Background: deals.stage has been a bare varchar(50) since migration 021 dropped the
 * CHECK constraint when pipeline stages became dynamic. This leaves stage integrity
 * entirely in application code — stage renames leave deals silently stale and stage
 * deletes cannot be blocked at the DB level.
 *
 * This migration adds a proper FK column, backfills it from the existing name-based join,
 * then enforces NOT NULL and adds a supporting index. The deprecated deals.stage text
 * column is retained for the transition period and will be dropped in a follow-up migration.
 *
 * Data safety audit — run before applying to verify the backfill will be clean:
 *
 *   -- Deals whose stage name matches no pipeline_stages row in the same pipeline
 *   SELECT d.id, d.pipeline_id, d.stage
 *   FROM deals d
 *   WHERE NOT EXISTS (
 *     SELECT 1 FROM pipeline_stages ps
 *     WHERE ps.name = d.stage AND ps.pipeline_id = d.pipeline_id
 *   );
 *
 * If the above returns rows, those deals have orphaned stage values and must be remediated
 * before this migration can run (the NOT NULL enforcement step will abort otherwise).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = async (pgm) => {
  // Step 1: Add the FK column as nullable so the backfill can populate it.
  pgm.addColumn('deals', {
    pipeline_stage_id: {
      type: 'uuid',
      notNull: false,
    },
  });

  // Step 2: Backfill — resolve each deal's stage name to the matching pipeline_stages.id.
  // Scoped to the same pipeline so per-pipeline stage name uniqueness is respected.
  pgm.sql(`
    UPDATE deals d
    SET pipeline_stage_id = ps.id
    FROM pipeline_stages ps
    WHERE ps.name = d.stage
      AND ps.pipeline_id = d.pipeline_id
  `);

  // Step 3: Abort if any deals could not be backfilled (orphaned stage values).
  // This surfaces data problems rather than silently allowing a NOT NULL column with NULLs.
  pgm.sql(`
    DO $$
    DECLARE
      orphan_count integer;
    BEGIN
      SELECT COUNT(*) INTO orphan_count
      FROM deals
      WHERE pipeline_stage_id IS NULL;

      IF orphan_count > 0 THEN
        RAISE EXCEPTION
          'Migration 095 aborted: % deal(s) have a stage value that does not match any '
          'pipeline_stages row. Remediate those deals before re-running this migration.',
          orphan_count;
      END IF;
    END;
    $$
  `);

  // Step 4: Enforce NOT NULL now that all rows are backfilled.
  pgm.alterColumn('deals', 'pipeline_stage_id', { notNull: true });

  // Step 5: Add the FK constraint — ON DELETE RESTRICT prevents deleting a stage that
  // has deals, matching the existing application-level STAGE_HAS_OPEN_DEALS guard.
  pgm.addConstraint(
    'deals',
    'deals_pipeline_stage_id_fkey',
    'FOREIGN KEY (pipeline_stage_id) REFERENCES pipeline_stages(id) ON DELETE RESTRICT',
  );

  // Step 6: Supporting index for FK lookups and stage-scoped deal queries.
  pgm.createIndex('deals', 'pipeline_stage_id', { name: 'deals_pipeline_stage_id_idx' });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex('deals', 'pipeline_stage_id', { name: 'deals_pipeline_stage_id_idx' });
  pgm.dropConstraint('deals', 'deals_pipeline_stage_id_fkey');
  pgm.dropColumn('deals', 'pipeline_stage_id');
};
