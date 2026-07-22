/**
 * Coverage/TIA pipeline controller — request/response shaping for the
 * ingestion trigger endpoint. No business logic here; all symbolication and
 * storage goes through coverageIngestionService. (MINCRM-614)
 * Admin-only, feature-flag gated (enforced by the route layer).
 */

import type { Request, Response } from 'express';
import { ingestCoverageDumpRequestSchema } from '@minicrm/shared/schemas/coveragePipelineSchema.js';
import {
  CoverageDumpMalformedError,
  CoverageDumpNotFoundError,
  ingestCoverageDump,
} from '../coverageAgent/pipeline/coverageIngestionService.js';

/**
 * POST /api/v1/admin/coverage/pipeline/ingest
 * Normalizes and symbolicates a single already-persisted raw coverage dump
 * into the coverage_units storage model. Idempotent — re-ingesting a known
 * dumpId is a no-op. Admin only.
 */
export async function ingestCoverageDumpHandler(req: Request, res: Response): Promise<void> {
  const parsed = ingestCoverageDumpRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  try {
    const result = await ingestCoverageDump(parsed.data.dumpId);
    // 201 only when this call actually created new coverage_units state;
    // a true no-op (already ingested by an earlier call) reports 200,
    // matching the idempotent-PUT convention rather than always claiming
    // "created" for a request that changed nothing.
    res.status(result.alreadyIngested ? 200 : 201).json({ result });
  } catch (err) {
    if (err instanceof CoverageDumpNotFoundError) {
      res.status(404).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof CoverageDumpMalformedError) {
      res.status(400).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }
}
