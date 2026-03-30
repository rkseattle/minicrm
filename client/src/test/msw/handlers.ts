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
import type { DealResponse } from '@shared/schemas/dealSchema.js';
import type { ActivityResponse } from '@shared/schemas/activitySchema.js';
import type { MyTaskResponse } from '@/api/activities.js';
import type { DashboardSummaryResponse } from '@/api/dashboard.js';

/** Reusable fixture: dashboard summary response */
export const DASHBOARD_SUMMARY: DashboardSummaryResponse = {
  overdueTasks: 2,
  tasksDueToday: 1,
  openDealCount: 3,
  openPipelineValue: '150000.00',
  stageBreakdown: [
    { stage: 'Prospecting', count: 1, value: '50000.00' },
    { stage: 'Qualification', count: 2, value: '100000.00' },
  ],
};

/** Reusable fixture: admin user */
export const ADMIN_USER: UserResponse = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'admin@example.com',
  name: 'Test Admin',
  role: 'admin',
  status: 'active',
  must_change_password: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: rep user */
export const REP_USER: UserResponse = {
  id: '00000000-0000-0000-0000-000000000002',
  email: 'rep@example.com',
  name: 'Test Rep',
  role: 'rep',
  status: 'active',
  must_change_password: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: invited user */
export const INVITED_USER: UserResponse = {
  id: '00000000-0000-0000-0000-000000000003',
  email: 'invited@example.com',
  name: 'Invited User',
  role: 'rep',
  status: 'invited',
  must_change_password: false,
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

/** Reusable fixture: a second contact record for link/unlink tests */
export const CONTACT_2: ContactResponse = {
  id: '00000000-0000-0000-0000-000000000102',
  first_name: 'Bob',
  last_name: 'Jones',
  email: 'bob@example.com',
  phone: null,
  title: 'Engineer',
  department: 'Engineering',
  account_id: null,
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: a deal record */
export const DEAL_1: DealResponse = {
  id: '00000000-0000-0000-0000-000000000301',
  name: 'Acme Enterprise Deal',
  stage: 'Prospecting',
  value: '50000.00',
  close_date: '2026-12-31',
  loss_reason: null,
  account_id: '00000000-0000-0000-0000-000000000201',
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: an open task for My Tasks view, linked to DEAL_1 */
export const MY_TASK_1: MyTaskResponse = {
  id: '00000000-0000-0000-0000-000000000501',
  type: 'Task',
  subject: 'Send proposal to client',
  notes: null,
  due_date: '2026-06-15',
  status: 'open',
  contact_id: null,
  account_id: null,
  deal_id: '00000000-0000-0000-0000-000000000301',
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  linked_record_name: 'Acme Enterprise Deal',
  linked_record_type: 'deal',
};

/** Reusable fixture: an overdue open task for My Tasks view, linked to CONTACT_1 */
export const MY_TASK_OVERDUE: MyTaskResponse = {
  id: '00000000-0000-0000-0000-000000000502',
  type: 'Task',
  subject: 'Call Alice about renewal',
  notes: null,
  due_date: '2020-01-01',
  status: 'open',
  contact_id: '00000000-0000-0000-0000-000000000101',
  account_id: null,
  deal_id: null,
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  linked_record_name: 'Alice Smith',
  linked_record_type: 'contact',
};

/** Reusable fixture: a completed task for My Tasks view */
export const MY_TASK_COMPLETE: MyTaskResponse = {
  id: '00000000-0000-0000-0000-000000000503',
  type: 'Task',
  subject: 'Submit contract',
  notes: null,
  due_date: '2025-12-01',
  status: 'complete',
  contact_id: null,
  account_id: '00000000-0000-0000-0000-000000000201',
  deal_id: null,
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  linked_record_name: 'Acme Corp',
  linked_record_type: 'account',
};

/** Reusable fixture: an open task activity linked to DEAL_1 */
export const ACTIVITY_1: ActivityResponse = {
  id: '00000000-0000-0000-0000-000000000401',
  type: 'Task',
  subject: 'Follow up with decision maker',
  notes: 'Discuss pricing options',
  due_date: '2026-06-30',
  status: 'open',
  contact_id: null,
  account_id: null,
  deal_id: '00000000-0000-0000-0000-000000000301',
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: a completed note activity linked to CONTACT_1 */
export const ACTIVITY_2: ActivityResponse = {
  id: '00000000-0000-0000-0000-000000000402',
  type: 'Note',
  subject: 'Initial discovery call notes',
  notes: null,
  due_date: null,
  status: 'complete',
  contact_id: '00000000-0000-0000-0000-000000000101',
  account_id: null,
  deal_id: null,
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-02T00:00:00.000Z',
  updated_at: '2025-01-02T00:00:00.000Z',
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

  /** Users: GET /api/users/active — returns only active users with id+name */
  http.get('/api/users/active', () => {
    return HttpResponse.json({
      users: [
        { id: ADMIN_USER.id, name: ADMIN_USER.name },
        { id: REP_USER.id, name: REP_USER.name },
      ],
    });
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
          must_change_password: false,
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

  /** Users: POST /api/users/:id/admin-set-password — admin sets a user's password */
  http.post('/api/users/:id/admin-set-password', ({ params }) => {
    return HttpResponse.json({
      user: { ...REP_USER, id: params.id as string, must_change_password: true },
    });
  }),

  /** Auth: POST /api/auth/change-password */
  http.post('/api/auth/change-password', () => {
    return HttpResponse.json({ message: 'Password changed successfully' });
  }),

  /** Contacts: GET /api/contacts — supports ?account=<id> and ?owner=me filters */
  http.get('/api/contacts', ({ request }) => {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('account');
    const owner = url.searchParams.get('owner');
    let contacts = [CONTACT_1, CONTACT_2];
    if (accountId) contacts = contacts.filter((c) => c.account_id === accountId);
    if (owner === 'me') contacts = contacts.filter((c) => c.owner_id === ADMIN_USER.id);
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

  /** Contacts: GET /api/contacts/:id/deals — returns deals linked to a contact */
  http.get('/api/contacts/:id/deals', ({ params }) => {
    // By default return DEAL_1 when fetching CONTACT_1's deals; empty for others
    if (params.id === CONTACT_1.id) {
      return HttpResponse.json({ deals: [DEAL_1] });
    }
    return HttpResponse.json({ deals: [] });
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

  /** Deals: GET /api/deals — supports ?owner=me filter */
  http.get('/api/deals', ({ request }) => {
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    let deals = [DEAL_1];
    if (owner === 'me') deals = deals.filter((d) => d.owner_id === ADMIN_USER.id);
    return HttpResponse.json({ deals });
  }),

  /** Deals: POST /api/deals */
  http.post('/api/deals', async ({ request }) => {
    const body = (await request.json()) as Partial<DealResponse>;
    return HttpResponse.json(
      {
        deal: {
          ...DEAL_1,
          id: '00000000-0000-0000-0000-000000000302',
          name: body.name ?? 'New Deal',
          stage: body.stage ?? 'Prospecting',
          value: body.value != null ? String(body.value) : null,
          close_date: body.close_date ?? null,
          account_id: body.account_id !== undefined ? body.account_id : null,
        },
      },
      { status: 201 },
    );
  }),

  /** Deals: GET /api/deals/:id */
  http.get('/api/deals/:id', ({ params }) => {
    if (params.id === DEAL_1.id) {
      return HttpResponse.json({ deal: DEAL_1, contacts: [] });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Deal not found' } },
      { status: 404 },
    );
  }),

  /** Deals: PATCH /api/deals/:id */
  http.patch('/api/deals/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<DealResponse>;
    return HttpResponse.json({
      deal: { ...DEAL_1, ...body, id: params.id as string },
    });
  }),

  /** Deals: DELETE /api/deals/:id */
  http.delete('/api/deals/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Deals: POST /api/deals/:id/contacts/:contactId — link a contact to a deal */
  http.post('/api/deals/:id/contacts/:contactId', ({ params }) => {
    // Return CONTACT_1 as a linked contact by default
    const linkedContact = {
      id: params.contactId as string,
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@example.com',
      title: 'VP Sales',
    };
    return HttpResponse.json({ contacts: [linkedContact] });
  }),

  /** Deals: DELETE /api/deals/:id/contacts/:contactId — unlink a contact from a deal */
  http.delete('/api/deals/:id/contacts/:contactId', () => {
    return HttpResponse.json({ contacts: [] });
  }),

  /** Dashboard: GET /api/dashboard/summary — returns dashboard summary metrics */
  http.get('/api/dashboard/summary', () => {
    return HttpResponse.json(DASHBOARD_SUMMARY);
  }),

  /** Activities: GET /api/activities/my-tasks — returns task rows with linked record info */
  http.get('/api/activities/my-tasks', () => {
    return HttpResponse.json({ tasks: [MY_TASK_1, MY_TASK_OVERDUE] });
  }),

  /** Activities: GET /api/activities — supports ?contact, ?account, ?deal, ?owner=me filters */
  http.get('/api/activities', ({ request }) => {
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contact');
    const accountId = url.searchParams.get('account');
    const dealId = url.searchParams.get('deal');
    let activities = [ACTIVITY_1, ACTIVITY_2];
    if (contactId) activities = activities.filter((a) => a.contact_id === contactId);
    if (accountId) activities = activities.filter((a) => a.account_id === accountId);
    if (dealId) activities = activities.filter((a) => a.deal_id === dealId);
    return HttpResponse.json({ activities });
  }),

  /** Activities: POST /api/activities */
  http.post('/api/activities', async ({ request }) => {
    const body = (await request.json()) as Partial<ActivityResponse>;
    return HttpResponse.json(
      {
        activity: {
          ...ACTIVITY_1,
          id: '00000000-0000-0000-0000-000000000403',
          type: body.type ?? 'Note',
          subject: body.subject ?? 'New activity',
          notes: body.notes ?? null,
          due_date: body.due_date ?? null,
          contact_id: body.contact_id ?? null,
          account_id: body.account_id ?? null,
          deal_id: body.deal_id ?? null,
          status: 'open',
        },
      },
      { status: 201 },
    );
  }),

  /** Activities: GET /api/activities/:id */
  http.get('/api/activities/:id', ({ params }) => {
    if (params.id === ACTIVITY_1.id) return HttpResponse.json({ activity: ACTIVITY_1 });
    if (params.id === ACTIVITY_2.id) return HttpResponse.json({ activity: ACTIVITY_2 });
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Activity not found' } },
      { status: 404 },
    );
  }),

  /** Activities: PATCH /api/activities/:id */
  http.patch('/api/activities/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<ActivityResponse>;
    const base = params.id === ACTIVITY_2.id ? ACTIVITY_2 : ACTIVITY_1;
    return HttpResponse.json({ activity: { ...base, ...body, id: params.id as string } });
  }),

  /** Activities: DELETE /api/activities/:id */
  http.delete('/api/activities/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),
];
