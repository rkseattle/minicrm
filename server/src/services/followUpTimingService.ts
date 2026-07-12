/**
 * Follow-up timing suggestion service — derives the best day/time to reach a
 * contact from their historical interaction pattern. (MINCRM-470)
 *
 * Deterministic/SQL-driven, like relationshipHealthService — no LLM call.
 * computeFollowUpTimingSuggestions() is the cron entry point (server/src/server.ts),
 * recomputing every contact with at least MIN_INTERACTIONS_FOR_TIMING_SUGGESTION
 * logged activities. getFollowUpTiming() additionally recomputes inline when a
 * contact's cached suggestion is missing or stale relative to their latest
 * activity, satisfying the AC "updates as new interaction data accumulates —
 * not a one-time calculation" without waiting for the next nightly run.
 *
 * day_of_week/hour_start_utc/hour_end_utc are stored as UTC-anchored buckets
 * (see migration 152) and projected into a display timezone only at read
 * time — never stored as localized wall-clock values.
 */

import pool from '../db.js';
import logger from '../logger.js';
import { getDefaultTimezone } from './settingsService.js';
import { MIN_INTERACTIONS_FOR_TIMING_SUGGESTION } from '@minicrm/shared/schemas/followUpTimingSchema.js';
import type { FollowUpTimingSuggestion } from '@minicrm/shared/schemas/followUpTimingSchema.js';

interface InteractionRow {
  interaction_at: Date;
  direction: 'Inbound' | 'Outbound' | null;
}

interface TimingBucket {
  dayOfWeek: number;
  hourStartUtc: number;
  hourEndUtc: number;
  sampleSize: number;
}

/** Contacts with at least MIN_INTERACTIONS_FOR_TIMING_SUGGESTION logged activities. */
async function gatherCandidateContactIds(): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT c.id
     FROM contacts c
     WHERE (SELECT COUNT(*) FROM activities act WHERE act.contact_id = c.id) >= $1`,
    [MIN_INTERACTIONS_FOR_TIMING_SUGGESTION],
  );
  return result.rows.map((row) => row.id);
}

async function gatherInteractions(contactId: string): Promise<InteractionRow[]> {
  const result = await pool.query<InteractionRow>(
    `SELECT COALESCE(due_date::timestamptz, created_at) AS interaction_at, direction
     FROM activities
     WHERE contact_id = $1`,
    [contactId],
  );
  return result.rows;
}

/**
 * Buckets interactions by UTC day-of-week and hour, returning the most frequent
 * 2-hour window. Prefers Inbound (contact-initiated/responded) interactions per
 * the AC's "historically responded or engaged" — falls back to all interactions
 * when there are too few Inbound ones to form a reliable pattern.
 */
function deriveTimingBucket(interactions: InteractionRow[]): TimingBucket | null {
  if (interactions.length < MIN_INTERACTIONS_FOR_TIMING_SUGGESTION) return null;

  const inbound = interactions.filter((i) => i.direction === 'Inbound');
  const source = inbound.length >= MIN_INTERACTIONS_FOR_TIMING_SUGGESTION ? inbound : interactions;

  // Bucket by (day_of_week, hour) pair, counting occurrences.
  const counts = new Map<string, number>();
  for (const interaction of source) {
    const day = interaction.interaction_at.getUTCDay();
    const hour = interaction.interaction_at.getUTCHours();
    const key = `${day}:${hour}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  if (!bestKey) return null;

  const [dayStr, hourStr] = bestKey.split(':');
  const day = parseInt(dayStr, 10);
  const hour = parseInt(hourStr, 10);
  const hourEnd = Math.min(hour + 2, 24);

  return {
    dayOfWeek: day,
    hourStartUtc: hour,
    hourEndUtc: hourEnd > hour ? hourEnd : hour + 1,
    sampleSize: source.length,
  };
}

async function persistSuggestion(contactId: string, bucket: TimingBucket): Promise<void> {
  await pool.query(
    `INSERT INTO contact_followup_timing_suggestions
       (contact_id, day_of_week, hour_start_utc, hour_end_utc, sample_size, computed_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (contact_id) DO UPDATE SET
       day_of_week = EXCLUDED.day_of_week,
       hour_start_utc = EXCLUDED.hour_start_utc,
       hour_end_utc = EXCLUDED.hour_end_utc,
       sample_size = EXCLUDED.sample_size,
       computed_at = EXCLUDED.computed_at`,
    [contactId, bucket.dayOfWeek, bucket.hourStartUtc, bucket.hourEndUtc, bucket.sampleSize],
  );
}

/**
 * Nightly cron entry point. Recomputes the cached suggestion for every
 * contact with sufficient interaction history. No-ops per-contact on error
 * so one bad contact doesn't abort the run.
 */
export async function computeFollowUpTimingSuggestions(): Promise<void> {
  const contactIds = await gatherCandidateContactIds();
  logger.info({ contactCount: contactIds.length }, 'followUpTiming: nightly run starting');

  for (const contactId of contactIds) {
    try {
      const interactions = await gatherInteractions(contactId);
      const bucket = deriveTimingBucket(interactions);
      if (!bucket) continue;
      await persistSuggestion(contactId, bucket);
    } catch (err) {
      logger.error({ err, contactId }, 'followUpTiming: failed to compute suggestion for contact');
    }
  }

  logger.info('followUpTiming: nightly run complete');
}

/**
 * Projects a UTC day/hour window into a display timezone. Only the hour
 * component shifts across a timezone offset in the common case; a day
 * boundary crossing (e.g. UTC 23:00 -> previous/next local day) is handled
 * by re-deriving the day-of-week from the projected instant rather than the
 * stored UTC day, so the displayed day is always locally correct.
 */
function projectToTimezone(
  dayOfWeek: number,
  hourUtc: number,
  timezone: string,
): { dayOfWeek: number; hour: number } {
  // Anchor to a known UTC Sunday (1970-01-04 was a Sunday) plus dayOfWeek days and hourUtc hours,
  // then read back the local day/hour in the target timezone. This sidesteps DST edge cases
  // for a single reference week rather than hand-rolling offset arithmetic.
  const anchor = new Date(Date.UTC(1970, 0, 4 + dayOfWeek, hourUtc));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(anchor);
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? String(hourUtc);

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const localDay = WEEKDAYS.indexOf(weekdayStr);
  // Intl formats midnight as "24" with hour12: false in some environments — normalize to 0.
  const localHour = parseInt(hourStr, 10) % 24;

  return { dayOfWeek: localDay >= 0 ? localDay : dayOfWeek, hour: localHour };
}

function toSuggestion(
  row: {
    contact_id: string;
    day_of_week: number;
    hour_start_utc: number;
    hour_end_utc: number;
    sample_size: number;
    computed_at: Date;
  },
  timezone: string,
): FollowUpTimingSuggestion {
  const start = projectToTimezone(row.day_of_week, row.hour_start_utc, timezone);
  // hour_end_utc may be 24 (end of day); project the wall-clock hour it represents.
  const endHourUtc = row.hour_end_utc % 24;
  const end = projectToTimezone(row.day_of_week, endHourUtc, timezone);

  return {
    contact_id: row.contact_id,
    day_of_week: start.dayOfWeek,
    hour_start: start.hour,
    hour_end: row.hour_end_utc === 24 ? 24 : end.hour,
    timezone,
    sample_size: row.sample_size,
    computed_at: row.computed_at.toISOString(),
  };
}

/**
 * Returns the cached follow-up timing suggestion for a contact, projected
 * into the org's default display timezone. Recomputes inline if the cached
 * row is missing or older than the contact's most recent logged activity —
 * satisfies "updates as new interaction data accumulates" without waiting
 * for the next nightly run. Returns null when there is insufficient data.
 */
export async function getFollowUpTiming(
  contactId: string,
): Promise<FollowUpTimingSuggestion | null> {
  const [cached, latestActivity] = await Promise.all([
    pool.query<{
      contact_id: string;
      day_of_week: number;
      hour_start_utc: number;
      hour_end_utc: number;
      sample_size: number;
      computed_at: Date;
    }>(
      `SELECT contact_id, day_of_week, hour_start_utc, hour_end_utc, sample_size, computed_at
       FROM contact_followup_timing_suggestions
       WHERE contact_id = $1`,
      [contactId],
    ),
    pool.query<{ latest: Date | null }>(
      `SELECT MAX(COALESCE(due_date::timestamptz, created_at)) AS latest
       FROM activities WHERE contact_id = $1`,
      [contactId],
    ),
  ]);

  const cachedRow = cached.rows[0];
  const latest = latestActivity.rows[0]?.latest ?? null;
  const isStale = !cachedRow || (latest !== null && latest > cachedRow.computed_at);

  if (isStale) {
    const interactions = await gatherInteractions(contactId);
    const bucket = deriveTimingBucket(interactions);
    if (!bucket) return null;
    await persistSuggestion(contactId, bucket);
    const refreshed = await pool.query<{
      contact_id: string;
      day_of_week: number;
      hour_start_utc: number;
      hour_end_utc: number;
      sample_size: number;
      computed_at: Date;
    }>(
      `SELECT contact_id, day_of_week, hour_start_utc, hour_end_utc, sample_size, computed_at
       FROM contact_followup_timing_suggestions
       WHERE contact_id = $1`,
      [contactId],
    );
    const row = refreshed.rows[0];
    if (!row) return null;
    const timezone = await getDefaultTimezone();
    return toSuggestion(row, timezone);
  }

  const timezone = await getDefaultTimezone();
  return toSuggestion(cachedRow, timezone);
}
