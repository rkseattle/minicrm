/**
 * Coverage/TIA reporting query controller — request/response shaping only.
 * All DB access goes through coverageReportingService. (MINCRM-629/630/631)
 * Admin-only, feature-flag gated (enforced by the route layer).
 */

import type { Request, Response } from 'express';
import {
  getCoverageSummaryRequestSchema,
  getCoverageTrendRequestSchema,
  getGapsRequestSchema,
  getIssueCoverageRequestSchema,
  listIssueKeysRequestSchema,
  getTiaValueMetricsRequestSchema,
} from '@minicrm/shared/schemas/coverageReportingSchema.js';
import {
  CoverageBuildNotFoundError,
  getCoverageSummary,
  getCoverageTrend,
  findDeadZoneUnits,
  findNeverTakenBranches,
  findChangedUntestedUnits,
  getIssueCoverage,
  listIssueKeysForCommit,
  getTiaValueMetrics,
} from '../services/coverageReportingService.js';

function respondValidationError(res: Response, message: string): void {
  res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
}

/**
 * GET /api/v1/admin/coverage/reporting/summary
 * Overall + per-tier coverage percentage for a single build. Admin only.
 */
export async function getCoverageSummaryHandler(req: Request, res: Response): Promise<void> {
  const parsed = getCoverageSummaryRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error.errors[0].message);
    return;
  }

  try {
    const summary = await getCoverageSummary(parsed.data.commitSha);
    res.status(200).json({ summary });
  } catch (err) {
    if (err instanceof CoverageBuildNotFoundError) {
      res.status(404).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }
}

/**
 * GET /api/v1/admin/coverage/reporting/trend
 * Coverage summaries for the most recent builds, most recent first. Admin only.
 */
export async function getCoverageTrendHandler(req: Request, res: Response): Promise<void> {
  const parsed = getCoverageTrendRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error.errors[0].message);
    return;
  }

  const results = await getCoverageTrend(parsed.data.limit);
  res.status(200).json({ results });
}

/**
 * GET /api/v1/admin/coverage/reporting/gaps
 * Dead zones, never-taken branches, and (when baseSha is supplied)
 * changed-but-untested units for a baseSha..commitSha range. Admin only.
 */
export async function getGapsHandler(req: Request, res: Response): Promise<void> {
  const parsed = getGapsRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error.errors[0].message);
    return;
  }

  const { commitSha, baseSha, limit } = parsed.data;

  const [deadZoneUnits, neverTakenBranches, changedUntestedUnits] = await Promise.all([
    findDeadZoneUnits(commitSha, limit),
    findNeverTakenBranches(commitSha, limit),
    baseSha
      ? findChangedUntestedUnits(baseSha, commitSha, undefined, limit)
      : Promise.resolve(null),
  ]);

  res.status(200).json({ deadZoneUnits, neverTakenBranches, changedUntestedUnits });
}

/**
 * GET /api/v1/admin/coverage/reporting/issues/:issueKey/coverage
 * Coverage rollup for a single MiniCRM issue key, scoped to one build. Admin only.
 */
export async function getIssueCoverageHandler(req: Request, res: Response): Promise<void> {
  const parsed = getIssueCoverageRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error.errors[0].message);
    return;
  }

  const issueKey = req.params.issueKey;
  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    respondValidationError(res, 'issueKey is required');
    return;
  }

  const coverage = await getIssueCoverage(issueKey, parsed.data.commitSha);
  res.status(200).json({ coverage });
}

/**
 * GET /api/v1/admin/coverage/reporting/issue-keys
 * Lists distinct issue keys with at least one coverage session recorded
 * for a given build. Admin only.
 */
export async function listIssueKeysHandler(req: Request, res: Response): Promise<void> {
  const parsed = listIssueKeysRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error.errors[0].message);
    return;
  }

  const issueKeys = await listIssueKeysForCommit(parsed.data.commitSha);
  res.status(200).json({ issueKeys });
}

/**
 * GET /api/v1/admin/coverage/reporting/tia-metrics
 * TIA selection value metrics over a commit range. Admin only.
 */
export async function getTiaValueMetricsHandler(req: Request, res: Response): Promise<void> {
  const parsed = getTiaValueMetricsRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error.errors[0].message);
    return;
  }

  const metrics = await getTiaValueMetrics(parsed.data.fromSha, parsed.data.toSha);
  res.status(200).json({ metrics });
}
