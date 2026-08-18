/**
 * Rule-based lead scoring engine.
 *
 * Deterministic, on-demand scoring of a lead's quality, computed on read —
 * no persisted score column, no background scoring job, matching this
 * codebase's existing "explain on demand" convention (dealHealthService,
 * duplicateMatchService). Pure data comparison — no AI call is made here;
 * the AI narrative feature consumes this score's factor breakdown
 * as input to its prompt.
 *
 * Scope note: the leads table has no title, company-size, or direct
 * activity-history columns (confirmed against db/migrations/000_baseline.js
 * and the activities table's FK set, which has no lead_id column). Scoring
 * is therefore limited to lead_source, status progression, recency, and —
 * once a lead converts — the linked contact's post-conversion activity
 * count as an engagement proxy.
 */

import { withRlsQuery } from './rlsContextService.js';
import type { LeadRow } from './leadsService.js';
import type {
  LeadScoreFactorBreakdown,
  LeadScoreResult,
} from '@minicrm/shared/schemas/leadScoreSchema.js';

/** Points awarded per lead_source value — reflects typical conversion quality by channel. */
const SOURCE_QUALITY_POINTS: Record<string, number> = {
  Referral: 30,
  'Trade Show': 22,
  Web: 15,
  'Cold Outreach': 8,
  Other: 5,
};
const SOURCE_QUALITY_MAX_POINTS = 30;
const SOURCE_QUALITY_UNKNOWN_POINTS = 0;

/** Points awarded per lead status — reflects progression toward qualification. */
const STATUS_PROGRESSION_POINTS: Record<string, number> = {
  New: 5,
  Contacted: 15,
  Qualified: 30,
  Disqualified: 0,
};
const STATUS_PROGRESSION_MAX_POINTS = 30;

/** Recency scoring thresholds and point values, in days since last update. */
const RECENCY_MAX_POINTS = 20;
const RECENCY_THRESHOLDS_DAYS = [
  { withinDays: 2, points: 20 },
  { withinDays: 7, points: 14 },
  { withinDays: 30, points: 8 },
  { withinDays: Infinity, points: 2 },
];

/** Points per post-conversion activity, capped at MAX_POINTS. */
const ENGAGEMENT_MAX_POINTS = 20;
const ENGAGEMENT_POINTS_PER_ACTIVITY = 4;

/** A lead needs at least this many non-zero-max factors with actual signal to be considered scoreable. */
const MIN_SIGNAL_COUNT_FOR_SUFFICIENT_DATA = 1;

function scoreSourceQuality(leadSource: string | null): LeadScoreFactorBreakdown {
  if (!leadSource) {
    return {
      factor: 'source_quality',
      points: SOURCE_QUALITY_UNKNOWN_POINTS,
      max_points: SOURCE_QUALITY_MAX_POINTS,
      reason: 'No lead source recorded',
    };
  }
  const points = SOURCE_QUALITY_POINTS[leadSource] ?? SOURCE_QUALITY_UNKNOWN_POINTS;
  return {
    factor: 'source_quality',
    points,
    max_points: SOURCE_QUALITY_MAX_POINTS,
    reason: `Source: ${leadSource}`,
  };
}

function scoreStatusProgression(status: string): LeadScoreFactorBreakdown {
  const points = STATUS_PROGRESSION_POINTS[status] ?? 0;
  return {
    factor: 'status_progression',
    points,
    max_points: STATUS_PROGRESSION_MAX_POINTS,
    reason: `Status: ${status}`,
  };
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function scoreRecency(updatedAt: Date): LeadScoreFactorBreakdown {
  const days = daysSince(updatedAt);
  const matched =
    RECENCY_THRESHOLDS_DAYS.find((threshold) => days <= threshold.withinDays) ??
    RECENCY_THRESHOLDS_DAYS[RECENCY_THRESHOLDS_DAYS.length - 1]!;
  return {
    factor: 'recency',
    points: matched.points,
    max_points: RECENCY_MAX_POINTS,
    reason: `Last updated ${days} day${days === 1 ? '' : 's'} ago`,
  };
}

async function scoreEngagement(lead: LeadRow): Promise<LeadScoreFactorBreakdown> {
  if (!lead.converted_contact_id) {
    return {
      factor: 'post_conversion_engagement',
      points: 0,
      max_points: ENGAGEMENT_MAX_POINTS,
      reason: 'Not yet converted — no activity history available',
    };
  }

  const result = await withRlsQuery((client) =>
    client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM activities WHERE contact_id = $1',
      [lead.converted_contact_id],
    ),
  );
  const activityCount = parseInt(result.rows[0]?.count ?? '0', 10);
  const points = Math.min(activityCount * ENGAGEMENT_POINTS_PER_ACTIVITY, ENGAGEMENT_MAX_POINTS);

  return {
    factor: 'post_conversion_engagement',
    points,
    max_points: ENGAGEMENT_MAX_POINTS,
    reason:
      activityCount > 0
        ? `${activityCount} activit${activityCount === 1 ? 'y' : 'ies'} since conversion`
        : 'Converted, but no activity logged yet',
  };
}

/**
 * Computes a deterministic 0-100 quality score for a lead from lead_source,
 * status, recency, and (post-conversion) activity engagement.
 *
 * @param lead - The lead row to score.
 * @returns Composite score, per-factor breakdown, and an insufficient_data flag.
 */
export async function scoreLead(lead: LeadRow): Promise<LeadScoreResult> {
  const factors: LeadScoreFactorBreakdown[] = [
    scoreSourceQuality(lead.lead_source),
    scoreStatusProgression(lead.status),
    scoreRecency(lead.updated_at),
    await scoreEngagement(lead),
  ];

  const score = factors.reduce((sum, factor) => sum + factor.points, 0);

  // "Insufficient data" means we have essentially nothing to explain: no
  // source, a brand-new/untouched status, and no post-conversion signal.
  const signalCount = [
    lead.lead_source !== null,
    lead.status !== 'New',
    Boolean(lead.converted_contact_id),
  ].filter(Boolean).length;

  return {
    score,
    factors,
    insufficient_data: signalCount < MIN_SIGNAL_COUNT_FOR_SUFFICIENT_DATA,
  };
}
