/**
 * Coverage/TIA controller — request/response shaping for the coverage
 * control API. No business logic here; all agent access and dump
 * persistence goes through coverageDumpService.
 * All endpoints are admin-only, feature-flag gated (enforced by the route layer).
 */

import type { Request, Response } from 'express';
import {
  coverageDumpRequestSchema,
  coverageSnapshotRequestSchema,
} from '@minicrm/shared/schemas/coverageSchema.js';
import {
  CoverageNotEnabledError,
  dumpBackendCoverage,
  findCoverageDump,
  ingestBrowserCoverage,
  resetCoverage,
  snapshotCoverage,
} from '../services/coverageDumpService.js';
import {
  findActiveCoverageSessionByCorrelationId,
  recordCoverageSessionDump,
} from '../services/coverageSessionService.js';
import logger from '../logger.js';

const DEFAULT_DUMP_LABEL = 'unlabeled';

/**
 * Best-effort: if the caller sent x-coverage-correlation-id (see
 * correlationId middleware) and it matches a currently-active session,
 * attributes this dump to that session automatically — the auto-attribution
 * path describes ("agent partitions coverage by correlation ID
 * rather than global reset/dump"), so callers that already propagate the
 * header don't also need to separately call the record-dump endpoint.
 * Never allowed to fail the dump response itself: attribution is
 * observability layered on top of the dump, not a precondition for it.
 */
async function attributeDumpToSessionIfCorrelated(req: Request, dumpId: string): Promise<void> {
  const correlationId = req.coverageCorrelationId;
  if (!correlationId) return;

  try {
    const session = await findActiveCoverageSessionByCorrelationId(correlationId);
    if (!session) return;
    await recordCoverageSessionDump(session.id, dumpId, correlationId);
  } catch (err) {
    logger.warn(
      { err, dumpId, correlationId },
      'dumpCoverageHandler: failed to auto-attribute dump to correlated session',
    );
  }
}

/**
 * POST /api/v1/admin/coverage/reset
 * Resets the backend V8 coverage agent's counters. Admin only.
 */
export async function resetCoverageHandler(_req: Request, res: Response): Promise<void> {
  try {
    await resetCoverage();
  } catch (err) {
    if (err instanceof CoverageNotEnabledError) {
      res.status(409).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }
  res.status(204).send();
}

/**
 * POST /api/v1/admin/coverage/snapshot
 * Reads current backend counters without writing an artifact to disk.
 * NOTE: V8's takePreciseCoverage() resets counters as a side effect of
 * reading them — this is not a non-destructive read. Admin only.
 */
export async function snapshotCoverageHandler(req: Request, res: Response): Promise<void> {
  const parsed = coverageSnapshotRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  try {
    const dump = await snapshotCoverage(parsed.data.label ?? DEFAULT_DUMP_LABEL);
    res.status(200).json({ dump });
  } catch (err) {
    if (err instanceof CoverageNotEnabledError) {
      res.status(409).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }
}

/**
 * POST /api/v1/admin/coverage/dump
 * Persists a tagged coverage dump. With no `source`/`payload`, dumps the
 * backend agent. With `{ source: 'browser', payload, label }`, ingests an
 * already-collected frontend Istanbul dump without touching the agent.
 * Admin only.
 */
export async function dumpCoverageHandler(req: Request, res: Response): Promise<void> {
  const parsed = coverageDumpRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const { label, source, payload } = parsed.data;

  try {
    if (source === 'browser') {
      if (!payload) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'payload is required when source is "browser"',
          },
        });
        return;
      }
      const dump = await ingestBrowserCoverage(label, payload);
      await attributeDumpToSessionIfCorrelated(req, dump.dumpId);
      res.status(201).json({ dump });
      return;
    }

    const dump = await dumpBackendCoverage(label);
    await attributeDumpToSessionIfCorrelated(req, dump.dumpId);
    res.status(201).json({ dump });
  } catch (err) {
    if (err instanceof CoverageNotEnabledError) {
      res.status(409).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }
}

/**
 * GET /api/v1/admin/coverage/dumps/:dumpId
 * Looks up metadata for a previously produced dump. Admin only.
 */
export async function getCoverageDumpHandler(req: Request, res: Response): Promise<void> {
  const dumpId = String(req.params['dumpId']);
  const dump = await findCoverageDump(dumpId);

  if (!dump) {
    res.status(404).json({ error: { code: 'DUMP_NOT_FOUND', message: 'Coverage dump not found' } });
    return;
  }

  res.status(200).json({ dump });
}
