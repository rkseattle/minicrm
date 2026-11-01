/**
 * Integration tests for followUpTimingService.
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
import { purgeFixtureUsers } from './testUtils.js';

const FILE_PREFIX = 'followup-timing-svc';

// Projection uses the offset of the week it is read in, so each Los Angeles test
// passes the instant it reads at rather than depending on the season it runs in.

/** A Wednesday well inside Pacific Standard Time, when Los Angeles is UTC-8. */
const PST_WEEK = new Date('2026-01-14T12:00:00Z');
/** A Wednesday well inside Pacific Daylight Time, when Los Angeles is UTC-7. */
const PDT_WEEK = new Date('2026-07-15T12:00:00Z');

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
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%` });
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
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%` });
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

    // Second batch: 6 rows outnumbering the first batch's 5, all sharing one timestamp.
    // Three properties are load-bearing. now() is stable within a statement (unlike
    // clock_timestamp(), which re-evaluates per row), so all six land in one (day, hour)
    // bucket — a batch straddling an hour boundary splits into two that each lose to the
    // first batch's five. The 1-second offset puts them strictly after the cached
    // computed_at, since the staleness check is a strict `latest > computed_at` and both
    // stamps can otherwise fall in the same instant. Reading the day back off the row
    // avoids a second clock read that could cross midnight.
    const batchInstant = await pool.query<{ at: Date }>(
      `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
       SELECT 'Call', 'Sync', 'Inbound', $1, $2, now() + interval '1 second'
       FROM generate_series(1, 6)
       RETURNING created_at AS at`,
      [contact.id, ownerId],
    );
    const expectedDay = batchInstant.rows[0].at.getUTCDay();

    const updated = await getFollowUpTiming(contact.id);
    expect(updated!.computed_at > firstComputedAt).toBe(true);
    expect(updated!.day_of_week).not.toBe(firstDay);
    expect(updated!.day_of_week).toBe(expectedDay);
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

    const suggestion = await getFollowUpTiming(contact.id, PST_WEEK);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.timezone).toBe('America/Los_Angeles');
    // 17:00 UTC in PST (UTC-8) is 09:00 local.
    expect(suggestion!.hour_start).toBe(9);
  });

  it('projects an hour_end_utc of 24 (end-of-day) into the display timezone instead of returning it raw', async () => {
    // Regression test: hour_end_utc=24 previously bypassed timezone projection
    // entirely, returning the literal 24 regardless of the target timezone —
    // producing an end time before the start time once hour_start was projected.
    await setDefaultTimezone('America/Los_Angeles');
    const contact = await createContact({
      email: `${FILE_PREFIX}-endofday-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      first_name: 'EndOfDay',
      last_name: 'Contact',
      owner_id: ownerId,
    });
    // 5 Tuesdays at 23:00 UTC — buckets to hour_start_utc=23, hour_end_utc=24 (capped).
    const tuesdays = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03'];
    for (const date of tuesdays) {
      await pool.query(
        `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
         VALUES ('Call', 'Sync', 'Inbound', $1, $2, ($3::date + time '23:00')::timestamptz)`,
        [contact.id, ownerId, date],
      );
    }

    const suggestion = await getFollowUpTiming(contact.id, PST_WEEK);
    expect(suggestion).not.toBeNull();
    // 23:00 UTC in PST is 15:00; hour_end_utc=24 (Wed 00:00 UTC) projects to 16:00 —
    // a coherent 1-hour range, not "3pm-12pm".
    expect(suggestion!.hour_start).toBe(15);
    expect(suggestion!.hour_end).toBe(16);
    expect(suggestion!.hour_end).toBeGreaterThan(suggestion!.hour_start);
  });

  async function contactWithJulyCalls(label: string): Promise<string> {
    const contact = await createContact({
      email: `${FILE_PREFIX}-${label}-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      first_name: 'DST',
      last_name: 'Contact',
      owner_id: ownerId,
    });
    // 5 Tuesdays in July 2026 (PDT is in effect).
    const tuesdays = ['2026-07-07', '2026-07-14', '2026-07-21', '2026-07-28', '2026-08-04'];
    for (const date of tuesdays) {
      await pool.query(
        `INSERT INTO activities (type, subject, direction, contact_id, owner_id, created_at)
         VALUES ('Call', 'Sync', 'Inbound', $1, $2, ($3::date + time '17:00')::timestamptz)`,
        [contact.id, ownerId, date],
      );
    }
    return contact.id;
  }

  it('projects using the currently-observed DST offset, not a fixed historical date', async () => {
    // Regression test: projectToTimezone previously anchored every projection to
    // January 1970, so a summer bucket in a DST-observing zone was projected using
    // winter's offset instead of summer's. America/Los_Angeles is UTC-7 in July
    // (PDT) but was UTC-8 in January 1970 (no DST that winter) — a 17:00 UTC bucket
    // must project to 10:00 local (PDT), not 09:00 (the stale 1970 offset).
    await setDefaultTimezone('America/Los_Angeles');

    const suggestion = await getFollowUpTiming(await contactWithJulyCalls('dst'), PDT_WEEK);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.hour_start).toBe(10);
  });

  it('projects summer activity with the winter offset when read in winter', async () => {
    // The offset follows the week the suggestion is read in, not the activity dates.
    await setDefaultTimezone('America/Los_Angeles');

    const suggestion = await getFollowUpTiming(await contactWithJulyCalls('dst-winter'), PST_WEEK);
    expect(suggestion).not.toBeNull();
    // 17:00 UTC in PST (UTC-8) is 09:00 local.
    expect(suggestion!.hour_start).toBe(9);
  });

  it('falls back to UTC when the stored default timezone is not a valid IANA identifier', async () => {
    // Regression test: an invalid/corrupted timezone previously threw inside
    // Intl.DateTimeFormat and surfaced as a server error on every read.
    await pool.query(
      `UPDATE system_settings SET value = 'Not/A_Real_Zone' WHERE key = 'default_timezone'`,
    );
    const contact = await createContact({
      email: `${FILE_PREFIX}-badtz-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      first_name: 'BadTz',
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

    const suggestion = await getFollowUpTiming(contact.id);
    expect(suggestion).not.toBeNull();
    expect(suggestion!.timezone).toBe('UTC');
    expect(suggestion!.hour_start).toBe(14);
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
