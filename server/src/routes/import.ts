/**
 * CSV import routes — admin only.
 * Two-step flow per entity:
 *   POST /parse — upload CSV, receive headers + preview
 *   POST /run   — upload CSV + mapping JSON, create job and return 202
 * Job polling:
 *   GET /jobs/:job_id — poll for background import progress
 * (contacts), (accounts), (deals)
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireFeatureEnabled } from '../middleware/requireFeatureEnabled.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  parseAccountsCsv,
  parseContactsCsv,
  parseDealsCsv,
  runAccountsImport,
  runContactsImport,
  runDealsImport,
  getImportJob,
} from '../controllers/importController.js';

const router = Router();

/** Multer instance — memory storage, 10 MB limit, CSV only */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv files are accepted'));
    }
  },
});

// ── Shared middleware ──────────────────────────────────────────────────────────
router.use(authenticate);
router.use(requireRole('admin'));
router.use(requireFeatureEnabled('csv_import'));

/**
 * @openapi
 * /api/v1/admin/import/accounts/parse:
 *   post:
 *     tags: [Import]
 *     operationId: parseAccountsCsv
 *     summary: Parse an accounts CSV and return headers + preview (admin only)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: CSV parsed — returns headers, field definitions, and 5-row preview
 *       400:
 *         description: No file, wrong type, exceeds size limit, or parse error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/accounts/parse', upload.single('file'), asyncHandler(parseAccountsCsv));

/**
 * @openapi
 * /api/v1/admin/import/accounts/run:
 *   post:
 *     tags: [Import]
 *     operationId: runAccountsImport
 *     summary: Run account import from CSV with column mapping (admin only)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               mapping:
 *                 type: string
 *                 description: JSON string mapping CRM field keys to CSV column headers
 *     responses:
 *       202:
 *         description: Import job created — poll GET /jobs/{job_id} for progress
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/accounts/run', upload.single('file'), asyncHandler(runAccountsImport));

/**
 * @openapi
 * /api/v1/admin/import/contacts/parse:
 *   post:
 *     tags: [Import]
 *     operationId: parseContactsCsv
 *     summary: Parse a contacts CSV and return headers + preview (admin only)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: CSV parsed — returns headers, field definitions, and 5-row preview
 *       400:
 *         description: No file, wrong type, exceeds size limit, or parse error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/contacts/parse', upload.single('file'), asyncHandler(parseContactsCsv));

/**
 * @openapi
 * /api/v1/admin/import/contacts/run:
 *   post:
 *     tags: [Import]
 *     operationId: runContactsImport
 *     summary: Run contact import from CSV with column mapping (admin only)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               mapping:
 *                 type: string
 *                 description: JSON string mapping CRM field keys to CSV column headers
 *     responses:
 *       202:
 *         description: Import job created — poll GET /jobs/{job_id} for progress
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/contacts/run', upload.single('file'), asyncHandler(runContactsImport));

/**
 * @openapi
 * /api/v1/admin/import/deals/parse:
 *   post:
 *     tags: [Import]
 *     operationId: parseDealsCsv
 *     summary: Parse a deals CSV and return headers + preview (admin only)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: CSV parsed — returns headers, field definitions, and 5-row preview
 *       400:
 *         description: No file, wrong type, exceeds size limit, or parse error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/deals/parse', upload.single('file'), asyncHandler(parseDealsCsv));

/**
 * @openapi
 * /api/v1/admin/import/deals/run:
 *   post:
 *     tags: [Import]
 *     operationId: runDealsImport
 *     summary: Run deal import from CSV with column mapping (admin only)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               mapping:
 *                 type: string
 *                 description: JSON string mapping CRM field keys to CSV column headers
 *     responses:
 *       202:
 *         description: Import job created — poll GET /jobs/{job_id} for progress
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/deals/run', upload.single('file'), asyncHandler(runDealsImport));

/**
 * @openapi
 * /api/v1/admin/import/jobs/{job_id}:
 *   get:
 *     tags: [Import]
 *     operationId: getImportJob
 *     summary: Get the current status of a background import job (admin only)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: job_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Import job status and progress counters
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/jobs/:job_id', asyncHandler(getImportJob));

/**
 * Multer error handler — converts fileFilter rejections (non-CSV uploads) from the
 * default HTTP 500 into a proper 400 VALIDATION_ERROR response.
 * Must be a 4-argument middleware for Express to treat it as an error handler.
 */

router.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof multer.MulterError || err.message === 'Only .csv files are accepted') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    return;
  }
  // Not a multer error — let the global handler deal with it
  _next(err);
});

export default router;
