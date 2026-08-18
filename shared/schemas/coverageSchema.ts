/**
 * Shared Zod schemas for the Coverage/TIA control API.
 * Imported by both the server (request validation) and the QA E2E workspace
 * (typed reference client).
 */

import { z } from 'zod';

export const coverageDumpSourceSchema = z.enum(['node', 'browser']);

export const coverageSnapshotRequestSchema = z.object({
  label: z.string().min(1).optional(),
});

export const coverageDumpRequestSchema = z.object({
  label: z.string().min(1, 'label is required'),
  source: coverageDumpSourceSchema.optional(),
  payload: z.record(z.unknown()).optional(),
});

export type CoverageSnapshotRequest = z.infer<typeof coverageSnapshotRequestSchema>;
export type CoverageDumpRequest = z.infer<typeof coverageDumpRequestSchema>;

/** Origin agent that produced a coverage dump. */
export const coverageDumpAgentSchema = z.enum(['node-v8', 'browser-istanbul']);

/** Raw coverage payload format. */
export const coverageDumpFormatSchema = z.enum(['v8-script-coverage', 'istanbul']);

/** Metadata describing a single persisted coverage dump — the control API's response shape. */
export const coverageDumpSchema = z.object({
  dumpId: z.string().uuid(),
  agent: coverageDumpAgentSchema,
  label: z.string(),
  commitSha: z.string(),
  capturedAt: z.string(),
  format: coverageDumpFormatSchema,
  path: z.string(),
});

export type CoverageDump = z.infer<typeof coverageDumpSchema>;
