/**
 * Distinct messages for a missing value and a value of the wrong type.
 *
 * Zod 4 folded `required_error` and `invalid_type_error` into one `error` callback that also
 * receives every later check's issue. This answers only the two type cases, as the v3 options
 * did — a wrong type, `null`, or an enum value outside the set — and leaves every other issue
 * to its own message or Zod's.
 */

import type { z } from 'zod';

export interface TypeErrorMessages {
  required?: string;
  invalid?: string;
}

/**
 * Params for a Zod type constructor, e.g. `z.string(typeErrorMessages({ required: '…' }))`.
 *
 * @param messages - `required` when the value is absent, `invalid` when it is the wrong type
 * @returns an object carrying Zod 4's `error` callback
 */
export function typeErrorMessages(messages: TypeErrorMessages): {
  error: z.core.$ZodErrorMap;
} {
  return {
    error: (issue) => {
      if (issue.code !== 'invalid_type' && issue.code !== 'invalid_value') return undefined;
      return issue.input === undefined ? messages.required : messages.invalid;
    },
  };
}
