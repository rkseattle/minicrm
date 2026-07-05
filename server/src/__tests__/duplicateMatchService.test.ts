/**
 * Unit tests for the duplicate-match scoring engine. (MINCRM-440 prerequisite)
 * Pure function — no database, no mocking required.
 */

import { scoreDuplicateMatch } from '../services/duplicateMatchService.js';
import type { DuplicateMatchCandidate } from '../services/duplicateMatchService.js';

function candidate(overrides: Partial<DuplicateMatchCandidate> = {}): DuplicateMatchCandidate {
  return {
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane.doe@example.com',
    phone: '+1 (555) 123-4567',
    company_name: 'Acme Corp',
    ...overrides,
  };
}

describe('scoreDuplicateMatch', () => {
  it('scores an exact email match highest, with all other signals also matching', () => {
    const a = candidate();
    const b = candidate();

    const result = scoreDuplicateMatch(a, b);

    expect(result.matched_signals).toContain('exact_email');
    expect(result.matched_signals).toContain('similar_name');
    expect(result.matched_signals).toContain('phone_match');
    expect(result.matched_signals).toContain('company_match');
    expect(result.score).toBe(100);
  });

  it('matches phone numbers with different formatting as the same number', () => {
    const a = candidate({ phone: '555-123-4567', email: 'a@x.com' });
    const b = candidate({ phone: '(555) 123-4567', email: 'b@y.com' });

    const result = scoreDuplicateMatch(a, b);

    expect(result.matched_signals).toContain('phone_match');
  });

  it('detects a shared email domain when the local part differs', () => {
    const a = candidate({ email: 'jane@acme.com', phone: null, company_name: null });
    const b = candidate({
      email: 'jsmith@acme.com',
      first_name: 'John',
      last_name: 'Smith',
      phone: null,
      company_name: null,
    });

    const result = scoreDuplicateMatch(a, b);

    expect(result.matched_signals).toEqual(['email_domain']);
    expect(result.score).toBe(15);
  });

  it('detects similar names with a minor typo as similar_name', () => {
    const a = candidate({
      first_name: 'Jonathan',
      last_name: 'Smith',
      email: 'a@x.com',
      phone: null,
      company_name: null,
    });
    const b = candidate({
      first_name: 'Jonathon',
      last_name: 'Smith',
      email: 'b@y.com',
      phone: null,
      company_name: null,
    });

    const result = scoreDuplicateMatch(a, b);

    expect(result.matched_signals).toContain('similar_name');
  });

  it('does not flag clearly different names as similar', () => {
    const a = candidate({
      first_name: 'Alice',
      last_name: 'Anderson',
      email: 'a@x.com',
      phone: null,
      company_name: null,
    });
    const b = candidate({
      first_name: 'Bob',
      last_name: 'Baker',
      email: 'b@y.com',
      phone: null,
      company_name: null,
    });

    const result = scoreDuplicateMatch(a, b);

    expect(result.matched_signals).not.toContain('similar_name');
    expect(result.score).toBe(0);
  });

  it('matches company names case-insensitively', () => {
    const a = candidate({
      company_name: 'ACME CORP',
      email: 'a@x.com',
      phone: null,
      first_name: 'Alice',
      last_name: 'Zephyr',
    });
    const b = candidate({
      company_name: 'acme corp',
      email: 'b@y.com',
      phone: null,
      first_name: 'Bob',
      last_name: 'Yankton',
    });

    const result = scoreDuplicateMatch(a, b);

    expect(result.matched_signals).toContain('company_match');
  });

  it('caps the composite score at 100 even if weights would sum higher', () => {
    // exact_email(60) + similar_name(20) + phone_match(15) + company_match(10) = 105, capped to 100
    const a = candidate();
    const b = candidate();

    const result = scoreDuplicateMatch(a, b);

    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('returns a zero score and no matched signals for completely unrelated records', () => {
    const a = candidate({
      first_name: 'Alice',
      last_name: 'Anderson',
      email: 'alice@foo.com',
      phone: '111-111-1111',
      company_name: 'Foo Inc',
    });
    const b = candidate({
      first_name: 'Zach',
      last_name: 'Zimmerman',
      email: 'zach@bar.com',
      phone: '222-222-2222',
      company_name: 'Bar LLC',
    });

    const result = scoreDuplicateMatch(a, b);

    expect(result.matched_signals).toEqual([]);
    expect(result.score).toBe(0);
  });

  it('does not match phone when either side has no phone on file', () => {
    const a = candidate({ phone: null, email: 'a@x.com', company_name: null });
    const b = candidate({ phone: '555-123-4567', email: 'b@y.com', company_name: null });

    const result = scoreDuplicateMatch(a, b);

    expect(result.matched_signals).not.toContain('phone_match');
  });
});
