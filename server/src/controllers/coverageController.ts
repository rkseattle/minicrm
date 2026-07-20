/**
 * Coverage/TIA controller — request/response shaping for the coverage
 * control API. No business logic here; all agent access and dump
 * persistence goes through coverageDumpService. (MINCRM-606)
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

const DEFAULT_DUMP_LABEL = 'unlabeled';

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
      res.status(201).json({ dump });
      return;
    }

    const dump = await dumpBackendCoverage(label);
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
