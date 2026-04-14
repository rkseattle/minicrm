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
import type { WinLossReportResponse, ActivityVolumeReportResponse } from '@/api/reports.js';
import type {
  AutomationRuleResponse,
  AutomationRuleLogResponse,
} from '@shared/schemas/automationSchema.js';
import type { SearchResponse } from '@/api/search.js';
import type { LeadResponse } from '@shared/schemas/leadSchema.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';

/** Reusable fixture: the six default pipeline stages */
export const PIPELINE_STAGES_FIXTURE: PipelineStageResponse[] = [
  {
    id: 'ps-1',
    name: 'Prospecting',
    sort_order: 10,
    probability: 10,
    is_terminal: false,
    is_fixed: false,
  },
  {
    id: 'ps-2',
    name: 'Qualification',
    sort_order: 20,
    probability: 25,
    is_terminal: false,
    is_fixed: false,
  },
  {
    id: 'ps-3',
    name: 'Proposal',
    sort_order: 30,
    probability: 50,
    is_terminal: false,
    is_fixed: false,
  },
  {
    id: 'ps-4',
    name: 'Negotiation',
    sort_order: 40,
    probability: 75,
    is_terminal: false,
    is_fixed: false,
  },
  {
    id: 'ps-5',
    name: 'Closed Won',
    sort_order: 50,
    probability: 100,
    is_terminal: true,
    is_fixed: true,
  },
  {
    id: 'ps-6',
    name: 'Closed Lost',
    sort_order: 60,
    probability: 0,
    is_terminal: true,
    is_fixed: true,
  },
];

/** Reusable fixture: an automation rule */
export const AUTOMATION_RULE_1: AutomationRuleResponse = {
  id: '00000000-0000-0000-0000-000000000601',
  name: 'New deal follow-up task',
  enabled: true,
  trigger_type: 'deal_created',
  trigger_config: {},
  action_type: 'create_task',
  action_config: {
    subject: 'Follow up with new lead',
    task_type: 'Task',
    assignee_type: 'owner',
    due_date_offset_days: 1,
  },
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: an automation rule execution log entry */
export const AUTOMATION_LOG_1: AutomationRuleLogResponse = {
  id: '00000000-0000-0000-0000-000000000701',
  rule_id: AUTOMATION_RULE_1.id,
  rule_name: AUTOMATION_RULE_1.name,
  triggered_at: '2025-01-02T10:00:00.000Z',
  triggering_record_type: 'deal',
  triggering_record_id: '00000000-0000-0000-0000-000000000301',
  outcome: 'success',
  error_message: null,
};

/** Reusable fixture: win/loss report response */
export const WIN_LOSS_REPORT: WinLossReportResponse = {
  wonCount: 5,
  wonValue: '87000.00',
  lostCount: 2,
  lostValue: '30000.00',
  winRate: 5 / 7,
  lossReasonBreakdown: [
    { reason: 'Price too high', count: 1 },
    { reason: 'Lost to competitor', count: 1 },
  ],
};

/** Reusable fixture: a recent activity entry on the dashboard */
export const RECENT_ACTIVITY_1 = {
  id: '00000000-0000-0000-0000-000000000901',
  type: 'Call',
  subject: 'Intro call with Acme',
  updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
  linkedRecordName: 'Jane Doe',
  linkedRecordPath: '/contacts/00000000-0000-0000-0000-000000000301',
};

/** Reusable fixture: dashboard summary response */
export const DASHBOARD_SUMMARY: DashboardSummaryResponse = {
  overdueTasks: 2,
  tasksDueToday: 1,
  openDealCount: 3,
  openPipelineValue: '150000.00',
  weightedPipelineValue: '52500.00',
  stageBreakdown: [
    { stage: 'Prospecting', count: 1, value: '50000.00', weightedValue: '5000.00' },
    { stage: 'Qualification', count: 2, value: '100000.00', weightedValue: '25000.00' },
  ],
  recentActivities: [RECENT_ACTIVITY_1],
};

/** Reusable fixture: activity volume report response */
export const ACTIVITY_VOLUME_REPORT: ActivityVolumeReportResponse = {
  rows: [
    {
      ownerId: '00000000-0000-0000-0000-000000000001',
      ownerName: 'Test Admin',
      counts: { Note: 3, Call: 5, Email: 2, Meeting: 1, Task: 4 },
      total: 15,
    },
    {
      ownerId: '00000000-0000-0000-0000-000000000002',
      ownerName: 'Test Rep',
      counts: { Note: 1, Call: 2, Email: 0, Meeting: 0, Task: 1 },
      total: 4,
    },
  ],
  totals: { Note: 4, Call: 7, Email: 2, Meeting: 1, Task: 5, total: 19 },
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
  address_line1: null,
  address_line2: null,
  city: null,
  state_region: null,
  postal_code: null,
  country: null,
  linkedin_url: null,
  twitter_x_url: null,
  other_url: null,
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
  address_line1: null,
  address_line2: null,
  city: null,
  state_region: null,
  postal_code: null,
  country: null,
  linkedin_url: null,
  twitter_x_url: null,
  other_url: null,
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
  effective_probability: 10,
  probability_is_overridden: false,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: a lead record (MINCRM-173) */
export const LEAD_1: LeadResponse = {
  id: '00000000-0000-0000-0000-000000000801',
  first_name: 'Carol',
  last_name: 'White',
  email: 'carol.white@example.com',
  phone: '+1-555-0800',
  company_name: 'Example Corp',
  lead_source: 'Web',
  status: 'New',
  disqualification_reason: null,
  notes: 'Met at conference',
  owner_id: '00000000-0000-0000-0000-000000000001',
  converted_at: null,
  converted_contact_id: null,
  converted_account_id: null,
  converted_deal_id: null,
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
  direction: null,
  outcome: null,
  contact_id: null,
  account_id: null,
  deal_id: '00000000-0000-0000-0000-000000000301',
  owner_id: '00000000-0000-0000-0000-000000000001',
  owner_name: 'Admin User',
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
  direction: null,
  outcome: null,
  contact_id: '00000000-0000-0000-0000-000000000101',
  account_id: null,
  deal_id: null,
  owner_id: '00000000-0000-0000-0000-000000000001',
  owner_name: 'Admin User',
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
  direction: null,
  outcome: null,
  contact_id: null,
  account_id: '00000000-0000-0000-0000-000000000201',
  deal_id: null,
  owner_id: '00000000-0000-0000-0000-000000000001',
  owner_name: 'Admin User',
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
  direction: null,
  outcome: null,
  contact_id: null,
  account_id: null,
  deal_id: '00000000-0000-0000-0000-000000000301',
  owner_id: '00000000-0000-0000-0000-000000000001',
  owner_name: 'Admin User',
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
  direction: null,
  outcome: null,
  contact_id: '00000000-0000-0000-0000-000000000101',
  account_id: null,
  deal_id: null,
  owner_id: '00000000-0000-0000-0000-000000000001',
  owner_name: 'Admin User',
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
    const users = [ADMIN_USER, REP_USER, INVITED_USER];
    return HttpResponse.json({ data: users, total: users.length, page: 1, limit: 50 });
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

  /** Auth: POST /api/auth/forgot-password — always returns 200 */
  http.post('/api/auth/forgot-password', () => {
    return HttpResponse.json({
      message: 'If an account with that email exists, a reset link has been sent.',
    });
  }),

  /** Auth: POST /api/auth/reset-password — returns admin user on success */
  http.post('/api/auth/reset-password', () => {
    return HttpResponse.json({ user: ADMIN_USER });
  }),

  /** Contacts: GET /api/contacts — supports ?account=<id> and ?owner=me filters */
  http.get('/api/contacts', ({ request }) => {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('account');
    const owner = url.searchParams.get('owner');
    let contacts = [CONTACT_1, CONTACT_2];
    if (accountId) contacts = contacts.filter((c) => c.account_id === accountId);
    if (owner === 'me') contacts = contacts.filter((c) => c.owner_id === ADMIN_USER.id);
    return HttpResponse.json({ data: contacts, total: contacts.length, page: 1, limit: 50 });
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
    return HttpResponse.json({ data: [ACCOUNT_1], total: 1, page: 1, limit: 50 });
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

  /** Accounts: GET /api/accounts/:id/children — returns empty list by default */
  http.get('/api/accounts/:id/children', () => {
    return HttpResponse.json([]);
  }),

  /** Accounts: GET /api/accounts/search — returns empty list by default */
  http.get('/api/accounts/search', () => {
    return HttpResponse.json([]);
  }),

  /** Contacts: GET /api/contacts/:id/addresses — returns empty list by default */
  http.get('/api/contacts/:id/addresses', () => {
    return HttpResponse.json({ addresses: [] });
  }),

  /** Contacts: POST /api/contacts/:id/addresses */
  http.post('/api/contacts/:id/addresses', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      address: {
        id: 'addr-new',
        contact_id: 'contact-1',
        label: body['label'] ?? null,
        address_line1: body['address_line1'] ?? null,
        address_line2: null,
        city: body['city'] ?? null,
        state_region: null,
        postal_code: null,
        country: null,
        is_default: body['is_default'] ?? false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }),

  /** Contacts: DELETE /api/contacts/:id/addresses/:addressId */
  http.delete('/api/contacts/:id/addresses/:addressId', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Contacts: POST /api/contacts/:id/addresses/:addressId/set-default */
  http.post('/api/contacts/:id/addresses/:addressId/set-default', ({ params }) => {
    return HttpResponse.json({
      address: {
        id: params['addressId'],
        contact_id: params['id'],
        label: null,
        address_line1: '123 Main St',
        address_line2: null,
        city: 'Seattle',
        state_region: 'WA',
        postal_code: '98101',
        country: 'US',
        is_default: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }),

  /** Deals: GET /api/deals — supports ?owner=me filter */
  http.get('/api/deals', ({ request }) => {
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    let deals = [DEAL_1];
    if (owner === 'me') deals = deals.filter((d) => d.owner_id === ADMIN_USER.id);
    return HttpResponse.json({ data: deals, total: deals.length, page: 1, limit: 50 });
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

  /** Reports: GET /api/reports/win-loss — returns win/loss report */
  http.get('/api/reports/win-loss', () => {
    return HttpResponse.json(WIN_LOSS_REPORT);
  }),

  /** Reports: GET /api/reports/activity-volume — returns activity volume report (MINCRM-181) */
  http.get('/api/reports/activity-volume', () => {
    return HttpResponse.json(ACTIVITY_VOLUME_REPORT);
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
    return HttpResponse.json({ data: activities, total: activities.length, page: 1, limit: 10 });
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

  /** Settings: GET /api/settings/default-language */
  http.get('/api/settings/default-language', () => {
    return HttpResponse.json({ language: 'en' });
  }),

  /** Settings: PATCH /api/settings/default-language */
  http.patch('/api/settings/default-language', async ({ request }) => {
    const body = (await request.json()) as { language: string };
    return HttpResponse.json({ language: body.language });
  }),

  /** Settings: GET /api/settings/nav-layout (MINCRM-133) */
  http.get('/api/settings/nav-layout', () => {
    return HttpResponse.json({ layout: 'top' });
  }),

  /** Settings: PATCH /api/settings/nav-layout (MINCRM-133) */
  http.patch('/api/settings/nav-layout', async ({ request }) => {
    const body = (await request.json()) as { layout: string };
    return HttpResponse.json({ layout: body.layout });
  }),

  /** Settings: GET /api/settings/email-notifications (MINCRM-163) */
  http.get('/api/settings/email-notifications', () => {
    return HttpResponse.json({ enabled: true });
  }),

  /** Settings: PATCH /api/settings/email-notifications (MINCRM-163) */
  http.patch('/api/settings/email-notifications', async ({ request }) => {
    const body = (await request.json()) as { enabled: boolean };
    return HttpResponse.json({ enabled: body.enabled });
  }),

  /** Users: GET /api/users/notification-recipient-count (MINCRM-163) */
  http.get('/api/users/notification-recipient-count', () => {
    return HttpResponse.json({ count: 2 });
  }),

  /** Users: GET /api/users/me/notification-preferences (MINCRM-161, MINCRM-162) */
  http.get('/api/users/me/notification-preferences', () => {
    return HttpResponse.json({
      preferences: {
        notify_overdue_tasks: true,
        notify_assignments: true,
        notify_deal_stage_changes: true,
      },
    });
  }),

  /** Users: PATCH /api/users/me/notification-preferences (MINCRM-161, MINCRM-162) */
  http.patch('/api/users/me/notification-preferences', async ({ request }) => {
    const body = (await request.json()) as {
      notify_overdue_tasks?: boolean;
      notify_assignments?: boolean;
      notify_deal_stage_changes?: boolean;
    };
    return HttpResponse.json({
      preferences: {
        notify_overdue_tasks: body.notify_overdue_tasks ?? true,
        notify_assignments: body.notify_assignments ?? true,
        notify_deal_stage_changes: body.notify_deal_stage_changes ?? true,
      },
    });
  }),

  /** Users: GET /api/users/me/language — returns null preference by default */
  http.get('/api/users/me/language', () => {
    return HttpResponse.json({ language: null });
  }),

  /** Users: PATCH /api/users/me/language — echoes back the saved language */
  http.patch('/api/users/me/language', async ({ request }) => {
    const body = (await request.json()) as { language: string | null };
    return HttpResponse.json({ language: body.language });
  }),

  /** Automation: GET /api/automation/rules */
  http.get('/api/automation/rules', () => {
    return HttpResponse.json({ rules: [AUTOMATION_RULE_1] });
  }),

  /** Automation: POST /api/automation/rules */
  http.post('/api/automation/rules', async ({ request }) => {
    const body = (await request.json()) as Partial<AutomationRuleResponse>;
    return HttpResponse.json(
      {
        rule: {
          ...AUTOMATION_RULE_1,
          id: '00000000-0000-0000-0000-000000000602',
          name: body.name ?? 'New Rule',
          enabled: body.enabled ?? true,
          trigger_type: body.trigger_type ?? 'deal_created',
          trigger_config: body.trigger_config ?? {},
          action_type: body.action_type ?? 'create_task',
          action_config: body.action_config ?? {},
        },
      },
      { status: 201 },
    );
  }),

  /** Automation: GET /api/automation/rules/:id */
  http.get('/api/automation/rules/:id', ({ params }) => {
    if (params.id === AUTOMATION_RULE_1.id) {
      return HttpResponse.json({ rule: AUTOMATION_RULE_1 });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Automation rule not found' } },
      { status: 404 },
    );
  }),

  /** Automation: PATCH /api/automation/rules/:id */
  http.patch('/api/automation/rules/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<AutomationRuleResponse>;
    return HttpResponse.json({
      rule: { ...AUTOMATION_RULE_1, ...body, id: params.id as string },
    });
  }),

  /** Automation: DELETE /api/automation/rules/:id */
  http.delete('/api/automation/rules/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Automation: GET /api/automation/rules/:id/logs */
  http.get('/api/automation/rules/:id/logs', ({ params }) => {
    if (params.id === AUTOMATION_RULE_1.id) {
      return HttpResponse.json({ logs: [AUTOMATION_LOG_1] });
    }
    return HttpResponse.json({ logs: [] });
  }),

  /** Admin: GET /api/admin/demo/status — no demo data by default */
  http.get('/api/admin/demo/status', () => {
    return HttpResponse.json({ active: false });
  }),

  /** Admin: POST /api/admin/demo/seed */
  http.post('/api/admin/demo/seed', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Admin: POST /api/admin/demo/reset */
  http.post('/api/admin/demo/reset', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Admin: DELETE /api/admin/demo */
  http.delete('/api/admin/demo', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Import: POST /api/admin/import/:entity/parse — returns headers, fields, preview */
  http.post('/api/admin/import/:entity/parse', ({ params }) => {
    const entity = params.entity as string;
    const headers =
      entity === 'contacts'
        ? ['First Name', 'Last Name', 'Email', 'Phone']
        : entity === 'accounts'
          ? ['Company', 'Industry', 'Website']
          : ['Deal Name', 'Stage', 'Value'];
    const fields =
      entity === 'contacts'
        ? [
            { key: 'first_name', label: 'First Name', required: true },
            { key: 'last_name', label: 'Last Name', required: true },
            { key: 'email', label: 'Email', required: true },
            { key: 'phone', label: 'Phone', required: false },
          ]
        : entity === 'accounts'
          ? [
              { key: 'name', label: 'Company Name', required: true },
              { key: 'industry', label: 'Industry', required: false },
              { key: 'website', label: 'Website', required: false },
            ]
          : [
              { key: 'name', label: 'Deal Name', required: true },
              { key: 'stage', label: 'Stage', required: true },
              { key: 'value', label: 'Value', required: false },
            ];
    const preview = [Object.fromEntries(headers.map((h, i) => [h, `Sample ${i + 1}`]))];
    return HttpResponse.json({ headers, fields, preview });
  }),

  /** Import: POST /api/admin/import/:entity/run — returns import summary */
  http.post('/api/admin/import/:entity/run', () => {
    return HttpResponse.json({
      created: 2,
      skipped: 1,
      failedCount: 0,
      failed: [],
      errorCsv: '',
    });
  }),

  /** Search: GET /api/search — returns contacts, accounts, and deals matching ?q= */
  http.get('/api/search', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? '';
    if (query.length < 2) {
      return HttpResponse.json(
        {
          error: {
            code: 'QUERY_TOO_SHORT',
            message: 'Search query must be at least 2 characters.',
          },
        },
        { status: 400 },
      );
    }
    const searchResponse: SearchResponse = {
      contacts: query.toLowerCase().includes('alice')
        ? [
            {
              id: CONTACT_1.id,
              first_name: 'Alice',
              last_name: 'Smith',
              email: 'alice@example.com',
            },
          ]
        : [],
      accounts: query.toLowerCase().includes('acme')
        ? [{ id: ACCOUNT_1.id, name: 'Acme Corp' }]
        : [],
      deals: query.toLowerCase().includes('acme')
        ? [{ id: DEAL_1.id, name: 'Acme Enterprise Deal', stage: 'Prospecting' }]
        : [],
    };
    return HttpResponse.json(searchResponse);
  }),

  // ── Attachments (MINCRM-167) ─────────────────────────────────────────────────

  /** Attachments: GET /api/attachments — returns empty list by default */
  http.get('/api/attachments', () => {
    return HttpResponse.json({ attachments: [] });
  }),

  /** Attachments: POST /api/attachments — returns a created attachment */
  http.post('/api/attachments', () => {
    return HttpResponse.json(
      {
        attachment: {
          id: '00000000-0000-0000-0000-000000000a01',
          record_type: 'contact',
          record_id: '00000000-0000-0000-0000-000000000101',
          filename: 'uploaded.pdf',
          file_size: 1024,
          mime_type: 'application/pdf',
          uploader_id: '00000000-0000-0000-0000-000000000001',
          uploader_name: 'Test Admin',
          uploaded_at: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  }),

  /** Attachments: DELETE /api/attachments/:id */
  http.delete('/api/attachments/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Storage settings (MINCRM-169) ────────────────────────────────────────────

  /** Settings: GET /api/settings/storage/status — not configured by default */
  http.get('/api/settings/storage/status', () => {
    return HttpResponse.json({ configured: false });
  }),

  /** Settings: GET /api/settings/storage — not configured by default */
  http.get('/api/settings/storage', () => {
    return HttpResponse.json({ configured: false, config: null });
  }),

  /** Settings: PUT /api/settings/storage */
  http.put('/api/settings/storage', async ({ request }) => {
    const body = (await request.json()) as {
      endpoint: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    };
    return HttpResponse.json({
      configured: true,
      config: {
        endpoint: body.endpoint,
        bucket: body.bucket,
        accessKeyId: body.accessKeyId,
        secretAccessKey: '********',
      },
    });
  }),

  /** Settings: DELETE /api/settings/storage */
  http.delete('/api/settings/storage', () => {
    return HttpResponse.json({ configured: false, config: null });
  }),

  /** Settings: POST /api/settings/storage/test */
  http.post('/api/settings/storage/test', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Leads: GET /api/leads — returns LEAD_1 by default (MINCRM-173) */
  http.get('/api/leads', () => {
    return HttpResponse.json({ data: [LEAD_1], total: 1, page: 1, limit: 50 });
  }),

  /** Leads: POST /api/leads */
  http.post('/api/leads', async ({ request }) => {
    const body = (await request.json()) as Partial<LeadResponse>;
    return HttpResponse.json(
      {
        lead: {
          ...LEAD_1,
          id: '00000000-0000-0000-0000-000000000802',
          first_name: body.first_name ?? 'New',
          last_name: body.last_name ?? null,
          email: body.email ?? 'new@example.com',
        },
      },
      { status: 201 },
    );
  }),

  /** Leads: GET /api/leads/:id */
  http.get('/api/leads/:id', ({ params }) => {
    if (params.id === LEAD_1.id) {
      return HttpResponse.json({ lead: LEAD_1 });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Lead not found' } },
      { status: 404 },
    );
  }),

  /** Leads: PATCH /api/leads/:id */
  http.patch('/api/leads/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<LeadResponse>;
    return HttpResponse.json({ lead: { ...LEAD_1, ...body, id: params.id as string } });
  }),

  /** Leads: DELETE /api/leads/:id */
  http.delete('/api/leads/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Leads: GET /api/leads/:id/status-history */
  http.get('/api/leads/:id/status-history', () => {
    return HttpResponse.json({ history: [] });
  }),

  /** Leads: POST /api/leads/:id/convert */
  http.post('/api/leads/:id/convert', () => {
    return HttpResponse.json(
      {
        conversion: {
          contact_id: '00000000-0000-0000-0000-000000000101',
          account_id: '00000000-0000-0000-0000-000000000201',
          deal_id: '00000000-0000-0000-0000-000000000301',
        },
      },
      { status: 201 },
    );
  }),

  /** Leads: GET /api/leads/accounts/search */
  http.get('/api/leads/accounts/search', () => {
    return HttpResponse.json({ accounts: [{ id: ACCOUNT_1.id, name: ACCOUNT_1.name }] });
  }),

  /** Audit log: GET /api/audit-log/record — returns empty history by default */
  http.get('/api/audit-log/record', () => {
    return HttpResponse.json({ entries: [] });
  }),

  /** Audit log: GET /api/audit-log — returns empty paginated list by default */
  http.get('/api/audit-log', () => {
    return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 });
  }),

  /** Audit log: GET /api/audit-log/actors — returns empty list by default */
  http.get('/api/audit-log/actors', () => {
    return HttpResponse.json({ actors: [] });
  }),

  /** Pipeline stages: GET /api/settings/pipeline-stages — returns six seed stages */
  http.get('/api/settings/pipeline-stages', () => {
    return HttpResponse.json({ stages: PIPELINE_STAGES_FIXTURE });
  }),

  /** Pipeline stages: POST /api/settings/pipeline-stages — creates a new stage */
  http.post('/api/settings/pipeline-stages', async ({ request }) => {
    const body = (await request.json()) as { name: string; probability?: number };
    const newStage: PipelineStageResponse = {
      id: '00000000-0000-0000-0000-000000000901',
      name: body.name,
      sort_order: 50,
      probability: body.probability ?? 0,
      is_terminal: false,
      is_fixed: false,
    };
    return HttpResponse.json(newStage, { status: 201 });
  }),

  /** Pipeline stages: PATCH /api/settings/pipeline-stages/:id — updates a stage */
  http.patch('/api/settings/pipeline-stages/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<PipelineStageResponse>;
    const existing = PIPELINE_STAGES_FIXTURE.find((s) => s.id === params.id);
    if (!existing) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Pipeline stage not found' } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ ...existing, ...body });
  }),

  /** Pipeline stages: DELETE /api/settings/pipeline-stages/:id — deletes a stage */
  http.delete('/api/settings/pipeline-stages/:id', ({ params }) => {
    return HttpResponse.json({ id: params.id });
  }),
];
