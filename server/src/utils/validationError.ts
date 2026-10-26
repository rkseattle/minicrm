/**
 * The 400 every controller returns when its Zod schema refuses a request.
 *
 * One definition, so the envelope and which issue is reported cannot drift between the
 * controllers that validate input.
 */

import type { Response } from 'express';
import type { z } from 'zod';
import { errorBody } from './errorBody.js';

export const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR';

const HTTP_BAD_REQUEST = 400;
const NO_ISSUE_MESSAGE = 'Invalid request';

/**
 * The message a validation failure reports: its first issue's.
 *
 * @param error - the error from a failed `safeParse`
 * @returns the first issue's message, or a generic one for an error with no issues
 */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? NO_ISSUE_MESSAGE;
}

/**
 * Sends `400 { error: { code: 'VALIDATION_ERROR', message } }` for input refused by a check
 * that is not a Zod schema.
 *
 * @param res - the response to write
 * @param message - what the caller must fix
 */
export function respondValidationMessage(res: Response, message: string): void {
  res.status(HTTP_BAD_REQUEST).json(errorBody(VALIDATION_ERROR_CODE, message));
}

/**
 * Sends `400 { error: { code: 'VALIDATION_ERROR', message } }` for a failed parse.
 *
 * @param res - the response to write
 * @param error - the error from a failed `safeParse`
 */
export function respondValidationError(res: Response, error: z.ZodError): void {
  respondValidationMessage(res, firstIssueMessage(error));
}
