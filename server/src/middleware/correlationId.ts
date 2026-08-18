/**
 * Coverage/TIA correlation-ID middleware.
 *
 * Reads the `x-coverage-correlation-id` header (see CORRELATION_ID_HEADER in
 * shared/schemas/coverageSessionSchema.ts) sent by the E2E harness or the
 * manual-testing session recorder, and exposes it as `req.coverageCorrelationId`
 * for downstream handlers to record dump attribution against.
 *
 * Deliberately does NOT reject requests missing the header or validate its
 * format beyond "non-empty string" — this runs on every request across the
 * whole app (mounted before route-specific middleware in app.ts) and must
 * stay a no-op for the overwhelming majority of requests that carry no
 * coverage correlation ID at all. Malformed/garbage header values are
 * harmless: they only ever get consulted by the coverage session recording
 * path, which itself validates the ID against an active session server-side.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { CORRELATION_ID_HEADER } from '@minicrm/shared/schemas/coverageSessionSchema.js';

export function correlationId(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers[CORRELATION_ID_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (value) {
      req.coverageCorrelationId = value;
    }
    next();
  };
}
