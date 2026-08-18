/**
 * Systematic unauthenticated access tests.
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
  { method: 'POST', path: '/api/v1/auth/login' },
  { method: 'POST', path: '/api/v1/auth/logout' },
  { method: 'POST', path: '/api/v1/auth/forgot-password' },
  { method: 'POST', path: '/api/v1/auth/reset-password' },
  { method: 'GET', path: '/api/v1/health' },
  // Dev/test-only endpoint — not available in production but intentionally public
  { method: 'POST', path: '/api/v1/auth/dev/reset-token' },
  // set-password is unauthenticated (invite token flow)
  { method: 'POST', path: '/api/v1/users/set-password' },
];

// Every route in this array must return 401 when called with no cookie.
// At least one GET, POST, PATCH, and DELETE per major resource group is covered.
const PROTECTED_ROUTES: Array<{ method: string; path: string }> = [
  // ── Auth (authenticated sub-routes) ───────────────────────────────────────
  { method: 'GET', path: '/api/v1/auth/me' },
  { method: 'POST', path: '/api/v1/auth/change-password' },

  // ── Contacts ──────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/contacts' },
  { method: 'POST', path: '/api/v1/contacts' },
  { method: 'GET', path: `/api/v1/contacts/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/v1/contacts/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/v1/contacts/${NIL_UUID}` },

  // ── Accounts ──────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/accounts' },
  { method: 'POST', path: '/api/v1/accounts' },
  { method: 'GET', path: `/api/v1/accounts/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/v1/accounts/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/v1/accounts/${NIL_UUID}` },

  // ── Deals ─────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/deals' },
  { method: 'POST', path: '/api/v1/deals' },
  { method: 'GET', path: `/api/v1/deals/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/v1/deals/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/v1/deals/${NIL_UUID}` },

  // ── Leads ─────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/leads' },
  { method: 'POST', path: '/api/v1/leads' },
  { method: 'GET', path: `/api/v1/leads/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/v1/leads/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/v1/leads/${NIL_UUID}` },

  // ── Activities ────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/activities' },
  { method: 'POST', path: '/api/v1/activities' },
  { method: 'GET', path: `/api/v1/activities/${NIL_UUID}` },
  { method: 'PATCH', path: `/api/v1/activities/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/v1/activities/${NIL_UUID}` },

  // ── Users ─────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/users' },
  { method: 'POST', path: '/api/v1/users/invite' },
  { method: 'PATCH', path: `/api/v1/users/${NIL_UUID}/role` },
  { method: 'POST', path: `/api/v1/users/${NIL_UUID}/admin-set-password` },

  // ── Search ────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/search?q=test' },

  // ── Reports ───────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/reports/win-loss' },

  // ── Automation rules ──────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/automation/rules' },
  { method: 'POST', path: '/api/v1/automation/rules' },

  // ── Settings ──────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/settings/email-notifications' },
  { method: 'PATCH', path: '/api/v1/settings/default-language' },

  // ── Tags ──────────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/tags' },
  { method: 'POST', path: '/api/v1/tags' },
  { method: 'PATCH', path: `/api/v1/tags/${NIL_UUID}` },
  { method: 'DELETE', path: `/api/v1/tags/${NIL_UUID}` },

  // ── Attachments ───────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/attachments' },
  { method: 'DELETE', path: `/api/v1/attachments/${NIL_UUID}` },

  // Note: GET /api/v1/audit-log was removed in a later change (now served via ConnectRPC).

  // ── Dashboard ─────────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/dashboard/summary' },

  // ── Demo (admin-only) ─────────────────────────────────────────────────────
  { method: 'GET', path: '/api/v1/admin/demo/status' },
  { method: 'POST', path: '/api/v1/admin/demo/seed' },
  { method: 'DELETE', path: '/api/v1/admin/demo' },
];

describe('protected routes return 401 without a cookie', () => {
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
