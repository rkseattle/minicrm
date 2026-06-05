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
import type {
  WinLossReportResponse,
  ActivityVolumeReportResponse,
  StageTrendReportResponse,
} from '@/api/reports.js';
import type {
  AutomationRuleResponse,
  AutomationRuleLogResponse,
} from '@shared/schemas/automationSchema.js';
import type { SearchResponse } from '@/api/search.js';
import type { LeadResponse } from '@shared/schemas/leadSchema.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';
import type { PipelineResponse } from '@shared/schemas/pipelineSchema.js';

/** Default pipeline ID used in test fixtures */
export const DEFAULT_PIPELINE_ID = '00000000-0000-0000-0000-000000000001';

/** Default pipeline fixture for tests */
export const DEFAULT_PIPELINE_FIXTURE: PipelineResponse = {
  id: DEFAULT_PIPELINE_ID,
  name: 'Default',
  is_default: true,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

/** Reusable fixture: the six default pipeline stages */
export const PIPELINE_STAGES_FIXTURE: PipelineStageResponse[] = [
  {
    id: 'ps-1',
    pipeline_id: DEFAULT_PIPELINE_ID,
    name: 'Prospecting',
    sort_order: 10,
    probability: 10,
    is_terminal: false,
    is_fixed: false,
  },
  {
    id: 'ps-2',
    pipeline_id: DEFAULT_PIPELINE_ID,
    name: 'Qualification',
    sort_order: 20,
    probability: 25,
    is_terminal: false,
    is_fixed: false,
  },
  {
    id: 'ps-3',
    pipeline_id: DEFAULT_PIPELINE_ID,
    name: 'Proposal',
    sort_order: 30,
    probability: 50,
    is_terminal: false,
    is_fixed: false,
  },
  {
    id: 'ps-4',
    pipeline_id: DEFAULT_PIPELINE_ID,
    name: 'Negotiation',
    sort_order: 40,
    probability: 75,
    is_terminal: false,
    is_fixed: false,
  },
  {
    id: 'ps-5',
    pipeline_id: DEFAULT_PIPELINE_ID,
    name: 'Closed Won',
    sort_order: 50,
    probability: 100,
    is_terminal: true,
    is_fixed: true,
  },
  {
    id: 'ps-6',
    pipeline_id: DEFAULT_PIPELINE_ID,
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
  mixedCurrencies: false,
  currency: 'USD',
  // MINCRM-253 — no rates configured in test fixture
  convertedWonValue: null,
  convertedLostValue: null,
  homeCurrency: 'USD',
  homeSymbol: '$',
  unratedCount: 0,
  ratesLastUpdated: null,
  hasRates: false,
  repRows: [],
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
  mixedCurrencies: false,
  currency: 'USD',
  stageBreakdown: [
    {
      stage: 'Prospecting',
      count: 1,
      value: '50000.00',
      weightedValue: '5000.00',
      mixedCurrencies: false,
      currency: 'USD',
    },
    {
      stage: 'Qualification',
      count: 2,
      value: '100000.00',
      weightedValue: '25000.00',
      mixedCurrencies: false,
      currency: 'USD',
    },
  ],
  recentActivities: [RECENT_ACTIVITY_1],
  // MINCRM-253 — no rates configured in test fixture
  convertedPipelineValue: null,
  convertedWeightedPipelineValue: null,
  homeCurrency: 'USD',
  homeSymbol: '$',
  unratedCount: 0,
  unratedCurrencies: null,
  ratesLastUpdated: null,
  hasRates: false,
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

/** Reusable fixture: stage trend report response (MINCRM-284) */
export const STAGE_TREND_REPORT: StageTrendReportResponse = {
  stages: ['Prospecting', 'Qualification', 'Proposal'],
  dataPoints: [
    { stage: 'Prospecting', period: '2026-04-01', entered: 5, converted: 3 },
    { stage: 'Prospecting', period: '2026-04-08', entered: 4, converted: 2 },
    { stage: 'Qualification', period: '2026-04-01', entered: 3, converted: 2 },
    { stage: 'Qualification', period: '2026-04-08', entered: 2, converted: 1 },
    { stage: 'Proposal', period: '2026-04-01', entered: 2, converted: 1 },
    { stage: 'Proposal', period: '2026-04-08', entered: 1, converted: 0 },
  ],
  windowStart: '2026-04-01',
  windowEnd: '2026-04-30',
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
  version: 1,
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
  version: 1,
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
  version: 1,
};

/** Reusable fixture: a deal record */
export const DEAL_1: DealResponse = {
  id: '00000000-0000-0000-0000-000000000301',
  pipeline_id: DEFAULT_PIPELINE_ID,
  name: 'Acme Enterprise Deal',
  stage: 'Prospecting',
  value: '50000.00',
  currency: 'USD',
  close_date: '2026-12-31',
  loss_reason: null,
  account_id: '00000000-0000-0000-0000-000000000201',
  owner_id: '00000000-0000-0000-0000-000000000001',
  effective_probability: 10,
  probability_is_overridden: false,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  version: 1,
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
  version: 1,
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
  version: 1,
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
  version: 1,
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
  version: 1,
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
  version: 1,
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
  version: 1,
};

/** Default handlers — can be overridden in individual tests with server.use() */
export const handlers = [
  /** Auth: GET /api/auth/me — returns admin by default */
  http.get('/api/v1/auth/me', () => {
    return HttpResponse.json({ user: ADMIN_USER });
  }),

  /** Auth: POST /api/auth/login */
  http.post('/api/v1/auth/login', async ({ request }) => {
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
  http.post('/api/v1/auth/logout', () => {
    return HttpResponse.json({ message: 'Logged out' });
  }),

  /** Users: GET /api/users */
  http.get('/api/v1/users', () => {
    const users = [ADMIN_USER, REP_USER, INVITED_USER];
    return HttpResponse.json({ data: users, total: users.length, page: 1, limit: 25 });
  }),

  /** Users: GET /api/users/active — returns only active users with id+name */
  http.get('/api/v1/users/active', () => {
    return HttpResponse.json({
      users: [
        { id: ADMIN_USER.id, name: ADMIN_USER.name },
        { id: REP_USER.id, name: REP_USER.name },
      ],
    });
  }),

  /** Users: POST /api/users/invite */
  http.post('/api/v1/users/invite', async ({ request }) => {
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
  http.patch('/api/v1/users/:id/role', async ({ params, request }) => {
    const body = (await request.json()) as { role: string };
    return HttpResponse.json({
      user: { ...ADMIN_USER, id: params.id as string, role: body.role },
    });
  }),

  /** Users: PATCH /api/users/:id/deactivate */
  http.patch('/api/v1/users/:id/deactivate', ({ params }) => {
    return HttpResponse.json({
      user: { ...ADMIN_USER, id: params.id as string, status: 'inactive' },
    });
  }),

  /** Users: PATCH /api/users/:id/reactivate */
  http.patch('/api/v1/users/:id/reactivate', ({ params }) => {
    return HttpResponse.json({
      user: { ...ADMIN_USER, id: params.id as string, status: 'active' },
    });
  }),

  /** Users: POST /api/users/:id/reset-onboarding — admin resets a user's onboarding checklist */
  http.post('/api/v1/users/:id/reset-onboarding', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Users: POST /api/users/:id/admin-set-password — admin sets a user's password */
  http.post('/api/v1/users/:id/admin-set-password', ({ params }) => {
    return HttpResponse.json({
      user: { ...REP_USER, id: params.id as string, must_change_password: true },
    });
  }),

  /** Auth: POST /api/auth/change-password */
  http.post('/api/v1/auth/change-password', () => {
    return HttpResponse.json({ message: 'Password changed successfully' });
  }),

  /** Auth: POST /api/auth/forgot-password — always returns 200 */
  http.post('/api/v1/auth/forgot-password', () => {
    return HttpResponse.json({
      message: 'If an account with that email exists, a reset link has been sent.',
    });
  }),

  /** Auth: POST /api/auth/reset-password — returns admin user on success */
  http.post('/api/v1/auth/reset-password', () => {
    return HttpResponse.json({ user: ADMIN_USER });
  }),

  /** Contacts: GET /api/contacts — supports ?account=<id> and ?owner=me filters */
  http.get('/api/v1/contacts', ({ request }) => {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('account');
    const owner = url.searchParams.get('owner');
    let contacts = [CONTACT_1, CONTACT_2];
    if (accountId) contacts = contacts.filter((c) => c.account_id === accountId);
    if (owner === 'me') contacts = contacts.filter((c) => c.owner_id === ADMIN_USER.id);
    return HttpResponse.json({ data: contacts, total: contacts.length, page: 1, limit: 25 });
  }),

  /** Contacts: POST /api/contacts */
  http.post('/api/v1/contacts', async ({ request }) => {
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
  http.get('/api/v1/contacts/:id', ({ params }) => {
    if (params.id === CONTACT_1.id) {
      return HttpResponse.json({ contact: CONTACT_1 });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
      { status: 404 },
    );
  }),

  /** Contacts: PATCH /api/contacts/:id */
  http.patch('/api/v1/contacts/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<ContactResponse>;
    return HttpResponse.json({
      contact: { ...CONTACT_1, ...body, id: params.id as string },
    });
  }),

  /** Contacts: DELETE /api/contacts/:id */
  http.delete('/api/v1/contacts/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Contacts: GET /api/contacts/:id/deals — returns deals linked to a contact */
  http.get('/api/v1/contacts/:id/deals', ({ params }) => {
    // By default return DEAL_1 when fetching CONTACT_1's deals; empty for others
    if (params.id === CONTACT_1.id) {
      return HttpResponse.json({ deals: [DEAL_1] });
    }
    return HttpResponse.json({ deals: [] });
  }),

  /** Accounts: GET /api/accounts */
  http.get('/api/v1/accounts', () => {
    return HttpResponse.json({ data: [ACCOUNT_1], total: 1, page: 1, limit: 25 });
  }),

  /** Accounts: POST /api/accounts */
  http.post('/api/v1/accounts', async ({ request }) => {
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
  http.get('/api/v1/accounts/:id', ({ params }) => {
    if (params.id === ACCOUNT_1.id) {
      return HttpResponse.json({ account: ACCOUNT_1 });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Account not found' } },
      { status: 404 },
    );
  }),

  /** Accounts: PATCH /api/accounts/:id */
  http.patch('/api/v1/accounts/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<AccountResponse>;
    return HttpResponse.json({
      account: { ...ACCOUNT_1, ...body, id: params.id as string },
    });
  }),

  /** Accounts: DELETE /api/accounts/:id */
  http.delete('/api/v1/accounts/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Accounts: GET /api/accounts/:id/children — returns empty list by default */
  http.get('/api/v1/accounts/:id/children', () => {
    return HttpResponse.json([]);
  }),

  /** Accounts: GET /api/accounts/search — returns empty list by default */
  http.get('/api/v1/accounts/search', () => {
    return HttpResponse.json([]);
  }),

  /** Contacts: GET /api/contacts/:id/addresses — returns empty list by default */
  http.get('/api/v1/contacts/:id/addresses', () => {
    return HttpResponse.json({ addresses: [] });
  }),

  /** Contacts: POST /api/contacts/:id/addresses */
  http.post('/api/v1/contacts/:id/addresses', async ({ request }) => {
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
  http.delete('/api/v1/contacts/:id/addresses/:addressId', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Contacts: POST /api/contacts/:id/addresses/:addressId/set-default */
  http.post('/api/v1/contacts/:id/addresses/:addressId/set-default', ({ params }) => {
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
  http.get('/api/v1/deals', ({ request }) => {
    const url = new URL(request.url);
    const owner = url.searchParams.get('owner');
    let deals = [DEAL_1];
    if (owner === 'me') deals = deals.filter((d) => d.owner_id === ADMIN_USER.id);
    return HttpResponse.json({ data: deals, total: deals.length, page: 1, limit: 25 });
  }),

  /** Deals: POST /api/deals */
  http.post('/api/v1/deals', async ({ request }) => {
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
  http.get('/api/v1/deals/:id', ({ params }) => {
    if (params.id === DEAL_1.id) {
      return HttpResponse.json({ deal: DEAL_1, contacts: [] });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Deal not found' } },
      { status: 404 },
    );
  }),

  /** Deals: PATCH /api/deals/:id */
  http.patch('/api/v1/deals/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<DealResponse>;
    return HttpResponse.json({
      deal: { ...DEAL_1, ...body, id: params.id as string },
    });
  }),

  /** Deals: DELETE /api/deals/:id */
  http.delete('/api/v1/deals/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Deals: POST /api/deals/:id/contacts/:contactId — link a contact to a deal */
  http.post('/api/v1/deals/:id/contacts/:contactId', ({ params }) => {
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
  http.delete('/api/v1/deals/:id/contacts/:contactId', () => {
    return HttpResponse.json({ contacts: [] });
  }),

  /** Dashboard: GET /api/dashboard/summary — returns dashboard summary metrics */
  http.get('/api/v1/dashboard/summary', () => {
    return HttpResponse.json(DASHBOARD_SUMMARY);
  }),

  /** Reports: GET /api/reports/win-loss — returns win/loss report */
  http.get('/api/v1/reports/win-loss', () => {
    return HttpResponse.json(WIN_LOSS_REPORT);
  }),

  /** Reports: GET /api/reports/activity-volume — returns activity volume report (MINCRM-181) */
  http.get('/api/v1/reports/activity-volume', () => {
    return HttpResponse.json(ACTIVITY_VOLUME_REPORT);
  }),

  /** Reports: GET /api/reports/stage-trend — returns stage trend report (MINCRM-284) */
  http.get('/api/v1/reports/stage-trend', () => {
    return HttpResponse.json(STAGE_TREND_REPORT);
  }),

  /** Custom Reports: GET /api/v1/reports/custom — returns saved custom reports list (MINCRM-402) */
  http.get('/api/v1/reports/custom', () => {
    return HttpResponse.json({ reports: [] });
  }),

  /** Custom Reports: POST /api/v1/reports/custom/run — executes ad-hoc report (MINCRM-402) */
  http.post('/api/v1/reports/custom/run', () => {
    return HttpResponse.json({ columns: ['id', 'first_name'], rows: [], row_count: 0 });
  }),

  /** Custom Reports: POST /api/v1/reports/custom — creates a saved report (MINCRM-402) */
  http.post('/api/v1/reports/custom', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        id: '00000000-0000-0000-0000-000000000099',
        name: body['name'] ?? 'Test Report',
        entity_type: body['entity_type'] ?? 'contact',
        config: body['config'] ?? { selected_fields: ['id'], filters: [] },
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { status: 201 },
    );
  }),

  /** Custom Reports: PATCH /api/v1/reports/custom/:id — updates a saved report (MINCRM-402) */
  http.patch('/api/v1/reports/custom/:id', async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      id: params['id'],
      name: body['name'] ?? 'Updated Report',
      entity_type: 'contact',
      config: body['config'] ?? { selected_fields: ['id'], filters: [] },
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }),

  /** Custom Reports: DELETE /api/v1/reports/custom/:id — deletes a saved report (MINCRM-402) */
  http.delete('/api/v1/reports/custom/:id', ({ params }) => {
    return HttpResponse.json({ id: params['id'] });
  }),

  /** Custom Reports: POST /api/v1/reports/custom/:id/run — runs a saved report (MINCRM-402) */
  http.post('/api/v1/reports/custom/:id/run', () => {
    return HttpResponse.json({ columns: ['id', 'first_name'], rows: [], row_count: 0 });
  }),

  /** Activities: GET /api/activities/my-tasks — returns paginated task rows with linked record info */
  http.get('/api/v1/activities/my-tasks', () => {
    const tasks = [MY_TASK_1, MY_TASK_OVERDUE];
    return HttpResponse.json({ tasks, total: tasks.length, page: 1, limit: 25 });
  }),

  /** Activities: GET /api/activities — supports ?contact, ?account, ?deal, ?owner=me filters */
  http.get('/api/v1/activities', ({ request }) => {
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
  http.post('/api/v1/activities', async ({ request }) => {
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
  http.get('/api/v1/activities/:id', ({ params }) => {
    if (params.id === ACTIVITY_1.id) return HttpResponse.json({ activity: ACTIVITY_1 });
    if (params.id === ACTIVITY_2.id) return HttpResponse.json({ activity: ACTIVITY_2 });
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Activity not found' } },
      { status: 404 },
    );
  }),

  /** Activities: PATCH /api/activities/:id */
  http.patch('/api/v1/activities/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<ActivityResponse>;
    const base = params.id === ACTIVITY_2.id ? ACTIVITY_2 : ACTIVITY_1;
    return HttpResponse.json({ activity: { ...base, ...body, id: params.id as string } });
  }),

  /** Activities: DELETE /api/activities/:id */
  http.delete('/api/v1/activities/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Settings: GET /api/settings/default-language */
  http.get('/api/v1/settings/default-language', () => {
    return HttpResponse.json({ language: 'en' });
  }),

  /** Settings: PATCH /api/settings/default-language */
  http.patch('/api/v1/settings/default-language', async ({ request }) => {
    const body = (await request.json()) as { language: string };
    return HttpResponse.json({ language: body.language });
  }),

  /** Settings: GET /api/settings/nav-layout (MINCRM-133) */
  http.get('/api/v1/settings/nav-layout', () => {
    return HttpResponse.json({ layout: 'top' });
  }),

  /** Settings: PATCH /api/settings/nav-layout (MINCRM-133) */
  http.patch('/api/v1/settings/nav-layout', async ({ request }) => {
    const body = (await request.json()) as { layout: string };
    return HttpResponse.json({ layout: body.layout });
  }),

  /** Settings: GET /api/settings/email-notifications (MINCRM-163) */
  http.get('/api/v1/settings/email-notifications', () => {
    return HttpResponse.json({ enabled: true });
  }),

  /** Settings: PATCH /api/settings/email-notifications (MINCRM-163) */
  http.patch('/api/v1/settings/email-notifications', async ({ request }) => {
    const body = (await request.json()) as { enabled: boolean };
    return HttpResponse.json({ enabled: body.enabled });
  }),

  /** Settings: GET /api/settings/default-currency (MINCRM-189) */
  http.get('/api/v1/settings/default-currency', () => {
    return HttpResponse.json({ currency: 'USD' });
  }),

  /** Settings: PATCH /api/settings/default-currency (MINCRM-189) */
  http.patch('/api/v1/settings/default-currency', async ({ request }) => {
    const body = (await request.json()) as { currency: string };
    return HttpResponse.json({ currency: body.currency });
  }),

  /** Settings: GET /api/settings/currencies (MINCRM-251) */
  http.get('/api/v1/settings/currencies', () => {
    return HttpResponse.json({
      home_currency: 'USD',
      currencies: [
        {
          code: 'USD',
          name: 'US Dollar',
          symbol: '$',
          rate_to_home: 1,
          is_home: true,
          updated_at: new Date().toISOString(),
        },
      ],
    });
  }),

  /** Settings: PUT /api/settings/currencies (MINCRM-251) */
  http.put('/api/v1/settings/currencies', async ({ request }) => {
    const body = (await request.json()) as {
      home_currency: string;
      currencies: Array<{ code: string; name: string; symbol: string; rate_to_home: number }>;
    };
    return HttpResponse.json({
      home_currency: body.home_currency,
      currencies: [
        {
          code: body.home_currency,
          name: body.home_currency,
          symbol: body.home_currency,
          rate_to_home: 1,
          is_home: true,
          updated_at: new Date().toISOString(),
        },
        ...body.currencies.map((c) => ({
          ...c,
          is_home: false,
          updated_at: new Date().toISOString(),
        })),
      ],
    });
  }),

  /** Users: GET /api/users/notification-recipient-count (MINCRM-163) */
  http.get('/api/v1/users/notification-recipient-count', () => {
    return HttpResponse.json({ count: 2 });
  }),

  /** Users: GET /api/users/me/notification-preferences (MINCRM-161, MINCRM-162) */
  http.get('/api/v1/users/me/notification-preferences', () => {
    return HttpResponse.json({
      preferences: {
        notify_overdue_tasks: true,
        notify_assignments: true,
        notify_deal_stage_changes: true,
      },
    });
  }),

  /** Users: PATCH /api/users/me/notification-preferences (MINCRM-161, MINCRM-162) */
  http.patch('/api/v1/users/me/notification-preferences', async ({ request }) => {
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
  http.get('/api/v1/users/me/language', () => {
    return HttpResponse.json({ language: null });
  }),

  /** Users: PATCH /api/users/me/language — echoes back the saved language */
  http.patch('/api/v1/users/me/language', async ({ request }) => {
    const body = (await request.json()) as { language: string | null };
    return HttpResponse.json({ language: body.language });
  }),

  /** Automation: GET /api/automation/rules — returns paginated list */
  http.get('/api/v1/automation/rules', () => {
    return HttpResponse.json({ data: [AUTOMATION_RULE_1], total: 1, page: 1, limit: 25 });
  }),

  /** Automation: POST /api/automation/rules */
  http.post('/api/v1/automation/rules', async ({ request }) => {
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
  http.get('/api/v1/automation/rules/:id', ({ params }) => {
    if (params.id === AUTOMATION_RULE_1.id) {
      return HttpResponse.json({ rule: AUTOMATION_RULE_1 });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Automation rule not found' } },
      { status: 404 },
    );
  }),

  /** Automation: PATCH /api/automation/rules/:id */
  http.patch('/api/v1/automation/rules/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<AutomationRuleResponse>;
    return HttpResponse.json({
      rule: { ...AUTOMATION_RULE_1, ...body, id: params.id as string },
    });
  }),

  /** Automation: DELETE /api/automation/rules/:id */
  http.delete('/api/v1/automation/rules/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Automation: GET /api/automation/rules/:id/logs */
  http.get('/api/v1/automation/rules/:id/logs', ({ params }) => {
    if (params.id === AUTOMATION_RULE_1.id) {
      return HttpResponse.json({ logs: [AUTOMATION_LOG_1] });
    }
    return HttpResponse.json({ logs: [] });
  }),

  /** Admin: GET /api/admin/demo/status — no demo data by default */
  http.get('/api/v1/admin/demo/status', () => {
    return HttpResponse.json({ active: false });
  }),

  /** Admin: POST /api/admin/demo/seed */
  http.post('/api/v1/admin/demo/seed', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Admin: POST /api/admin/demo/reset */
  http.post('/api/v1/admin/demo/reset', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Admin: DELETE /api/admin/demo */
  http.delete('/api/v1/admin/demo', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Import: POST /api/admin/import/:entity/parse — returns headers, fields, preview */
  http.post('/api/v1/admin/import/:entity/parse', ({ params }) => {
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

  /** Import: POST /api/admin/import/:entity/run — returns job_id immediately (202) */
  http.post('/api/v1/admin/import/:entity/run', () => {
    return HttpResponse.json({ job_id: 'test-job-id', status: 'pending' }, { status: 202 });
  }),

  /** Import: GET /api/admin/import/jobs/:job_id — returns completed job status */
  http.get('/api/v1/admin/import/jobs/:job_id', () => {
    return HttpResponse.json({
      job_id: 'test-job-id',
      type: 'contacts',
      status: 'complete',
      total_rows: 3,
      processed_rows: 3,
      created: 2,
      skipped: 1,
      failed: 0,
      error_csv: null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  }),

  /** Search: GET /api/search — returns contacts, accounts, and deals matching ?q= */
  http.get('/api/v1/search', ({ request }) => {
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
      leads: [],
    };
    return HttpResponse.json(searchResponse);
  }),

  // ── Attachments (MINCRM-167) ─────────────────────────────────────────────────

  /** Attachments: GET /api/attachments — returns empty list by default */
  http.get('/api/v1/attachments', () => {
    return HttpResponse.json({ attachments: [] });
  }),

  /** Attachments: POST /api/attachments — returns a created attachment */
  http.post('/api/v1/attachments', () => {
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
  http.delete('/api/v1/attachments/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Storage settings (MINCRM-169) ────────────────────────────────────────────

  /** Settings: GET /api/settings/storage/status — not configured by default */
  http.get('/api/v1/settings/storage/status', () => {
    return HttpResponse.json({ configured: false });
  }),

  /** Settings: GET /api/settings/storage — not configured by default */
  http.get('/api/v1/settings/storage', () => {
    return HttpResponse.json({ configured: false, config: null });
  }),

  /** Settings: PUT /api/settings/storage */
  http.put('/api/v1/settings/storage', async ({ request }) => {
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
  http.delete('/api/v1/settings/storage', () => {
    return HttpResponse.json({ configured: false, config: null });
  }),

  /** Settings: POST /api/settings/storage/test */
  http.post('/api/v1/settings/storage/test', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Settings: GET /api/settings/sso/status — SSO disabled by default (MINCRM-399) */
  http.get('/api/v1/settings/sso/status', () => {
    return HttpResponse.json({ enabled: false, protocol: null });
  }),

  /** Settings: GET /api/settings/sso — not configured by default (MINCRM-399) */
  http.get('/api/v1/settings/sso', () => {
    return HttpResponse.json({ sso: null });
  }),

  /** Settings: PUT /api/settings/sso (MINCRM-399) */
  http.put('/api/v1/settings/sso', async ({ request }) => {
    const body = (await request.json()) as {
      protocol: string;
      idp_metadata_url: string;
      entity_id: string;
    };
    return HttpResponse.json({
      sso: {
        protocol: body.protocol,
        idp_metadata_url: body.idp_metadata_url,
        entity_id: body.entity_id,
        idp_certificate_set: false,
      },
    });
  }),

  /** Settings: DELETE /api/settings/sso (MINCRM-399) */
  http.delete('/api/v1/settings/sso', () => {
    return HttpResponse.json({ ok: true });
  }),

  /** Settings: GET /api/settings/tags-restrict-creation (MINCRM-263) */
  http.get('/api/v1/settings/tags-restrict-creation', () => {
    return HttpResponse.json({ restricted: false });
  }),

  /** Settings: PATCH /api/settings/tags-restrict-creation (MINCRM-263) */
  http.patch('/api/v1/settings/tags-restrict-creation', async ({ request }) => {
    const body = (await request.json()) as { restricted: boolean };
    return HttpResponse.json({ restricted: body.restricted });
  }),

  /** Settings: GET /api/settings/smtp — no password set by default (MINCRM-254) */
  http.get('/api/v1/settings/smtp', () => {
    return HttpResponse.json({
      smtp_host: '',
      smtp_port: 587,
      smtp_user: '',
      smtp_pass_set: false,
      smtp_enabled: false,
    });
  }),

  /** Settings: PUT /api/settings/smtp (MINCRM-254) */
  http.put('/api/v1/settings/smtp', async ({ request }) => {
    const body = (await request.json()) as {
      smtp_host: string;
      smtp_port: number;
      smtp_user: string;
      smtp_pass?: string;
      smtp_enabled: boolean;
    };
    return HttpResponse.json({
      smtp_host: body.smtp_host,
      smtp_port: body.smtp_port,
      smtp_user: body.smtp_user,
      smtp_pass_set: Boolean(body.smtp_pass),
      smtp_enabled: body.smtp_enabled,
    });
  }),

  /** Settings: POST /api/settings/smtp/test (MINCRM-254) */
  http.post('/api/v1/settings/smtp/test', () => {
    return HttpResponse.json({ success: true });
  }),

  /** Leads: GET /api/leads — returns LEAD_1 by default (MINCRM-173) */
  http.get('/api/v1/leads', () => {
    return HttpResponse.json({ data: [LEAD_1], total: 1, page: 1, limit: 25 });
  }),

  /** Leads: POST /api/leads */
  http.post('/api/v1/leads', async ({ request }) => {
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
  http.get('/api/v1/leads/:id', ({ params }) => {
    if (params.id === LEAD_1.id) {
      return HttpResponse.json({ lead: LEAD_1 });
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Lead not found' } },
      { status: 404 },
    );
  }),

  /** Leads: PATCH /api/leads/:id */
  http.patch('/api/v1/leads/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<LeadResponse>;
    return HttpResponse.json({ lead: { ...LEAD_1, ...body, id: params.id as string } });
  }),

  /** Leads: DELETE /api/leads/:id */
  http.delete('/api/v1/leads/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Leads: GET /api/leads/:id/status-history */
  http.get('/api/v1/leads/:id/status-history', () => {
    return HttpResponse.json({ history: [] });
  }),

  /** Leads: POST /api/leads/:id/convert */
  http.post('/api/v1/leads/:id/convert', () => {
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
  http.get('/api/v1/leads/accounts/search', () => {
    return HttpResponse.json({ accounts: [{ id: ACCOUNT_1.id, name: ACCOUNT_1.name }] });
  }),

  /** Audit log: GET /api/audit-log/record — returns empty history by default */
  http.get('/api/v1/audit-log/record', () => {
    return HttpResponse.json({ entries: [] });
  }),

  /** Audit log: GET /api/audit-log — returns empty paginated list by default */
  http.get('/api/v1/audit-log', () => {
    return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
  }),

  /** Audit log: GET /api/audit-log/actors — returns empty list by default */
  http.get('/api/v1/audit-log/actors', () => {
    return HttpResponse.json({ actors: [] });
  }),

  // ── Pipelines (MINCRM-397) ────────────────────────────────────────────────────

  /** Pipelines: GET /api/pipelines — returns the single default pipeline */
  http.get('/api/v1/pipelines', () => {
    return HttpResponse.json({ pipelines: [DEFAULT_PIPELINE_FIXTURE] });
  }),

  /** Pipelines: POST /api/pipelines — creates a new pipeline */
  http.post('/api/v1/pipelines', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    const newPipeline: PipelineResponse = {
      id: '00000000-0000-0000-0000-000000000002',
      name: body.name,
      is_default: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(newPipeline, { status: 201 });
  }),

  /** Pipelines: PATCH /api/pipelines/:id — renames a pipeline */
  http.patch('/api/v1/pipelines/:id', async ({ params, request }) => {
    const body = (await request.json()) as { name?: string };
    return HttpResponse.json({
      ...DEFAULT_PIPELINE_FIXTURE,
      id: params.id as string,
      ...body,
      updated_at: new Date().toISOString(),
    });
  }),

  /** Pipelines: DELETE /api/pipelines/:id — deletes a pipeline */
  http.delete('/api/v1/pipelines/:id', ({ params }) => {
    return HttpResponse.json({ id: params.id });
  }),

  /** Pipeline stages: GET /api/settings/pipeline-stages — returns six seed stages */
  http.get('/api/v1/settings/pipeline-stages', () => {
    return HttpResponse.json({ stages: PIPELINE_STAGES_FIXTURE });
  }),

  /** Pipeline stages: POST /api/settings/pipeline-stages — creates a new stage */
  http.post('/api/v1/settings/pipeline-stages', async ({ request }) => {
    const body = (await request.json()) as { name: string; probability?: number };
    const newStage: PipelineStageResponse = {
      id: '00000000-0000-0000-0000-000000000901',
      name: body.name,
      sort_order: 50,
      probability: body.probability ?? 0,
      is_terminal: false,
      is_fixed: false,
      pipeline_id: DEFAULT_PIPELINE_ID,
    };
    return HttpResponse.json(newStage, { status: 201 });
  }),

  /** Pipeline stages: PATCH /api/settings/pipeline-stages/:id — updates a stage */
  http.patch('/api/v1/settings/pipeline-stages/:id', async ({ params, request }) => {
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
  http.delete('/api/v1/settings/pipeline-stages/:id', ({ params }) => {
    return HttpResponse.json({ id: params.id });
  }),

  /** Pipeline stages: PUT /api/settings/pipeline-stages/reorder — batch reorder (MINCRM-381) */
  http.put('/api/v1/settings/pipeline-stages/reorder', async ({ request }) => {
    const body = (await request.json()) as { stages: string[] };
    const reordered = body.stages.map((id, i) => {
      const existing = PIPELINE_STAGES_FIXTURE.find((s) => s.id === id);
      if (!existing) {
        return null;
      }
      return { ...existing, sort_order: i + 1 };
    });
    if (reordered.some((s) => s === null)) {
      return HttpResponse.json(
        { error: { code: 'STAGE_NOT_FOUND', message: 'Pipeline stage not found' } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ stages: reordered });
  }),

  // ── Bulk operations (MINCRM-188) ─────────────────────────────────────────────

  /** Bulk: POST /api/contacts/bulk — returns affected count */
  http.post('/api/v1/contacts/bulk', () => {
    return HttpResponse.json({ affected: 1 });
  }),

  /** Bulk: POST /api/accounts/bulk — returns affected count */
  http.post('/api/v1/accounts/bulk', () => {
    return HttpResponse.json({ affected: 1 });
  }),

  /** Bulk: POST /api/deals/bulk — returns affected count */
  http.post('/api/v1/deals/bulk', () => {
    return HttpResponse.json({ affected: 1 });
  }),

  // ── Tags (MINCRM-186) ─────────────────────────────────────────────────────────

  /** Tags: GET /api/tags — returns paginated empty list by default */
  http.get('/api/v1/tags', () => {
    return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
  }),

  /** Tags: POST /api/tags */
  http.post('/api/v1/tags', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json(
      {
        tag: {
          id: '00000000-0000-0000-0000-000000000b01',
          name: body.name,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  }),

  /** Tags: GET /api/tags/:id */
  http.get('/api/v1/tags/:id', ({ params }) => {
    return HttpResponse.json({
      tag: {
        id: params.id,
        name: 'sample-tag',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }),

  /** Tags: PATCH /api/tags/:id — admin rename */
  http.patch('/api/v1/tags/:id', async ({ params, request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({
      tag: {
        id: params.id,
        name: body.name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }),

  /** Tags: DELETE /api/tags/:id — admin delete */
  http.delete('/api/v1/tags/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Contacts: GET /api/contacts/:id/tags — returns empty list by default */
  http.get('/api/v1/contacts/:id/tags', () => {
    return HttpResponse.json({ tags: [] });
  }),

  /** Contacts: POST /api/contacts/:id/tags — attach a tag */
  http.post('/api/v1/contacts/:id/tags', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({
      tag: {
        id: '00000000-0000-0000-0000-000000000b02',
        name: body.name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }),

  /** Contacts: DELETE /api/contacts/:id/tags/:tagId — detach a tag */
  http.delete('/api/v1/contacts/:id/tags/:tagId', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Accounts: GET /api/accounts/:id/tags — returns empty list by default */
  http.get('/api/v1/accounts/:id/tags', () => {
    return HttpResponse.json({ tags: [] });
  }),

  /** Accounts: POST /api/accounts/:id/tags — attach a tag */
  http.post('/api/v1/accounts/:id/tags', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({
      tag: {
        id: '00000000-0000-0000-0000-000000000b03',
        name: body.name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }),

  /** Accounts: DELETE /api/accounts/:id/tags/:tagId — detach a tag */
  http.delete('/api/v1/accounts/:id/tags/:tagId', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Deals: GET /api/deals/:id/tags — returns empty list by default */
  http.get('/api/v1/deals/:id/tags', () => {
    return HttpResponse.json({ tags: [] });
  }),

  /** Deals: POST /api/deals/:id/tags — attach a tag */
  http.post('/api/v1/deals/:id/tags', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({
      tag: {
        id: '00000000-0000-0000-0000-000000000b04',
        name: body.name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }),

  /** Deals: DELETE /api/deals/:id/tags/:tagId — detach a tag */
  http.delete('/api/v1/deals/:id/tags/:tagId', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Settings: GET /api/settings/branding — no branding by default (MINCRM-356) */
  http.get('/api/v1/settings/branding', () => {
    return HttpResponse.json({ branding: null });
  }),

  /** Settings: PUT /api/settings/branding (MINCRM-356) */
  http.put('/api/v1/settings/branding', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      branding: {
        logoUrl: body['logoUrl'] ?? null,
        logoAltText: body['logoAltText'] ?? null,
        faviconUrl: body['faviconUrl'] ?? null,
        primaryColor: body['primaryColor'] ?? null,
        primaryColorText: body['primaryColor'] ? '#ffffff' : null,
        fontFamily: body['fontFamily'] ?? null,
        companyName: body['companyName'] ?? null,
        poweredByEnabled: true,
      },
    });
  }),

  /** Settings: DELETE /api/settings/branding (MINCRM-356) */
  http.delete('/api/v1/settings/branding', () => {
    return HttpResponse.json({ branding: null });
  }),

  /** Setup checklist: GET /api/settings/onboarding — not first run by default (MINCRM-256, MINCRM-379) */
  http.get('/api/v1/settings/onboarding', () => {
    return HttpResponse.json({
      is_first_run: false,
      onboarding_completed: false,
      tasks: [
        { id: 'pipeline_stages_reviewed', completed: false },
        { id: 'team_member_invited', completed: false },
        { id: 'first_contact_added', completed: false },
        { id: 'first_deal_created', completed: false },
        { id: 'smtp_configured', completed: false },
      ],
    });
  }),

  /** Onboarding: PUT /api/settings/onboarding — mark completed (MINCRM-256) */
  http.put('/api/v1/settings/onboarding', () => {
    return HttpResponse.json({ onboarding_completed: true });
  }),

  /** Contacts: POST /api/contacts/:id/send-email — SMTP not configured in test (MINCRM-275) */
  http.post('/api/v1/contacts/:id/send-email', () => {
    return HttpResponse.json({
      delivered: false,
      activityId: '00000000-0000-0000-0000-000000000e01',
    });
  }),

  /** Custom fields: GET /api/custom-fields/definitions — returns empty list (MINCRM-276) */
  http.get('/api/v1/custom-fields/definitions', () => {
    return HttpResponse.json({ definitions: [] });
  }),

  /** Custom fields: POST /api/custom-fields/definitions — create definition (MINCRM-276) */
  http.post('/api/v1/custom-fields/definitions', async ({ request }) => {
    const body = (await request.json()) as {
      entity_type: string;
      name: string;
      field_type: string;
    };
    return HttpResponse.json(
      {
        id: '00000000-0000-0000-0000-000000000cf1',
        entity_type: body.entity_type,
        name: body.name,
        field_type: body.field_type,
        options: null,
        sort_order: 0,
        created_at: new Date().toISOString(),
      },
      { status: 201 },
    );
  }),

  /** Custom fields: PATCH /api/custom-fields/definitions/:id — update definition (MINCRM-276) */
  http.patch('/api/v1/custom-fields/definitions/:id', ({ params }) => {
    return HttpResponse.json({
      id: params['id'],
      entity_type: 'contact',
      name: 'Updated Field',
      field_type: 'text',
      options: null,
      sort_order: 0,
      created_at: new Date().toISOString(),
    });
  }),

  /** Custom fields: DELETE /api/custom-fields/definitions/:id — delete definition (MINCRM-276) */
  http.delete('/api/v1/custom-fields/definitions/:id', ({ params }) => {
    return HttpResponse.json({ id: params['id'] });
  }),

  /** Custom fields: GET /api/custom-fields/:entityType/:recordId/custom-fields — returns empty (MINCRM-276) */
  http.get('/api/v1/custom-fields/:entityType/:recordId/custom-fields', () => {
    return HttpResponse.json({ values: [] });
  }),

  /** Custom fields: PUT /api/custom-fields/:entityType/:recordId/custom-fields — upsert values (MINCRM-276) */
  http.put('/api/v1/custom-fields/:entityType/:recordId/custom-fields', () => {
    return HttpResponse.json({ values: [] });
  }),

  // ── Webhooks (MINCRM-279) ────────────────────────────────────────────────────

  /** Webhooks: GET /api/admin/webhooks — returns empty list by default */
  http.get('/api/v1/admin/webhooks', () => {
    return HttpResponse.json({ subscriptions: [] });
  }),

  /** Webhooks: POST /api/admin/webhooks */
  http.post('/api/v1/admin/webhooks', async ({ request }) => {
    const body = (await request.json()) as { url: string; events: string[] };
    return HttpResponse.json(
      {
        subscription: {
          id: '00000000-0000-0000-0000-000000000wh1',
          url: body.url,
          events: body.events,
          status: 'active',
          created_by: '00000000-0000-0000-0000-000000000001',
          created_at: new Date().toISOString(),
        },
        plaintextSecret: 'test-plaintext-secret-64-chars-placeholder-value-padding-here',
      },
      { status: 201 },
    );
  }),

  /** Webhooks: GET /api/admin/webhooks/:id */
  http.get('/api/v1/admin/webhooks/:id', ({ params }) => {
    return HttpResponse.json({
      subscription: {
        id: params.id,
        url: 'https://example.com/hook',
        events: ['contact.created'],
        status: 'active',
        created_by: '00000000-0000-0000-0000-000000000001',
        created_at: new Date().toISOString(),
      },
    });
  }),

  /** Webhooks: PATCH /api/admin/webhooks/:id */
  http.patch('/api/v1/admin/webhooks/:id', async ({ params, request }) => {
    const body = (await request.json()) as { url?: string; events?: string[]; status?: string };
    return HttpResponse.json({
      subscription: {
        id: params.id,
        url: body.url ?? 'https://example.com/hook',
        events: body.events ?? ['contact.created'],
        status: body.status ?? 'active',
        created_by: '00000000-0000-0000-0000-000000000001',
        created_at: new Date().toISOString(),
      },
    });
  }),

  /** Webhooks: DELETE /api/admin/webhooks/:id */
  http.delete('/api/v1/admin/webhooks/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  /** Webhooks: GET /api/admin/webhooks/:id/logs — returns empty paginated list by default */
  http.get('/api/v1/admin/webhooks/:id/logs', () => {
    return HttpResponse.json({ data: [], total: 0, page: 1, limit: 20 });
  }),

  // ── Notes (MINCRM-352) ────────────────────────────────────────────────────

  /** Notes: GET /api/v1/contact/:id/notes — returns empty paginated list by default */
  http.get('/api/v1/contact/:id/notes', () => {
    return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
  }),

  /** Notes: GET /api/v1/account/:id/notes — returns empty paginated list by default */
  http.get('/api/v1/account/:id/notes', () => {
    return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
  }),

  /** Notes: GET /api/v1/deal/:id/notes — returns empty paginated list by default */
  http.get('/api/v1/deal/:id/notes', () => {
    return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
  }),

  /** Notes: GET /api/v1/lead/:id/notes — returns empty paginated list by default */
  http.get('/api/v1/lead/:id/notes', () => {
    return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
  }),

  // ── GDPR (MINCRM-364) ─────────────────────────────────────────────────────

  /** GDPR status: GET /api/v1/gdpr/status/:recordType/:recordId — not erased by default */
  http.get('/api/v1/gdpr/status/:recordType/:recordId', () => {
    return HttpResponse.json({ status: null });
  }),

  /** GDPR erase contact: POST /api/v1/contacts/:id/gdpr-erase */
  http.post('/api/v1/contacts/:id/gdpr-erase', () => {
    return HttpResponse.json({ success: true, erasedAt: new Date().toISOString() });
  }),

  /** GDPR erase lead: POST /api/v1/leads/:id/gdpr-erase */
  http.post('/api/v1/leads/:id/gdpr-erase', () => {
    return HttpResponse.json({ success: true, erasedAt: new Date().toISOString() });
  }),

  // ── MFA (MINCRM-392) ─────────────────────────────────────────────────────────

  /** MFA: GET /api/auth/mfa/status — MFA disabled by default */
  http.get('/api/v1/auth/mfa/status', () => {
    return HttpResponse.json({ enabled: false, recoveryCodesRemaining: 0 });
  }),

  /** MFA: POST /api/auth/mfa/setup — returns a dummy QR code */
  http.post('/api/v1/auth/mfa/setup', () => {
    return HttpResponse.json({
      otpauthUrl: 'otpauth://totp/MiniCRM:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=MiniCRM',
      qrDataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
  }),

  /** MFA: POST /api/auth/mfa/verify-setup — succeeds with dummy recovery codes */
  http.post('/api/v1/auth/mfa/verify-setup', () => {
    return HttpResponse.json({
      recoveryCodes: [
        'AAAA-1111',
        'BBBB-2222',
        'CCCC-3333',
        'DDDD-4444',
        'EEEE-5555',
        'FFFF-6666',
        'GGGG-7777',
        'HHHH-8888',
      ],
    });
  }),

  /** MFA: POST /api/auth/mfa/disable — succeeds */
  http.post('/api/v1/auth/mfa/disable', () => {
    return HttpResponse.json({ message: 'Two-factor authentication has been disabled.' });
  }),

  /** MFA: POST /api/auth/mfa/verify-login — succeeds */
  http.post('/api/v1/auth/mfa/verify-login', () => {
    return HttpResponse.json({ user: ADMIN_USER, mustChangePassword: false });
  }),

  /** MFA: POST /api/auth/mfa/recovery-login — succeeds */
  http.post('/api/v1/auth/mfa/recovery-login', () => {
    return HttpResponse.json({ user: ADMIN_USER, mustChangePassword: false });
  }),

  /** Settings: GET /api/settings/mfa-required — MFA not required by default (MINCRM-392) */
  http.get('/api/v1/settings/mfa-required', () => {
    return HttpResponse.json({ mfa_required: false });
  }),

  /** Settings: PATCH /api/settings/mfa-required (MINCRM-392) */
  http.patch('/api/v1/settings/mfa-required', async ({ request }) => {
    const body = (await request.json()) as { mfa_required: boolean };
    return HttpResponse.json({ mfa_required: body.mfa_required });
  }),
];
