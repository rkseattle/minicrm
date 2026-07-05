/**
 * Shared error-mapping helper for AI service controllers.
 * Every one-shot AI service (dealHealthService, emailDraftService, etc.) tags
 * thrown errors with a statusCode of 502 (provider error) or 503 (not
 * configured) — this maps those to the standard error response shape.
 */

import type { Response } from 'express';

/** Error shape thrown by AI service functions: statusCode is 502 or 503, others rethrow. */
interface TaggedAiError {
  statusCode?: number;
  message?: string;
}

/**
 * Maps a caught AI-service error to an HTTP response.
 * Returns true if the error was handled (502/503); false means the caller
 * must rethrow, since only those two statusCodes are AI-service-specific.
 */
export function handleAiServiceError(err: unknown, res: Response): boolean {
  const tagged = err as TaggedAiError;
  if (tagged.statusCode === 502) {
    res.status(502).json({
      error: { code: 'AI_PROVIDER_ERROR', message: tagged.message ?? 'AI provider error' },
    });
    return true;
  }
  if (tagged.statusCode === 503) {
    res.status(503).json({
      error: { code: 'AI_NOT_CONFIGURED', message: tagged.message ?? 'AI is not configured' },
    });
    return true;
  }
  return false;
}
