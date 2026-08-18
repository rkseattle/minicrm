/**
 * Multi-signal duplicate-match scoring engine.
 *
 * Deterministic, on-demand scoring of how likely two contact (or account)
 * records are duplicates — computed on read, never persisted, and matching
 * this codebase's convention of not maintaining a background match-scan job.
 * Pure data comparison — no AI call is made here; the AI explanation
 * feature consumes this score's matched_signals as input to its prompt.
 */

import type {
  DuplicateMatchResult,
  DuplicateMatchSignal,
} from '@minicrm/shared/schemas/duplicateMatchSchema.js';

/** Points contributed by each signal toward the 0-100 composite score. */
const SIGNAL_WEIGHTS: Record<DuplicateMatchSignal, number> = {
  exact_email: 60,
  email_domain: 15,
  similar_name: 20,
  phone_match: 15,
  company_match: 10,
};

/** Maximum possible composite score, used to cap the sum of all matched signal weights. */
const MAX_SCORE = 100;

/** Normalized name-similarity ratio (0-1) at or above which names are considered "similar". */
const NAME_SIMILARITY_THRESHOLD = 0.82;

export interface DuplicateMatchCandidate {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  /** Company name — resolved from the linked account, when present. */
  company_name: string | null;
}

/** Strips non-digit characters so phone numbers with different formatting still compare equal. */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Extracts the domain portion of an email address, lowercased. */
function emailDomain(email: string): string {
  return email.toLowerCase().split('@')[1] ?? '';
}

/**
 * Computes the Levenshtein edit distance between two strings.
 * Standard dynamic-programming implementation, O(m*n) time and space.
 */
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) distances[i]![0] = i;
  for (let j = 0; j < cols; j++) distances[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i]![j] = Math.min(
        distances[i - 1]![j]! + 1,
        distances[i]![j - 1]! + 1,
        distances[i - 1]![j - 1]! + substitutionCost,
      );
    }
  }

  return distances[rows - 1]![cols - 1]!;
}

/** Returns a 0-1 similarity ratio derived from Levenshtein distance, normalized by the longer string's length. */
function nameSimilarityRatio(a: string, b: string): number {
  const normalizedA = a.trim().toLowerCase();
  const normalizedB = b.trim().toLowerCase();
  if (normalizedA === '' && normalizedB === '') return 1;
  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  if (maxLength === 0) return 1;
  const distance = levenshteinDistance(normalizedA, normalizedB);
  return 1 - distance / maxLength;
}

/**
 * Scores how likely two contact (or account-linked-contact) records are
 * duplicates, based on email, name, phone, and company signals.
 *
 * @param a - First candidate record.
 * @param b - Second candidate record.
 * @returns Composite 0-100 score and the list of signals that matched.
 */
export function scoreDuplicateMatch(
  a: DuplicateMatchCandidate,
  b: DuplicateMatchCandidate,
): DuplicateMatchResult {
  const matchedSignals: DuplicateMatchSignal[] = [];

  const emailA = a.email.toLowerCase().trim();
  const emailB = b.email.toLowerCase().trim();

  if (emailA !== '' && emailA === emailB) {
    matchedSignals.push('exact_email');
  } else if (emailDomain(emailA) !== '' && emailDomain(emailA) === emailDomain(emailB)) {
    matchedSignals.push('email_domain');
  }

  const fullNameA = `${a.first_name} ${a.last_name}`;
  const fullNameB = `${b.first_name} ${b.last_name}`;
  if (nameSimilarityRatio(fullNameA, fullNameB) >= NAME_SIMILARITY_THRESHOLD) {
    matchedSignals.push('similar_name');
  }

  if (a.phone && b.phone) {
    const normalizedPhoneA = normalizePhone(a.phone);
    const normalizedPhoneB = normalizePhone(b.phone);
    if (normalizedPhoneA !== '' && normalizedPhoneA === normalizedPhoneB) {
      matchedSignals.push('phone_match');
    }
  }

  if (a.company_name && b.company_name) {
    if (a.company_name.trim().toLowerCase() === b.company_name.trim().toLowerCase()) {
      matchedSignals.push('company_match');
    }
  }

  const rawScore = matchedSignals.reduce((sum, signal) => sum + SIGNAL_WEIGHTS[signal], 0);

  return {
    score: Math.min(rawScore, MAX_SCORE),
    matched_signals: matchedSignals,
  };
}
