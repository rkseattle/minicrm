/**
 * Corrects the sync_next_attempt_at catalog comment.
 *
 * It read "Null means due now. This, not status, is what gates a retry." Both halves
 * stopped being true once the claim query started filtering on sync_failure_count: null
 * now means due-now only below the ceiling, and above it means the opposite — parked
 * until a user acts. A reader meeting the old text in psql would conclude a retired
 * mailbox is still being retried.
 *
 * Corrective rather than an edit to 174, which has already run.
 */

exports.up = (pgm) => {
  pgm.sql(
    `COMMENT ON COLUMN public.connected_accounts.sync_next_attempt_at IS 'Earliest time this mailbox may be synced again. Null means due now while sync_failure_count is below the ceiling, and parked-until-a-user-acts once it reaches it; the two columns gate the claim together.'`,
  );
};

exports.down = (pgm) => {
  pgm.sql(
    `COMMENT ON COLUMN public.connected_accounts.sync_next_attempt_at IS 'Earliest time this mailbox may be synced again. Null means due now. This, not status, is what gates a retry.'`,
  );
};
