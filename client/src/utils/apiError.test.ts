/**
 * Unit tests for the resolveApiError utility.
 * Covers: known code → translated string, unknown code → generic fallback,
 * missing code → generic fallback, no response → generic fallback,
 * custom fallbackKey, and null/non-Axios errors.
 */

import { describe, it, expect, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { resolveApiError } from './apiError.js';

/** Minimal TFunction stub that simulates the i18next catalog. */
function makeTFunction(catalog: Record<string, string>): TFunction {
  return ((key: string, opts?: { defaultValue?: string }) => {
    return catalog[key] ?? opts?.defaultValue ?? key;
  }) as TFunction;
}

const CATALOG: Record<string, string> = {
  'errors.generic': 'Something went wrong. Please try again.',
  'errors.FORBIDDEN': "You don't have permission to perform this action.",
  'errors.NOT_FOUND': 'The requested resource was not found.',
  'errors.VALIDATION_ERROR': 'Please check your input and try again.',
  'errors.SMTP_ERROR': 'Failed to send email. Please check your SMTP settings.',
  'myTasks.completeError': 'Failed to mark task complete. Please try again.',
};

const t = makeTFunction(CATALOG);

/** Helper to build a minimal Axios-shaped error object. */
function makeAxiosError(code?: string, message?: string): unknown {
  return {
    response: {
      data: {
        error: {
          code,
          message: message ?? 'Server error message',
        },
      },
    },
  };
}

describe('resolveApiError', () => {
  it('returns the translated message for a known error code', () => {
    expect(resolveApiError(makeAxiosError('FORBIDDEN'), t)).toBe(
      "You don't have permission to perform this action.",
    );
  });

  it('returns the translated message for NOT_FOUND', () => {
    expect(resolveApiError(makeAxiosError('NOT_FOUND'), t)).toBe(
      'The requested resource was not found.',
    );
  });

  it('returns the translated message for VALIDATION_ERROR', () => {
    expect(resolveApiError(makeAxiosError('VALIDATION_ERROR'), t)).toBe(
      'Please check your input and try again.',
    );
  });

  it('falls back to errors.generic for an unknown error code', () => {
    expect(resolveApiError(makeAxiosError('UNKNOWN_CODE_XYZ'), t)).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('falls back to errors.generic when code is undefined', () => {
    expect(resolveApiError(makeAxiosError(undefined), t)).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('falls back to errors.generic when there is no response body', () => {
    expect(resolveApiError({ response: { data: {} } }, t)).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('falls back to errors.generic when the error has no response at all', () => {
    expect(resolveApiError(new Error('Network error'), t)).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('falls back to errors.generic when the error is null', () => {
    expect(resolveApiError(null, t)).toBe('Something went wrong. Please try again.');
  });

  it('falls back to errors.generic when the error is undefined', () => {
    expect(resolveApiError(undefined, t)).toBe('Something went wrong. Please try again.');
  });

  it('uses a custom fallbackKey when provided and the code is unknown', () => {
    expect(resolveApiError(makeAxiosError('UNKNOWN_CODE_XYZ'), t, 'myTasks.completeError')).toBe(
      'Failed to mark task complete. Please try again.',
    );
  });

  it('uses a custom fallbackKey when no code is present', () => {
    expect(resolveApiError(new Error('oops'), t, 'myTasks.completeError')).toBe(
      'Failed to mark task complete. Please try again.',
    );
  });

  it('does not use the raw server message string from the response body', () => {
    // The server message is English-only; it must never reach the UI
    const error = makeAxiosError('UNKNOWN_CODE_XYZ', 'Raw English server error');
    const result = resolveApiError(error, t);
    expect(result).not.toContain('Raw English server error');
    expect(result).toBe('Something went wrong. Please try again.');
  });

  it('prefers a known i18n translation over the custom fallbackKey', () => {
    // A known code should always win, even if a custom fallback is supplied
    expect(resolveApiError(makeAxiosError('FORBIDDEN'), t, 'myTasks.completeError')).toBe(
      "You don't have permission to perform this action.",
    );
  });

  it('calls the translate function with a defaultValue of empty string for the code lookup', () => {
    // Verifies the guard: t() returns '' for unknown keys, so we fall through to the fallback
    const tSpy = vi.fn((key: string, opts?: { defaultValue?: string }) => {
      if (key === 'errors.UNREGISTERED') return opts?.defaultValue ?? '';
      if (key === 'errors.generic') return 'Something went wrong. Please try again.';
      return key;
    }) as unknown as TFunction;

    const result = resolveApiError(makeAxiosError('UNREGISTERED'), tSpy);
    expect(result).toBe('Something went wrong. Please try again.');
    expect(tSpy).toHaveBeenCalledWith('errors.UNREGISTERED', { defaultValue: '' });
  });
});
