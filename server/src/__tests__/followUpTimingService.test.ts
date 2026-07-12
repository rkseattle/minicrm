/**
 * Integration tests for followUpTimingService. (MINCRM-470)
 * Runs against a real PostgreSQL test database — timing derivation is
 * deterministic/SQL-driven, no Anthropic SDK mock needed.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createActivity } from '../services/activityService.js';
import { setDefaultTimezone } from '../services/settingsService.js';
import {
  computeFollowUpTimingSuggestions,
  getFollowUpTiming,
} from '../services/followUpTimingService.js';

const FILE_PREFIX = 'followup-timing-svc';

let ownerId: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM contact_followup_timing_suggestions
     WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
}

beforeAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Follow-up Timing Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ownerId = owner.id;
});

beforeEach(async () => {
  await cleanup();
  await setDefaultTimezone('UTC');
});

afterAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('getFollowUpTiming', () => {
  it('returns null when fewer than 5 interactions are logged', async () => {
    const contact = await createContact({
      email: `${FILE_PREFIX}-sparse-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      first_name: 'Sparse',
      last_name: 'Contact',
      owner_id: ownerId,
    });
    for (let i = 0; i < 4; i++) {
      await createActivity({
        type: 'Call',
        subject: `Call ${i}`,
        direction: 'Inbound',
        due_date: `2026-0${(i % 9) + 1}-01`,
        contact_id: contact.id,
        owner_id: ownerId,
      });
    }

    const suggestion = await getFollowUpTiming(contact.id);
    expect(suggestion).toBeNull();
  });

  it('derives the most frequent day/hour bucket once 5+ interactions exist', async () => {
    const contact = await createContact({
      email: `${FILE_PREFIX}-frequent-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      first_name: 'Frequent',
      last_name: 'Contact',
      owner_id: ownerId,
    });
    // 5 Tuesdays at 14:00 UTC (2026-01-06, 13, 20, 27 and 2026-02-03 are Tuesdays).
    const tuesdays = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03'];
    for (const date of tuesdays) {
      await pool.query(
        `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
         VALUES ('Call', 'Sync', 'Inbound', $1, $2, ($3::date + time '14:00')::timestamptz)`,
        [contact.id, ownerId, date],
      );
    }

    const suggestion = await getFollowUpTiming(contact.id);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.day_of_week).toBe(2); // Tuesday
    expect(suggestion!.sample_size).toBeGreaterThanOrEqual(5);
    expect(suggestion!.timezone).toBe('UTC');
  });

  it('recomputes automatically when new activity postdates the cached suggestion', async () => {
    const contact = await createContact({
      email: `${FILE_PREFIX}-evolving-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      first_name: 'Evolving',
      last_name: 'Contact',
      owner_id: ownerId,
    });
    // First batch: 5 rows, several weeks in the past, all on the SAME day-of-week
    // as each other (whole-week offsets preserve day-of-week) but deliberately
    // offset by 3 days from "today" so the two batches land on different days.
    // All of this batch predates the moment computed_at gets stamped below.
    for (let weeksAgo = 10; weeksAgo <= 14; weeksAgo++) {
      await pool.query(
        `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
         VALUES ('Call', 'Sync', 'Inbound', $1, $2, now() - ($3 || ' weeks')::interval - interval '3 days')`,
        [contact.id, ownerId, weeksAgo],
      );
    }

    const first = await getFollowUpTiming(contact.id);
    const firstDay = first!.day_of_week;
    const firstComputedAt = first!.computed_at;

    // Second batch: 6 rows (outnumbering the first batch's 5), each created_at
    // strictly after firstComputedAt (spaced 1 second apart, starting now), all
    // sharing today's actual day-of-week — guaranteed different from firstDay
    // since the first batch was deliberately offset by 3 days.
    for (let i = 0; i < 6; i++) {
      await pool.query(
        `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
         VALUES ('Call', 'Sync', 'Inbound', $1, $2, now() + ($3 || ' seconds')::interval)`,
        [contact.id, ownerId, i],
      );
    }

    const updated = await getFollowUpTiming(contact.id);
    expect(updated!.computed_at > firstComputedAt).toBe(true);
    expect(updated!.day_of_week).not.toBe(firstDay);
    expect(updated!.day_of_week).toBe(new Date().getUTCDay());
  });

  it('projects the suggested time into the org default timezone', async () => {
    await setDefaultTimezone('America/Los_Angeles');
    const contact = await createContact({
      email: `${FILE_PREFIX}-timezone-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      first_name: 'Timezone',
      last_name: 'Contact',
      owner_id: ownerId,
    });
    const tuesdays = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03'];
    for (const date of tuesdays) {
      await pool.query(
        `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
         VALUES ('Call', 'Sync', 'Inbound', $1, $2, ($3::date + time '17:00')::timestamptz)`,
        [contact.id, ownerId, date],
      );
    }

    const suggestion = await getFollowUpTiming(contact.id);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.timezone).toBe('America/Los_Angeles');
    // 17:00 UTC in January (PST, UTC-8) is 09:00 local.
    expect(suggestion!.hour_start).toBe(9);
  });
});

describe('computeFollowUpTimingSuggestions', () => {
  it('completes without throwing across all candidate contacts', async () => {
    await expect(computeFollowUpTimingSuggestions()).resolves.not.toThrow();
  });

  it('caches a suggestion that getFollowUpTiming subsequently reuses', async () => {
    const contact = await createContact({
      email: `${FILE_PREFIX}-cached-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      first_name: 'Cached',
      last_name: 'Contact',
      owner_id: ownerId,
    });
    const tuesdays = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03'];
    for (const date of tuesdays) {
      await pool.query(
        `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
         VALUES ('Call', 'Sync', 'Inbound', $1, $2, ($3::date + time '14:00')::timestamptz)`,
        [contact.id, ownerId, date],
      );
    }

    await computeFollowUpTimingSuggestions();

    const cached = await pool.query(
      'SELECT * FROM contact_followup_timing_suggestions WHERE contact_id = $1',
      [contact.id],
    );
    expect(cached.rows.length).toBe(1);

    const suggestion = await getFollowUpTiming(contact.id);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.sample_size).toBe(cached.rows[0].sample_size);
  });
});
