/**
 * Shared Zod schemas for Coverage/TIA session management. (MINCRM-609..612)
 * Imported by the server (request validation + response typing), the client
 * (manual-testing session recorder control panel), and the QA E2E workspace
 * (typed reference client + fixture-layer hooks).
 *
 * Named CoverageSession throughout — never bare "Session" — to avoid
 * colliding with the unrelated, pre-existing AiSession feature
 * (shared/schemas/aiSessionSchema.ts).
 */

import { z } from 'zod';

/** HTTP header carrying the correlation ID that partitions coverage by session. */
export const CORRELATION_ID_HEADER = 'x-coverage-correlation-id';

export const coverageSessionSourceSchema = z.enum(['automated-e2e', 'manual']);
export const coverageSessionStatusSchema = z.enum(['active', 'ended']);

export const startCoverageSessionRequestSchema = z.object({
  label: z.string().min(1, 'label is required'),
  source: coverageSessionSourceSchema,
  buildSha: z.string().min(1, 'buildSha is required'),
  environment: z.string().min(1, 'environment is required'),
  issueKey: z.string().min(1).optional(),
});

export type StartCoverageSessionRequest = z.infer<typeof startCoverageSessionRequestSchema>;

export const endCoverageSessionRequestSchema = z.object({
  version: z.number().int().positive(),
});

export type EndCoverageSessionRequest = z.infer<typeof endCoverageSessionRequestSchema>;

export const recordCoverageSessionDumpRequestSchema = z.object({
  dumpId: z.string().uuid(),
  correlationId: z.string().uuid(),
  testId: z.string().min(1).optional(),
  testName: z.string().min(1).optional(),
  attempt: z.number().int().positive().default(1),
});

export type RecordCoverageSessionDumpRequest = z.infer<
  typeof recordCoverageSessionDumpRequestSchema
>;

/** A coverage session — the control API's response shape. */
export const coverageSessionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  source: coverageSessionSourceSchema,
  status: coverageSessionStatusSchema,
  correlationId: z.string().uuid(),
  buildSha: z.string(),
  environment: z.string(),
  issueKey: z.string().nullable(),
  // Nullable — the starting user may have been deleted since (ON DELETE
  // SET NULL on coverage_sessions.started_by; see migration 157).
  startedById: z.string().uuid().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  version: z.number().int(),
});

export type CoverageSession = z.infer<typeof coverageSessionSchema>;

/** A single dump's attribution record within a session. */
export const coverageSessionDumpSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  dumpId: z.string().uuid(),
  correlationId: z.string().uuid(),
  testId: z.string().nullable(),
  testName: z.string().nullable(),
  attempt: z.number().int(),
  recordedAt: z.string(),
});

export type CoverageSessionDump = z.infer<typeof coverageSessionDumpSchema>;
