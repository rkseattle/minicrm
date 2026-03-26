/**
 * MSW request handlers for the client test suite.
 * These intercept API calls so tests run without a real server.
 * Path-only patterns (no hostname) match any origin — required for msw/node
 * where axios uses the Node adapter and URLs are not resolved against window.location.
 */

import { http, HttpResponse } from 'msw';
import type { UserResponse } from '@shared/schemas/userSchema.js';

/** Reusable fixture: admin user */
export const ADMIN_USER: UserResponse = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'admin@example.com',
  name: 'Test Admin',
  role: 'admin',
  status: 'active',
  created_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: rep user */
export const REP_USER: UserResponse = {
  id: '00000000-0000-0000-0000-000000000002',
  email: 'rep@example.com',
  name: 'Test Rep',
  role: 'rep',
  status: 'active',
  created_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: invited user */
export const INVITED_USER: UserResponse = {
  id: '00000000-0000-0000-0000-000000000003',
  email: 'invited@example.com',
  name: 'Invited User',
  role: 'rep',
  status: 'invited',
  created_at: '2025-01-01T00:00:00.000Z',
};

/** Default handlers — can be overridden in individual tests with server.use() */
export const handlers = [
  /** Auth: GET /api/auth/me — returns admin by default */
  http.get('/api/auth/me', () => {
    return HttpResponse.json({ user: ADMIN_USER });
  }),

  /** Auth: POST /api/auth/login */
  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === 'admin@example.com' && body.password === 'correct-password') {
      return HttpResponse.json({ user: ADMIN_USER });
    }
    return HttpResponse.json(
      { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password.' } },
      { status: 401 },
    );
  }),

  /** Auth: POST /api/auth/logout */
  http.post('/api/auth/logout', () => {
    return HttpResponse.json({ message: 'Logged out' });
  }),

  /** Users: GET /api/users */
  http.get('/api/users', () => {
    return HttpResponse.json({ users: [ADMIN_USER, REP_USER, INVITED_USER] });
  }),

  /** Users: POST /api/users/invite */
  http.post('/api/users/invite', async ({ request }) => {
    const body = (await request.json()) as { email: string; name: string; role: string };
    return HttpResponse.json(
      {
        user: {
          id: '00000000-0000-0000-0000-000000000099',
          email: body.email,
          name: body.name,
          role: body.role,
          status: 'invited',
          created_at: new Date().toISOString(),
        },
        inviteToken: 'test-invite-token',
        setPasswordPath: '/set-password?token=test-invite-token',
      },
      { status: 201 },
    );
  }),

  /** Users: PATCH /api/users/:id/role */
  http.patch('/api/users/:id/role', async ({ params, request }) => {
    const body = (await request.json()) as { role: string };
    return HttpResponse.json({
      user: { ...ADMIN_USER, id: params.id as string, role: body.role },
    });
  }),

  /** Users: PATCH /api/users/:id/deactivate */
  http.patch('/api/users/:id/deactivate', ({ params }) => {
    return HttpResponse.json({
      user: { ...ADMIN_USER, id: params.id as string, status: 'inactive' },
    });
  }),

  /** Users: PATCH /api/users/:id/reactivate */
  http.patch('/api/users/:id/reactivate', ({ params }) => {
    return HttpResponse.json({
      user: { ...ADMIN_USER, id: params.id as string, status: 'active' },
    });
  }),
];
