/**
 * Classifies a contact's free-text job title into a seniority tier.
 *
 * contacts.title has no structured seniority field — this is keyword-based
 * classification against the title string. Pure, synchronous, no I/O, so it's
 * cheap to call for every contact in the nightly health-scoring job.
 */

export const SENIORITY_TIERS = [
  'executive',
  'senior',
  'manager',
  'individual_contributor',
] as const;
export type SeniorityTier = (typeof SENIORITY_TIERS)[number];

/** Numeric weight per tier, used to average seniority across multiple engaged contacts. */
export const SENIORITY_TIER_WEIGHT: Record<SeniorityTier, number> = {
  executive: 1,
  senior: 0.75,
  manager: 0.5,
  individual_contributor: 0.25,
};

// Order matters: checked top to bottom, first match wins. "VP of Engineering"
// must match executive before "Engineering Manager" matches manager, so the
// most senior-indicating keywords are listed first.
const EXECUTIVE_PATTERN =
  /\b(chief|c[a-z]o|president|founder|owner|partner|principal|executive vice president|evp)\b/i;
const SENIOR_PATTERN = /\b(vp|vice president|svp|head of|director)\b/i;
const MANAGER_PATTERN = /\b(manager|mgr|lead|supervisor)\b/i;

/**
 * Classifies a job title into a seniority tier. Titles that match none of the
 * known patterns are treated as individual_contributor (the most conservative
 * default — it does not inflate a health score's seniority component).
 *
 * @param title - The contact's free-text job title, or null/undefined if unset.
 */
export function classifySeniority(title: string | null | undefined): SeniorityTier {
  if (!title || title.trim() === '') return 'individual_contributor';
  if (EXECUTIVE_PATTERN.test(title)) return 'executive';
  if (SENIOR_PATTERN.test(title)) return 'senior';
  if (MANAGER_PATTERN.test(title)) return 'manager';
  return 'individual_contributor';
}
