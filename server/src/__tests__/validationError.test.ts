import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { z } from 'zod';

import { firstIssueMessage, respondValidationError } from '../utils/validationError.js';

function refusal(input: unknown): z.ZodError {
  const parsed = z.object({ name: z.string().min(1, 'Name is required') }).safeParse(input);
  if (parsed.success) throw new Error('expected the schema to refuse');
  return parsed.error;
}

describe('firstIssueMessage', () => {
  it("reports the first issue's message", () => {
    expect(firstIssueMessage(refusal({ name: '' }))).toBe('Name is required');
  });

  it('falls back to a generic message for an error with no issues', () => {
    expect(firstIssueMessage(new z.ZodError([]))).toBe('Invalid request');
  });
});

describe('respondValidationError', () => {
  it('sends 400 with the VALIDATION_ERROR envelope', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    // Only status() and json() are called on the response.
    const res = { status } as unknown as Response;

    respondValidationError(res, refusal({ name: '' }));

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
    });
  });
});
