/**
 * MSW request handlers for the client test suite.
 * These intercept API calls so tests run without a real server.
 * Path-only patterns (no hostname) match any origin — required for msw/node
 * where axios uses the Node adapter and URLs are not resolved against window.location.
 */

import { http, HttpResponse } from 'msw';
import type { UserResponse } from '@shared/schemas/userSchema.js';
import type { ContactResponse } from '@shared/schemas/contactSchema.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';

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

/** Reusable fixture: an account record */
export const ACCOUNT_1: AccountResponse = {
  id: '00000000-0000-0000-0000-000000000201',
  name: 'Acme Corp',
  industry: 'Technology',
  website: 'https://acme.example.com',
  employee_range: '51-200',
  revenue_range: '10M-50M',
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: a contact record linked to ACCOUNT_1 */
export const CONTACT_1: ContactResponse = {
  id: '00000000-0000-0000-0000-000000000101',
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.com',
  phone: '+1-555-0100',
  title: 'VP Sales',
  department: 'Sales',
  account_id: '00000000-0000-0000-0000-000000000201',
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
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

  /** Contacts: GET /api/contacts — supports ?account=<id> filter */
  http.get('/api/contacts', ({ request }) => {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('account');
    const contacts = accountId
      ? [CONTACT_1].filter((c) => c.account_id === accountId)
      : [CONTACT_1];
    return HttpResponse.json({ contacts });
  }),

  /** Contacts: POST /api/contacts */
  http.post('/api/contacts', async ({ request }) => {
    const body = (await request.json()) as Partial<ContactResponse>;
    return HttpResponse.json(
      {
        contact: {
          ...CONTACT_1,
          id: '00000000-0000-0000-0000-000000000102',
          first_name: body.first_name ?? 'New',
          last_name: body.last_name ?? 'Contact',
          email: body.email ?? 'new@example.com',
          phone: body.phone ?? null,
          title: body.title ?? null,
          department: body.department ?? null,
          account_id: body.account_id !== undefined ? body.account_id : CONTACT_1.account_id,
        },
      },
      { status: 201 },
    );
  }),

  /** Contacts: GET /api/contacts/:id */
  http.get('/api/contacts/:id', ({ params }) => {
    if (params.id === CONTACT_1.id) {
      return HttpResponse.json({ contact: CONTACT_1 });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
      { status: 404 },
    );
  }),

  /** Contacts: PATCH /api/contacts/:id */
  http.patch('/api/contacts/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<ContactResponse>;
    return HttpResponse.json({
      contact: { ...CONTACT_1, ...body, id: params.id as string },
    });
  }),

  /** Contacts: DELETE /api/contacts/:id */
  http.delete('/api/contacts/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Accounts: GET /api/accounts */
  http.get('/api/accounts', () => {
    return HttpResponse.json({ accounts: [ACCOUNT_1] });
  }),

  /** Accounts: POST /api/accounts */
  http.post('/api/accounts', async ({ request }) => {
    const body = (await request.json()) as Partial<AccountResponse>;
    return HttpResponse.json(
      {
        account: {
          ...ACCOUNT_1,
          id: '00000000-0000-0000-0000-000000000202',
          name: body.name ?? 'New Account',
          industry: body.industry ?? null,
          website: body.website ?? null,
          employee_range: body.employee_range ?? null,
          revenue_range: body.revenue_range ?? null,
        },
      },
      { status: 201 },
    );
  }),

  /** Accounts: GET /api/accounts/:id */
  http.get('/api/accounts/:id', ({ params }) => {
    if (params.id === ACCOUNT_1.id) {
      return HttpResponse.json({ account: ACCOUNT_1 });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Account not found' } },
      { status: 404 },
    );
  }),

  /** Accounts: PATCH /api/accounts/:id */
  http.patch('/api/accounts/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<AccountResponse>;
    return HttpResponse.json({
      account: { ...ACCOUNT_1, ...body, id: params.id as string },
    });
  }),

  /** Accounts: DELETE /api/accounts/:id */
  http.delete('/api/accounts/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),
];
