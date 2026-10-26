/**
 * Reads UUID route params, or answers 400 VALIDATION_ERROR for the whole request.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';

import { respondValidationMessage } from './validationError.js';

const uuid = z.string().uuid();

/**
 * The named route params, in order, when every one is a UUID.
 *
 * @param message - The 400's message when any is not.
 * @returns the params, or null once the 400 has been written.
 */
export function uuidParams(
  req: Request,
  res: Response,
  names: readonly string[],
  message: string,
): string[] | null {
  const values: string[] = [];
  for (const name of names) {
    const parsed = uuid.safeParse(req.params[name]);
    if (!parsed.success) {
      respondValidationMessage(res, message);
      return null;
    }
    values.push(parsed.data);
  }
  return values;
}
