import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { typeErrorMessages } from '@minicrm/shared/schemas/typeErrorMessages.js';

function firstMessage(schema: z.ZodType, input: unknown): string | undefined {
  const parsed = schema.safeParse(input);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

describe('typeErrorMessages', () => {
  const both = z.object({
    name: z.string(
      typeErrorMessages({ required: 'Name is required', invalid: 'Name must be text' }),
    ),
  });

  it('reports the required message for a missing value', () => {
    expect(firstMessage(both, {})).toBe('Name is required');
  });

  it('reports the invalid message for a value of the wrong type', () => {
    expect(firstMessage(both, { name: 42 })).toBe('Name must be text');
  });

  it("falls back to Zod's message for the case it was not given", () => {
    const requiredOnly = z.object({
      name: z.string(typeErrorMessages({ required: 'Name is required' })),
    });
    const zodDefault = firstMessage(z.object({ name: z.string() }), { name: 42 });

    expect(firstMessage(requiredOnly, { name: 42 })).toBe(zodDefault);
    expect(firstMessage(requiredOnly, {})).toBe('Name is required');
  });

  it('applies to enums, where an out-of-range value is the invalid case', () => {
    const role = z.enum(
      ['lead', 'member'],
      typeErrorMessages({ required: 'Role is required', invalid: 'Bad role' }),
    );

    expect(firstMessage(role, undefined)).toBe('Role is required');
    expect(firstMessage(role, 'owner')).toBe('Bad role');
  });

  it('treats null as present, so it gets the invalid message', () => {
    expect(firstMessage(both, { name: null })).toBe('Name must be text');
  });

  it("leaves a later check that has no message of its own to Zod's message", () => {
    const name = z
      .string(typeErrorMessages({ required: 'Name is required', invalid: 'Name must be text' }))
      .min(1);
    const zodDefault = firstMessage(z.string().min(1), '');

    expect(firstMessage(name, '')).toBe(zodDefault);
    expect(zodDefault).not.toBe('Name must be text');
  });

  it('leaves later checks their own messages', () => {
    const name = z
      .string(typeErrorMessages({ required: 'Name is required' }))
      .min(1, 'Name cannot be empty');

    expect(firstMessage(name, '')).toBe('Name cannot be empty');
  });
});
