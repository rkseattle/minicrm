/**
 * Unit tests for the seniority classifier. (MINCRM-467)
 * Pure function, no I/O — no test database required.
 */

import { describe, it, expect } from 'vitest';
import { classifySeniority } from '../services/seniorityClassifier.js';

describe('classifySeniority', () => {
  it('classifies C-suite titles as executive', () => {
    expect(classifySeniority('Chief Technology Officer')).toBe('executive');
    expect(classifySeniority('CEO')).toBe('executive');
    expect(classifySeniority('Founder')).toBe('executive');
  });

  it('classifies VP/Director titles as senior', () => {
    expect(classifySeniority('VP of Engineering')).toBe('senior');
    expect(classifySeniority('Director of Sales')).toBe('senior');
    expect(classifySeniority('Head of Product')).toBe('senior');
  });

  it('classifies manager/lead titles as manager', () => {
    expect(classifySeniority('Engineering Manager')).toBe('manager');
    expect(classifySeniority('Team Lead')).toBe('manager');
  });

  it('classifies unmatched titles as individual_contributor', () => {
    expect(classifySeniority('Software Engineer')).toBe('individual_contributor');
    expect(classifySeniority('Coordinator')).toBe('individual_contributor');
  });

  it('classifies null/undefined/empty titles as individual_contributor (conservative default)', () => {
    expect(classifySeniority(null)).toBe('individual_contributor');
    expect(classifySeniority(undefined)).toBe('individual_contributor');
    expect(classifySeniority('')).toBe('individual_contributor');
    expect(classifySeniority('   ')).toBe('individual_contributor');
  });

  it('prioritizes executive keyword over manager keyword in the same title', () => {
    // "VP of Engineering" must not be misclassified as manager via "Engineering".
    expect(classifySeniority('Chief Product Manager')).toBe('executive');
  });
});
