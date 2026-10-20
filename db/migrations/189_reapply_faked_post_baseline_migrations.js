/**
 * Re-applies migrations 181 and 182, which a server boot may have recorded without running.
 *
 * Until migrateFromBaseline() marked baseline-covered migrations by name, every boot marked
 * "the next N pending" migrations applied — on a long-lived database, the ones added after
 * the baseline. Both are idempotent (IF NOT EXISTS, guarded constraint, a backfill that only
 * fills NULLs), so running them again changes nothing where they did run and creates their
 * schema where they did not. Later migrations were never deployed under the faulty boot.
 */

'use strict';

const linkSource = require('./181_email_link_source.js');
const linkSuppressions = require('./182_email_link_suppressions.js');

exports.shorthands = undefined;

exports.up = (pgm) => {
  linkSource.up(pgm);
  linkSuppressions.up(pgm);
};

// Nothing to undo: down would remove schema 181 and 182 own, which their own downs do.
exports.down = () => {};
