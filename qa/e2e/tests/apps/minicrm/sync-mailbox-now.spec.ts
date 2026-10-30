/**
 * Unit tests for syncMailboxNow's round loop, against a REST client that answers each
 * round in turn. No server involved.
 */

import { test, expect } from '@framework/fixtures';
import { MAX_SYNC_ROUNDS, syncMailboxNow } from '@behaviors/minicrm/email-sync.behaviors';
import type { RestClient } from '@framework/clients/rest-client';
import type { SyncNowResponse } from '@minicrm/shared/schemas/testEmailSyncSchema';

type Outcome = SyncNowResponse['outcome'];

const synced = (hasMore: boolean): Outcome => ({
  status: 'synced',
  messages_stored: 1,
  has_more: hasMore,
  cursor_invalid: false,
});

/** A client whose run route answers with these outcomes, one per call. */
function answering(outcomes: Outcome[]): { client: RestClient; calls: () => number } {
  let calls = 0;
  const client = {
    post: () => {
      const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
      calls += 1;
      return Promise.resolve({ status: 200, body: { outcome } });
    },
  };
  // Safe: syncMailboxNow calls only post, which the stub implements.
  return { client: client as unknown as RestClient, calls: () => calls };
}

test.describe('syncMailboxNow', () => {
  test('returns the one round when there is no more to sync', async () => {
    const { client, calls } = answering([synced(false)]);
    await expect(syncMailboxNow(client, 'a1')).resolves.toEqual([synced(false)]);
    expect(calls()).toBe(1);
  });

  test('fails on the first round, naming its error code and round', async () => {
    const { client } = answering([{ status: 'failed', error_code: 'PROVIDER_AUTH_EXPIRED' }]);
    await expect(syncMailboxNow(client, 'a1')).rejects.toThrow(
      'round 1 failed with PROVIDER_AUTH_EXPIRED',
    );
  });

  test('fails on a later round rather than returning the rounds before it', async () => {
    const { client } = answering([
      synced(true),
      { status: 'failed', error_code: 'CONNECTION_FAILED' },
    ]);
    await expect(syncMailboxNow(client, 'a1')).rejects.toThrow(
      'round 2 failed with CONNECTION_FAILED',
    );
  });

  test('gives up when the mailbox still reports more after the last round', async () => {
    const { client, calls } = answering([synced(true)]);
    await expect(syncMailboxNow(client, 'a1')).rejects.toThrow('still more to sync');
    expect(calls()).toBe(MAX_SYNC_ROUNDS);
  });
});
