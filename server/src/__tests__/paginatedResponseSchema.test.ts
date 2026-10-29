/**
 * Unit tests for paginatedResponseSchema, the Zod form of the list envelope.
 */

import { z } from 'zod';

import { paginatedResponseSchema } from '@minicrm/shared/schemas/paginationSchema.js';

const pageOf = paginatedResponseSchema(z.object({ id: z.string() }));
const VALID = { data: [{ id: 'a' }], total: 1, page: 1, limit: 25 };

describe('paginatedResponseSchema', () => {
  it('accepts a well-formed page, and an empty one', () => {
    expect(pageOf.safeParse(VALID).success).toBe(true);
    expect(pageOf.safeParse({ ...VALID, data: [], total: 0 }).success).toBe(true);
  });

  it('refuses a page below 1, a limit below 1, and a negative total', () => {
    for (const bad of [
      { ...VALID, page: 0 },
      { ...VALID, limit: 0 },
      { ...VALID, total: -1 },
      { ...VALID, page: 1.5 },
    ]) {
      expect(pageOf.safeParse(bad).success).toBe(false);
    }
  });

  it('validates each item with the schema it was given', () => {
    expect(pageOf.safeParse({ ...VALID, data: [{ id: 7 }] }).success).toBe(false);
    expect(pageOf.safeParse({ ...VALID, data: undefined }).success).toBe(false);
  });
});
