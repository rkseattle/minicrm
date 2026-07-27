/**
 * Coverage/TIA mapping query controller — request/response shaping only.
 * All DB access goes through coverageMappingService. (MINCRM-621)
 * Admin-only, feature-flag gated (enforced by the route layer).
 */

import type { Request, Response } from 'express';
import {
  findTestsForUnitRequestSchema,
  findUnitsForTestRequestSchema,
  searchUnitKeysRequestSchema,
  searchTestIdsRequestSchema,
} from '@minicrm/shared/schemas/coverageMappingSchema.js';
import {
  findTestsForUnitWithConfidence,
  findUnitsForTestWithConfidence,
  searchTestIds,
} from '../services/coverageMappingService.js';
import { searchUnitKeys } from '../services/coverageModelService.js';

/**
 * GET /api/v1/admin/coverage/mapping/tests-for-unit
 * Finds every test known to cover a given code unit, at a given commit,
 * with confidence/freshness attached. Admin only.
 */
export async function findTestsForUnitHandler(req: Request, res: Response): Promise<void> {
  const parsed = findTestsForUnitRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const results = await findTestsForUnitWithConfidence(
    parsed.data.commitSha,
    parsed.data.unitKey,
    parsed.data.branchId ?? null,
  );
  res.status(200).json({ results });
}

/**
 * GET /api/v1/admin/coverage/mapping/units-for-test
 * Finds every code unit a given test is known to cover, at a given commit,
 * with confidence/freshness attached. Admin only.
 */
export async function findUnitsForTestHandler(req: Request, res: Response): Promise<void> {
  const parsed = findUnitsForTestRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const results = await findUnitsForTestWithConfidence(parsed.data.commitSha, parsed.data.testId);
  res.status(200).json({ results });
}

/**
 * GET /api/v1/admin/coverage/mapping/unit-keys/search
 * Typeahead search over unit keys for a given commit. Admin only.
 */
export async function searchUnitKeysHandler(req: Request, res: Response): Promise<void> {
  const parsed = searchUnitKeysRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const results = await searchUnitKeys(
    parsed.data.commitSha,
    parsed.data.search,
    parsed.data.limit,
  );
  res.status(200).json({ results });
}

/**
 * GET /api/v1/admin/coverage/mapping/test-ids/search
 * Typeahead search over test IDs/names for a given commit. Admin only.
 */
export async function searchTestIdsHandler(req: Request, res: Response): Promise<void> {
  const parsed = searchTestIdsRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const results = await searchTestIds(parsed.data.commitSha, parsed.data.search, parsed.data.limit);
  res.status(200).json({ results });
}
