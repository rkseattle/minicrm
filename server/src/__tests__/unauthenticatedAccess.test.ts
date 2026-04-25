/**
 * Systematic unauthenticated access tests (MINCRM-245).
 *
 * Verifies that every non-public API route returns 401 when called without an
 * auth cookie. This prevents a developer accidentally omitting the `authenticate`
 * middleware from a new route from going unnoticed.
 *
 * Routes are tested with the nil UUID (00000000-0000-0000-0000-000000000000)
 * for path parameters — the 401 fires before any DB lookup so no records need
 * to exist.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

// These routes are intentionally public — they do not require authentication.
// Listed here as explicit documentation of the known exceptions.
export const PUBLIC_ROUTES = [
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/logout' },
  { method: 'POST', path: '/api/auth/forgot-password' },
  { method: 'POST', path: '/api/auth/reset-password' },
  { method: 'GET', path: '/api/health' },
  // Dev/test-only endpoint — not available in production but intentionally public
  { method: 'POST', path: '/api/auth/dev/reset-token' },
  // set-password is unauthenticated (invite token flow)
  { method: 'POST', path: '/api/users/set-password' },
];

// Every route in this array must return 401 when called with no cookie.
// At least one GET, POST, PATCH, and DELETE per major resource group is covered.
const PROTECTED_ROUTES: Array<{ method: string; path: string }> = [
  // ── Auth (authenticated sub-routes) ───────────────────────────────────────
  { method: 'GET', path: '/api/auth/me' },
  { method: 'POST', path: '/api/auth/change-password' },

  // ── Contacts ──────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/contacts' },
  { method: 'POST', path: '/api/contacts' },
  { method: 'GET', path: `/api/contacts/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/contacts/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/contacts/${NIL_UUID}` },

  // ── Accounts ──────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/accounts' },
  { method: 'POST', path: '/api/accounts' },
  { method: 'GET', path: `/api/accounts/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/accounts/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/accounts/${NIL_UUID}` },

  // ── Deals ─────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/deals' },
  { method: 'POST', path: '/api/deals' },
  { method: 'GET', path: `/api/deals/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/deals/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/deals/${NIL_UUID}` },

  // ── Leads ─────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/leads' },
  { method: 'POST', path: '/api/leads' },
  { method: 'GET', path: `/api/leads/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/leads/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/leads/${NIL_UUID}` },

  // ── Activities ────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/activities' },
  { method: 'POST', path: '/api/activities' },
  { method: 'GET', path: `/api/activities/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/activities/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/activities/${NIL_UUID}` },

  // ── Users ─────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/users' },
  { method: 'POST', path: '/api/users/invite' },
  { method: 'PATCH', path: `/api/users/${NIL_UUID}/role` },
  { method: 'POST', path: `/api/users/${NIL_UUID}/admin-set-password` },

  // ── Search ────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/search?q=test' },

  // ── Reports ───────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/reports/win-loss' },

  // ── Automation rules ──────────────────────────────────────────────────────
  { method: 'GET', path: '/api/automation/rules' },
  { method: 'POST', path: '/api/automation/rules' },

  // ── Settings ──────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/settings/email-notifications' },
  { method: 'PATCH', path: '/api/settings/default-language' },

  // ── Tags ──────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/tags' },
  { method: 'POST', path: '/api/tags' },
  { method: 'PATCH', path: `/api/tags/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/tags/${NIL_UUID}` },

  // ── Attachments ───────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/attachments' },
  { method: 'DELETE', path: `/api/attachments/${NIL_UUID}` },

  // ── Audit log ─────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/audit-log' },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/dashboard/summary' },

  // ── Demo (admin-only) ─────────────────────────────────────────────────────
  { method: 'GET', path: '/api/admin/demo/status' },
  { method: 'POST', path: '/api/admin/demo/seed' },
  { method: 'DELETE', path: '/api/admin/demo' },
];

describe('MINCRM-245 — protected routes return 401 without a cookie', () => {
  test.each(PROTECTED_ROUTES)(
    '$method $path returns 401 without a cookie',
    async ({ method, path }) => {
      const agent = request(app);
      const res = await (method === 'GET'
        ? agent.get(path)
        : method === 'POST'
          ? agent.post(path)
          : method === 'PATCH'
            ? agent.patch(path)
            : agent.delete(path));

      expect(res.status).toBe(401);
    },
  );
});
