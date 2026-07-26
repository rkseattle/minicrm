/**
 * Unit tests for coveragePolicyConfig. (MINCRM-637)
 *
 * Covers env-var resolution/defaults for the three policy axes this module
 * centralizes on top of coverageConfig.ts's own granularity/commitSha:
 * retention days, and the two safety-net thresholds.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCoveragePolicy } from '../coverageAgent/coveragePolicyConfig.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.COVERAGE_RETENTION_DAYS;
  delete process.env.TIA_MIN_CONFIDENCE_THRESHOLD;
  delete process.env.TIA_MAX_UNMAPPED_RATIO;
  delete process.env.COVERAGE_GRANULARITY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('resolveCoveragePolicy', () => {
  it('defaults retentionDays to 30 when COVERAGE_RETENTION_DAYS is unset', () => {
    expect(resolveCoveragePolicy().retentionDays).toBe(30);
  });

  it('parses a valid COVERAGE_RETENTION_DAYS override', () => {
    process.env.COVERAGE_RETENTION_DAYS = '14';
    expect(resolveCoveragePolicy().retentionDays).toBe(14);
  });

  it('falls back to the default for a non-numeric COVERAGE_RETENTION_DAYS', () => {
    process.env.COVERAGE_RETENTION_DAYS = 'not-a-number';
    expect(resolveCoveragePolicy().retentionDays).toBe(30);
  });

  it('falls back to the default for a zero or negative COVERAGE_RETENTION_DAYS', () => {
    process.env.COVERAGE_RETENTION_DAYS = '0';
    expect(resolveCoveragePolicy().retentionDays).toBe(30);

    process.env.COVERAGE_RETENTION_DAYS = '-5';
    expect(resolveCoveragePolicy().retentionDays).toBe(30);
  });

  it('falls back to the default for a non-integer COVERAGE_RETENTION_DAYS — "days a row survives" implies a whole number, and a fraction would silently flow into a fractional-day SQL interval', () => {
    process.env.COVERAGE_RETENTION_DAYS = '30.7';
    expect(resolveCoveragePolicy().retentionDays).toBe(30);
  });

  it('defaults minConfidenceThreshold to 0.3 when TIA_MIN_CONFIDENCE_THRESHOLD is unset', () => {
    expect(resolveCoveragePolicy().minConfidenceThreshold).toBe(0.3);
  });

  it('parses a valid TIA_MIN_CONFIDENCE_THRESHOLD override', () => {
    process.env.TIA_MIN_CONFIDENCE_THRESHOLD = '0.6';
    expect(resolveCoveragePolicy().minConfidenceThreshold).toBe(0.6);
  });

  it('falls back to the default for a non-numeric TIA_MIN_CONFIDENCE_THRESHOLD', () => {
    process.env.TIA_MIN_CONFIDENCE_THRESHOLD = 'not-a-number';
    expect(resolveCoveragePolicy().minConfidenceThreshold).toBe(0.3);
  });

  it('falls back to the default for a TIA_MIN_CONFIDENCE_THRESHOLD outside [0, 1] — a negative value would silently disable the low-confidence safety-net check entirely', () => {
    process.env.TIA_MIN_CONFIDENCE_THRESHOLD = '-1';
    expect(resolveCoveragePolicy().minConfidenceThreshold).toBe(0.3);

    process.env.TIA_MIN_CONFIDENCE_THRESHOLD = '1.5';
    expect(resolveCoveragePolicy().minConfidenceThreshold).toBe(0.3);
  });

  it('accepts the boundary values 0 and 1 for TIA_MIN_CONFIDENCE_THRESHOLD', () => {
    process.env.TIA_MIN_CONFIDENCE_THRESHOLD = '0';
    expect(resolveCoveragePolicy().minConfidenceThreshold).toBe(0);

    process.env.TIA_MIN_CONFIDENCE_THRESHOLD = '1';
    expect(resolveCoveragePolicy().minConfidenceThreshold).toBe(1);
  });

  it('defaults maxUnmappedRatio to 0.5 when TIA_MAX_UNMAPPED_RATIO is unset', () => {
    expect(resolveCoveragePolicy().maxUnmappedRatio).toBe(0.5);
  });

  it('parses a valid TIA_MAX_UNMAPPED_RATIO override', () => {
    process.env.TIA_MAX_UNMAPPED_RATIO = '0.75';
    expect(resolveCoveragePolicy().maxUnmappedRatio).toBe(0.75);
  });

  it('falls back to the default for a non-numeric TIA_MAX_UNMAPPED_RATIO', () => {
    process.env.TIA_MAX_UNMAPPED_RATIO = 'not-a-number';
    expect(resolveCoveragePolicy().maxUnmappedRatio).toBe(0.5);
  });

  it('falls back to the default for a TIA_MAX_UNMAPPED_RATIO outside [0, 1] — a value above 1 would silently disable the unmapped-ratio safety-net check entirely (the computed ratio can never exceed 1)', () => {
    process.env.TIA_MAX_UNMAPPED_RATIO = '-0.1';
    expect(resolveCoveragePolicy().maxUnmappedRatio).toBe(0.5);

    process.env.TIA_MAX_UNMAPPED_RATIO = '100';
    expect(resolveCoveragePolicy().maxUnmappedRatio).toBe(0.5);
  });

  it('accepts the boundary values 0 and 1 for TIA_MAX_UNMAPPED_RATIO', () => {
    process.env.TIA_MAX_UNMAPPED_RATIO = '0';
    expect(resolveCoveragePolicy().maxUnmappedRatio).toBe(0);

    process.env.TIA_MAX_UNMAPPED_RATIO = '1';
    expect(resolveCoveragePolicy().maxUnmappedRatio).toBe(1);
  });

  it('re-exports granularity/commitSha from coverageConfig.ts rather than re-deriving them', () => {
    process.env.COVERAGE_GRANULARITY = 'function';
    const policy = resolveCoveragePolicy();
    expect(policy.granularity).toBe('function');
    expect(typeof policy.commitSha).toBe('string');
    expect(policy.commitSha.length).toBeGreaterThan(0);
  });
});
