/**
 * Unit tests for the E2E-only seams: honored outside production, refused at boot inside it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  NON_PRODUCTION_SEAM_KEYS,
  nonProductionSeam,
  nonProductionSeamProblem,
} from '../utils/nonProductionSeams.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

function clearSeams(): void {
  for (const key of NON_PRODUCTION_SEAM_KEYS) vi.stubEnv(key, '');
}

describe('nonProductionSeam', () => {
  it('returns the trimmed value under development and test', () => {
    for (const env of ['development', 'test']) {
      vi.stubEnv('NODE_ENV', env);
      vi.stubEnv('SSRF_ALLOWED_PRIVATE_HOSTS', '  greenmail  ');
      expect(nonProductionSeam('SSRF_ALLOWED_PRIVATE_HOSTS')).toBe('greenmail');
    }
  });

  it('is inert under production, staging, and an unrecognized NODE_ENV', () => {
    for (const env of ['production', 'staging', 'producton', '']) {
      vi.stubEnv('NODE_ENV', env);
      vi.stubEnv('GMAIL_API_BASE_URL', 'http://localhost:4010/gmail/v1/users/me');
      expect(nonProductionSeam('GMAIL_API_BASE_URL')).toBeUndefined();
    }
  });

  it('treats a blank value as unset', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EMAIL_SYNC_SCHEDULER', '   ');
    expect(nonProductionSeam('EMAIL_SYNC_SCHEDULER')).toBeUndefined();
  });
});

describe('nonProductionSeamProblem', () => {
  it('is null when no seam is set, in any environment', () => {
    clearSeams();
    for (const env of ['production', 'staging', 'development', 'test']) {
      vi.stubEnv('NODE_ENV', env);
      expect(nonProductionSeamProblem()).toBeNull();
    }
  });

  it('names every seam set outside development and test', () => {
    clearSeams();
    for (const env of ['production', 'staging']) {
      vi.stubEnv('NODE_ENV', env);
      vi.stubEnv('SSRF_ALLOWED_PRIVATE_HOSTS', 'greenmail');
      vi.stubEnv('EMAIL_SYNC_SCHEDULER', 'off');
      const problem = nonProductionSeamProblem();
      expect(problem).toContain('SSRF_ALLOWED_PRIVATE_HOSTS, EMAIL_SYNC_SCHEDULER are set');
      expect(problem).toContain(`'${env}'`);
      expect(problem).not.toContain('GMAIL_API_BASE_URL');
    }
  });

  it('uses the singular when exactly one seam is set', () => {
    clearSeams();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GRAPH_API_BASE_URL', 'http://mail-emulator:4010/v1.0/me');
    expect(nonProductionSeamProblem()).toContain('GRAPH_API_BASE_URL is set, but NODE_ENV');
  });

  it('accepts valid values under test', () => {
    clearSeams();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SSRF_ALLOWED_PRIVATE_HOSTS', 'greenmail,localhost');
    vi.stubEnv('GMAIL_API_BASE_URL', 'http://mail-emulator:4010/gmail/v1/users/me');
    vi.stubEnv('GRAPH_API_BASE_URL', 'https://mail-emulator:4010/v1.0/me');
    vi.stubEnv('EMAIL_SYNC_SCHEDULER', 'on');
    expect(nonProductionSeamProblem()).toBeNull();
  });

  it('refuses a malformed, non-http, or slash-terminated base URL', () => {
    clearSeams();
    vi.stubEnv('NODE_ENV', 'test');
    const cases: Array<[string, string]> = [
      ['not a url', 'is not a valid URL'],
      ['ftp://mail-emulator/gmail', 'must be an http or https URL'],
      ['http://mail-emulator:4010/gmail/', 'must not end with a slash'],
      ['http://mail-emulator:4010/gmail?a=1', 'must not carry a query or fragment'],
      ['http://mail-emulator:4010/gmail#x', 'must not carry a query or fragment'],
    ];
    for (const [value, expected] of cases) {
      vi.stubEnv('GRAPH_API_BASE_URL', value);
      expect(nonProductionSeamProblem()).toContain(`GRAPH_API_BASE_URL ${expected}`);
    }
  });

  it('refuses an EMAIL_SYNC_SCHEDULER other than on or off', () => {
    clearSeams();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_SYNC_SCHEDULER', 'disabled');
    expect(nonProductionSeamProblem()).toBe(
      'EMAIL_SYNC_SCHEDULER must be one of on, off: disabled',
    );
  });
});
