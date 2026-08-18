/**
 * Demo data service.
 * Provides seed, remove, reset, and status operations for demo-flagged records.
 * All fixture data lives here — the CLI scripts (seed-demo.ts, remove-demo.ts) are
 * thin wrappers that call these functions.
 */

import bcrypt from 'bcryptjs';
import { utcDayOffset } from '../utils/utcDate.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import pool from '../db.js';
import { encrypt } from './cryptoService.js';
import { setRlsUserId } from './rlsContextService.js';
import { syncEntityTagsWithinTransaction } from './tagService.js';
import type pg from 'pg';

/** Number of bcrypt salt rounds — matches userService.ts */
const BCRYPT_SALT_ROUNDS = 12;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEMO_ACCOUNTS = [
  {
    name: 'Acme Corporation',
    industry: 'Technology',
    website: 'https://www.acme-demo.example.com',
    employee_range: '201-500',
    revenue_range: '50M-100M',
    account_type: 'Customer',
  },
  {
    name: 'Globex Industries',
    industry: 'Manufacturing',
    website: 'https://www.globex-demo.example.com',
    employee_range: '51-200',
    revenue_range: '10M-50M',
    account_type: 'Prospect',
    // parent_account_id is set dynamically after Acme is inserted
  },
];

// Contacts span multiple locales to demonstrate i18n/l10n support.
// Acme contacts (indices 0–9): US/EN base with French and Japanese contacts woven in.
// Globex contacts (indices 10–19): US/EN base with German, Korean, and Chinese contacts.
const DEMO_CONTACTS = [
  // ── Acme Corporation contacts (indices 0–9) ───────────────────────────────
  {
    first_name: 'Alice',
    last_name: 'Chen',
    email: 'alice.chen.demo@acme-demo.example.com',
    phone: '+1-555-0101',
    title: 'VP of Sales',
    department: 'Sales',
    linkedin_url: 'https://www.linkedin.com/in/alice-chen-demo',
  },
  {
    first_name: 'Bob',
    last_name: 'Martinez',
    email: 'bob.martinez.demo@acme-demo.example.com',
    phone: '+1-555-0102',
    title: 'Director of Engineering',
    department: 'Engineering',
  },
  {
    first_name: 'Carol',
    last_name: 'Johnson',
    email: 'carol.johnson.demo@acme-demo.example.com',
    phone: '+1-555-0103',
    title: 'CFO',
    department: 'Finance',
  },
  {
    first_name: 'David',
    last_name: 'Kim',
    email: 'david.kim.demo@acme-demo.example.com',
    phone: '+1-555-0104',
    title: 'Procurement Manager',
    department: 'Operations',
  },
  // French contact — Paris office (index 4)
  {
    first_name: 'Hélène',
    last_name: 'Dubois',
    email: 'helene.dubois.demo@acme-demo.example.com',
    phone: '+33 1 42 60 11 22',
    title: 'Directrice Commerciale',
    department: 'Sales',
  },
  // French contact (index 5)
  {
    first_name: 'François',
    last_name: 'Lefebvre',
    email: 'francois.lefebvre.demo@acme-demo.example.com',
    phone: '+33 1 42 60 33 44',
    title: 'Responsable Technique',
    department: 'Engineering',
  },
  // Japanese contact — Tokyo office (index 6)
  {
    first_name: '健司',
    last_name: '渡辺',
    email: 'kenji.watanabe.demo@acme-demo.example.com',
    phone: '+81 3-5678-9012',
    title: 'アカウントマネージャー',
    department: 'Sales',
  },
  // Japanese contact (index 7)
  {
    first_name: '由紀',
    last_name: '田中',
    email: 'yuki.tanaka.demo@acme-demo.example.com',
    phone: '+81 3-5678-3456',
    title: 'プロダクトマネージャー',
    department: 'Product',
  },
  {
    first_name: 'Iris',
    last_name: 'Davis',
    email: 'iris.davis.demo@acme-demo.example.com',
    phone: '+1-555-0109',
    title: 'Marketing VP',
    department: 'Marketing',
  },
  {
    first_name: 'Jack',
    last_name: 'Wilson',
    email: 'jack.wilson.demo@acme-demo.example.com',
    phone: '+1-555-0110',
    title: 'CEO',
    department: 'Executive',
    linkedin_url: 'https://www.linkedin.com/in/jack-wilson-demo',
    twitter_x_url: 'https://twitter.com/jackwilsondemo',
  },
  // ── Globex Industries contacts (indices 10–19) ────────────────────────────
  {
    first_name: 'Karen',
    last_name: 'Taylor',
    email: 'karen.taylor.demo@globex-demo.example.com',
    phone: '+1-555-0201',
    title: 'Head of Procurement',
    department: 'Operations',
  },
  {
    first_name: 'Liam',
    last_name: 'Anderson',
    email: 'liam.anderson.demo@globex-demo.example.com',
    phone: '+1-555-0202',
    title: 'VP Engineering',
    department: 'Engineering',
  },
  {
    first_name: 'Mia',
    last_name: 'Thompson',
    email: 'mia.thompson.demo@globex-demo.example.com',
    phone: '+1-555-0203',
    title: 'Sales Director',
    department: 'Sales',
    linkedin_url: 'https://www.linkedin.com/in/mia-thompson-demo',
  },
  // German contact — Berlin office (index 13)
  {
    first_name: 'Lars',
    last_name: 'Müller',
    email: 'lars.mueller.demo@globex-demo.example.com',
    phone: '+49 30 20191234',
    title: 'Betriebsleiter',
    department: 'Operations',
  },
  // German contact (index 14)
  {
    first_name: 'Ingrid',
    last_name: 'Hoffmann',
    email: 'ingrid.hoffmann.demo@globex-demo.example.com',
    phone: '+49 30 20195678',
    title: 'Leiterin Finanzen',
    department: 'Finance',
  },
  // Korean contact (index 15)
  {
    first_name: '준서',
    last_name: '박',
    email: 'junseo.park.demo@globex-demo.example.com',
    phone: '+82 2-3456-7890',
    title: 'IT 관리자',
    department: 'IT',
  },
  // Chinese contact (index 16)
  {
    first_name: '伟',
    last_name: '张',
    email: 'wei.zhang.demo@globex-demo.example.com',
    phone: '+86 10 6789 1234',
    title: '首席技术官',
    department: 'Technology',
  },
  {
    first_name: 'Rachel',
    last_name: 'White',
    email: 'rachel.white.demo@globex-demo.example.com',
    phone: '+1-555-0208',
    title: 'Director of Marketing',
    department: 'Marketing',
  },
  {
    first_name: 'Sam',
    last_name: 'Harris',
    email: 'sam.harris.demo@globex-demo.example.com',
    phone: '+1-555-0209',
    title: 'Product Director',
    department: 'Product',
  },
  {
    first_name: 'Tina',
    last_name: 'Clark',
    email: 'tina.clark.demo@globex-demo.example.com',
    phone: '+1-555-0210',
    title: 'CEO',
    department: 'Executive',
    linkedin_url: 'https://www.linkedin.com/in/tina-clark-demo',
  },
];

// Contact addresses spanning multiple countries to demonstrate i18n address formatting.
const DEMO_CONTACT_ADDRESSES = [
  {
    contactIndex: 0, // Alice Chen — San Francisco
    label: 'Work',
    address_line1: '100 Technology Drive',
    city: 'San Francisco',
    state_region: 'CA',
    postal_code: '94105',
    country: 'USA',
    is_default: true,
  },
  {
    contactIndex: 4, // Hélène Dubois — Paris
    label: 'Bureau',
    address_line1: '14 Rue de la Paix',
    city: 'Paris',
    state_region: 'Île-de-France',
    postal_code: '75001',
    country: 'France',
    is_default: true,
  },
  {
    contactIndex: 6, // 渡辺 健司 — Tokyo
    label: '勤務先',
    address_line1: '東京都港区六本木1-6-1',
    city: '東京都',
    state_region: '東京',
    postal_code: '106-0032',
    country: '日本',
    is_default: true,
  },
  {
    contactIndex: 10, // Karen Taylor — Chicago
    label: 'Work',
    address_line1: '500 Industrial Way',
    city: 'Chicago',
    state_region: 'IL',
    postal_code: '60601',
    country: 'USA',
    is_default: true,
  },
  {
    contactIndex: 13, // Lars Müller — Berlin
    label: 'Büro',
    address_line1: 'Unter den Linden 42',
    city: 'Berlin',
    state_region: 'Berlin',
    postal_code: '10117',
    country: 'Deutschland',
    is_default: true,
  },
];

/**
 * Returns a YYYY-MM-DD string for a date offset by the given number of days from today.
 * Used to keep demo closed-deal dates within the current month so the Win/Loss report
 * shows data without the user needing to change the date filter.
 *
 * @param offsetDays - Positive = future, negative = past.
 */
function relativeDate(offsetDays: number): string {
  return utcDayOffset(new Date(), offsetDays);
}

/**
 * Returns a fixed YYYY-MM-DD string for a date a given number of months in the future.
 * Used for open-deal close dates so the pipeline board looks realistic.
 *
 * @param monthsAhead - Number of months ahead of today.
 */
function futureMonths(monthsAhead: number): string {
  const now = new Date();
  // Same UTC day, `monthsAhead` months on. Date.UTC normalizes an overflowing
  // day-of-month (Jan 31 + 1 month) into early the following month, matching
  // what setMonth did.
  const shifted = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, now.getUTCDate()),
  );
  return shifted.toISOString().slice(0, 10);
}

// pipeline: 'enterprise' deals are assigned to the Enterprise B2B demo pipeline.
// All others go to the default pipeline (pipeline_id: null resolved to default at insert time).
// Indices 0–9 preserve the original ordering so DEMO_ACTIVITIES dealIndex values stay valid.
// Indices 10–16 are new Enterprise B2B deals covering every stage of that pipeline.
const DEMO_DEALS = [
  // ── Default pipeline (indices 0–9) ───────────────────────────────────────
  {
    name: 'Acme — Enterprise Platform', // index 0
    stage: 'Qualification',
    value: 120000,
    close_date: futureMonths(3),
  },
  {
    name: 'Acme — Security Upgrade', // index 1
    stage: 'Proposal',
    value: 45000,
    close_date: futureMonths(2),
  },
  {
    name: 'Acme — Analytics Add-on', // index 2
    stage: 'Negotiation',
    value: 28000,
    close_date: futureMonths(1),
    // Rep is more confident than the stage default (75%)
    probability: 85,
  },
  {
    name: 'Acme — Training Package', // index 3
    stage: 'Prospecting',
    value: 15000,
    close_date: futureMonths(4),
  },
  {
    name: 'Acme — Support Contract', // index 4
    stage: 'Closed Won',
    value: 36000,
    close_date: relativeDate(-5),
    loss_reason: null,
  },
  {
    name: 'Globex — ERP Migration', // index 5
    stage: 'Proposal',
    value: 200000,
    close_date: futureMonths(4),
    // Rep is less confident than the stage default (50%)
    probability: 40,
    currency: 'GBP',
  },
  {
    name: 'Globex — Cloud Infrastructure', // index 6
    stage: 'Qualification',
    value: 85000,
    close_date: futureMonths(3),
  },
  {
    name: 'Globex — Data Warehouse', // index 7
    stage: 'Prospecting',
    value: 60000,
    close_date: futureMonths(5),
  },
  {
    name: 'Globex — Mobile App', // index 8
    stage: 'Closed Lost',
    value: 40000,
    close_date: relativeDate(-2),
    loss_reason: 'Lost to competitor',
  },
  {
    name: 'Globex — IoT Integration', // index 9
    stage: 'Negotiation',
    value: 95000,
    close_date: futureMonths(2),
    currency: 'EUR',
  },
  // ── Enterprise B2B pipeline (indices 10–16) ───────────────────────────────
  // One deal per stage so the pipeline board is fully populated.
  {
    name: 'Acme — Platform Discovery', // index 10
    stage: 'Discovery',
    value: 180000,
    close_date: futureMonths(6),
    pipeline: 'enterprise' as const,
  },
  {
    name: 'Globex — Infrastructure Scoping', // index 11
    stage: 'Technical Scoping',
    value: 130000,
    close_date: futureMonths(5),
    pipeline: 'enterprise' as const,
  },
  {
    name: 'Acme — Security Upgrade (Enterprise)', // index 12
    stage: 'Technical Validation',
    value: 45000,
    close_date: futureMonths(2),
    pipeline: 'enterprise' as const,
  },
  {
    name: 'Acme — Global Rollout', // index 13
    stage: 'Proposal',
    value: 320000,
    close_date: futureMonths(3),
    currency: 'GBP',
    pipeline: 'enterprise' as const,
  },
  {
    name: 'Globex — IoT Integration (Enterprise)', // index 14
    stage: 'Contract Review',
    value: 95000,
    close_date: futureMonths(2),
    currency: 'EUR',
    pipeline: 'enterprise' as const,
  },
  {
    name: 'Globex — Manufacturing Suite', // index 15
    stage: 'Closed Won',
    value: 250000,
    close_date: relativeDate(-10),
    loss_reason: null,
    pipeline: 'enterprise' as const,
  },
  {
    name: 'Acme — Legacy Migration', // index 16
    stage: 'Closed Lost',
    value: 90000,
    close_date: relativeDate(-4),
    loss_reason: 'Timeline too long',
    pipeline: 'enterprise' as const,
  },
];

const DEMO_ACTIVITIES: Array<{
  type: string;
  subject: string;
  notes: string | null;
  due_date: string;
  status: string;
  direction: string | null;
  dealIndex: number;
  contactIndex: number;
}> = [
  {
    type: 'Call',
    subject: 'Discovery call — Acme Enterprise',
    notes: 'Discussed pain points with legacy system.',
    due_date: '2026-04-10',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 0,
    contactIndex: 0,
  },
  {
    type: 'Email',
    subject: 'Follow-up after discovery',
    notes: null,
    due_date: '2026-04-12',
    status: 'open',
    direction: 'Outbound',
    dealIndex: 0,
    contactIndex: 1,
  },
  {
    type: 'Meeting',
    subject: 'Proposal review — Acme Security',
    notes: 'Walked through 3-year roadmap.',
    due_date: '2026-04-15',
    status: 'complete',
    direction: null,
    dealIndex: 1,
    contactIndex: 2,
  },
  {
    type: 'Task',
    subject: 'Send revised proposal — Acme Analytics',
    notes: null,
    due_date: '2026-04-20',
    status: 'open',
    direction: null,
    dealIndex: 2,
    contactIndex: 3,
  },
  {
    type: 'Note',
    subject: 'Budget confirmed for training package',
    notes: 'Alice confirmed Q3 budget allocation.',
    due_date: '2026-04-08',
    status: 'complete',
    direction: null,
    dealIndex: 3,
    contactIndex: 4,
  },
  {
    type: 'Call',
    subject: 'Contract kickoff — Acme Support',
    notes: 'Contract signed. Onboarding scheduled.',
    due_date: '2026-03-05',
    status: 'complete',
    direction: 'Inbound',
    dealIndex: 4,
    contactIndex: 5,
  },
  {
    type: 'Email',
    subject: 'ERP migration requirements checklist',
    notes: null,
    due_date: '2026-04-25',
    status: 'open',
    direction: 'Outbound',
    dealIndex: 5,
    contactIndex: 10,
  },
  {
    type: 'Meeting',
    subject: 'Technical deep-dive — Globex Cloud',
    notes: 'Covered architecture and integration points.',
    due_date: '2026-04-18',
    status: 'complete',
    direction: null,
    dealIndex: 6,
    contactIndex: 11,
  },
  {
    type: 'Task',
    subject: 'Prepare data warehouse demo environment',
    notes: null,
    due_date: '2026-05-01',
    status: 'open',
    direction: null,
    dealIndex: 7,
    contactIndex: 12,
  },
  {
    type: 'Call',
    subject: 'Post-mortem — Globex Mobile App loss',
    notes: 'Lost on price. Competitor undercut by 20%.',
    due_date: '2026-03-02',
    status: 'complete',
    direction: 'Inbound',
    dealIndex: 8,
    contactIndex: 13,
  },
  {
    type: 'Email',
    subject: 'Negotiation terms — Globex IoT',
    notes: null,
    due_date: '2026-04-22',
    status: 'open',
    direction: 'Outbound',
    dealIndex: 9,
    contactIndex: 14,
  },
  {
    type: 'Task',
    subject: 'Send NDA for signature — Globex ERP',
    notes: null,
    due_date: '2026-04-28',
    status: 'open',
    direction: null,
    dealIndex: 5,
    contactIndex: 13,
  },
  {
    type: 'Note',
    subject: 'IoT deal — exec sponsor confirmed',
    notes: 'Noah Garcia is the exec sponsor. Decision by end of May.',
    due_date: '2026-04-09',
    status: 'complete',
    direction: null,
    dealIndex: 9,
    contactIndex: 13,
  },
  {
    type: 'Call',
    subject: 'Qualification call — Acme Enterprise',
    notes: 'Good fit confirmed. Moving to proposal stage.',
    due_date: '2026-04-05',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 0,
    contactIndex: 9,
  },
  {
    type: 'Meeting',
    subject: 'Stakeholder alignment — Globex Cloud',
    notes: null,
    due_date: '2026-04-30',
    status: 'open',
    direction: null,
    dealIndex: 6,
    contactIndex: 16,
  },
];

// Demo leads showcasing the full status lifecycle, source variety, and international names
const DEMO_LEADS = [
  {
    first_name: 'Tyler',
    last_name: 'Brooks',
    email: 'tyler.brooks.demo@pinnacle-demo.example.com',
    company_name: 'Pinnacle Systems',
    lead_source: 'Web',
    status: 'New',
  },
  {
    // French lead — European conference inbound
    first_name: 'Marie-Claire',
    last_name: 'Rousseau',
    email: 'marie-claire.rousseau.demo@meridian-demo.example.com',
    company_name: 'Méridian Consulting',
    lead_source: 'Trade Show',
    status: 'Contacted',
  },
  {
    // Swedish lead — Nordic cold outreach
    first_name: 'Björn',
    last_name: 'Lindqvist',
    email: 'bjorn.lindqvist.demo@vertex-demo.example.com',
    company_name: 'Vertex Solutions AB',
    lead_source: 'Cold Outreach',
    status: 'Qualified',
  },
  {
    first_name: 'Priya',
    last_name: 'Nair',
    email: 'priya.nair.demo@harbor-demo.example.com',
    company_name: 'Harbor Logistics',
    lead_source: 'Cold Outreach',
    status: 'Disqualified',
    disqualification_reason: 'Not the right fit — too small',
  },
  {
    // Left as Qualified so a demo user can exercise the conversion flow
    first_name: 'Marcus',
    last_name: 'Chen',
    email: 'marcus.chen.demo@apex-demo.example.com',
    company_name: 'Apex Technologies',
    lead_source: 'Web',
    status: 'Qualified',
  },
];

// Tags and their associations across entity types
// contactIndex/accountIndex/dealIndex reference their respective fixture arrays.
const DEMO_TAGS = [
  {
    name: 'vip',
    contactIndices: [0, 9], // Alice Chen, Jack Wilson
    accountIndices: [0], // Acme Corporation
    dealIndices: [],
  },
  {
    name: 'conference-2026',
    contactIndices: [0, 12], // Alice Chen, Mia Thompson
    accountIndices: [],
    dealIndices: [],
  },
  {
    name: 'decision-maker',
    contactIndices: [9, 19, 13], // Jack Wilson, Tina Clark, Noah Garcia
    accountIndices: [],
    dealIndices: [],
  },
  {
    name: 'needs-renewal',
    contactIndices: [],
    accountIndices: [],
    dealIndices: [4], // Acme — Support Contract
  },
  {
    name: 'at-risk',
    contactIndices: [],
    accountIndices: [],
    dealIndices: [5], // Globex — ERP Migration
  },
  {
    name: 'enterprise',
    contactIndices: [],
    accountIndices: [0], // Acme Corporation
    dealIndices: [],
  },
  {
    name: 'key-account',
    contactIndices: [],
    accountIndices: [0, 1], // Acme Corporation, Globex Industries
    dealIndices: [],
  },
];

// Demo automation rules showcasing trigger/action variety
// Note: trigger_config.stage for deal_stage_changed must match the PIPELINE_STAGES bootstrap
// constant (not the live DB table) because dealStageChangedConfigSchema validates against the
// static enum at rule evaluation time.
const DEMO_AUTOMATION_RULES = [
  {
    name: 'Follow up after Closed Won',
    enabled: true,
    trigger_type: 'deal_stage_changed',
    trigger_config: { stage: 'Closed Won' },
    action_type: 'create_task',
    action_config: {
      subject: 'Send onboarding welcome email',
      task_type: 'Email',
      assignee_type: 'owner',
      due_date_offset_days: 1,
    },
  },
  {
    name: 'New deal intake checklist',
    enabled: true,
    trigger_type: 'deal_created',
    trigger_config: {},
    action_type: 'create_task',
    action_config: {
      subject: 'Schedule discovery call',
      task_type: 'Call',
      assignee_type: 'owner',
      due_date_offset_days: 2,
    },
  },
  {
    name: 'New contact notification',
    enabled: true,
    trigger_type: 'contact_created',
    trigger_config: {},
    action_type: 'send_notification',
    action_config: {
      message: 'A new contact has been added — review and assign.',
    },
  },
] as const;

// ── Rep user fixtures ────────────────────────────────────────────

const DEMO_REP = {
  name: 'Alex Rivera',
  email: 'alex.rivera@demo.minicrm.app',
  password: 'Demo1234!',
  role: 'rep' as const,
};

// ── Extended demo users ─────────────────────────────────────────
// All use @demo.minicrm.dev domain to distinguish from the original .app domain.

/** Password shared by all demo users */
const DEMO_IAM_PASSWORD = 'Demo1234!';

const DEMO_IAM_USERS = [
  { email: 'admin@demo.minicrm.dev', name: 'Amara Okonkwo', role: 'admin' as const },
  { email: 'manager.west@demo.minicrm.dev', name: 'Sofia Reyes', role: 'manager' as const },
  { email: 'manager.east@demo.minicrm.dev', name: 'Kenji Tanaka', role: 'manager' as const },
  { email: 'rep1@demo.minicrm.dev', name: 'Priya Sharma', role: 'rep' as const },
  { email: 'rep2@demo.minicrm.dev', name: 'Marcus Chen', role: 'rep' as const },
  { email: 'rep3@demo.minicrm.dev', name: 'Fatima Al-Rashid', role: 'rep' as const },
  { email: 'viewer@demo.minicrm.dev', name: 'Lars Müller', role: 'viewer' as const },
  {
    email: 'svc-demo@demo.minicrm.dev',
    name: 'Demo Integration',
    role: 'service_account' as const,
  },
] as const;

/** Bytes of entropy for the service-account API token (matches userService) */
const DEMO_API_TOKEN_BYTES = 32;

/** Custom role seeded by the demo data */
const DEMO_SENIOR_REP_ROLE_NAME = 'Senior Rep';

/** Capabilities granted to the "Senior Rep" custom role (additive on top of built-in rep) */
const DEMO_SENIOR_REP_CAPABILITIES = [
  'reports:create',
  'reports:edit',
  'reports:export',
  'data:export',
] as const;

// Rep accounts include international companies to demonstrate cross-locale data.
const DEMO_REP_ACCOUNTS = [
  {
    // Japanese technology company — demonstrates CJK account names and ¥ currency context
    name: 'シナプス・テクノロジーズ株式会社',
    industry: 'Technology',
    website: 'https://www.synapse-tech-demo.example.com',
    employee_range: '51-200',
    revenue_range: '10M-50M',
    account_type: 'Prospect',
  },
  {
    name: 'Ironbridge Manufacturing',
    industry: 'Manufacturing',
    website: 'https://www.ironbridge-demo.example.com',
    employee_range: '201-500',
    revenue_range: '50M-100M',
    account_type: 'Customer',
  },
  {
    // German consulting firm — demonstrates German-language account names and € currency context
    name: 'Müller & Partner GmbH',
    industry: 'Professional Services',
    website: 'https://www.mueller-partner-demo.example.com',
    employee_range: '11-50',
    revenue_range: '1M-10M',
    account_type: 'Prospect',
  },
];

// Rep contacts span Japanese, English, and German locales.
const DEMO_REP_CONTACTS = [
  // ── シナプス・テクノロジーズ株式会社 contacts (indices 0–2) ────────────────
  {
    first_name: '咲良',
    last_name: '林',
    email: 'sakura.hayashi.demo@synapse-tech-demo.example.com',
    phone: '+81 3-6789-0123',
    title: 'エンジニアリング VP',
    department: 'Engineering',
    linkedin_url: 'https://www.linkedin.com/in/sakura-hayashi-demo',
  },
  {
    first_name: '寛',
    last_name: '中村',
    email: 'hiroshi.nakamura.demo@synapse-tech-demo.example.com',
    phone: '+81 3-6789-4567',
    title: '最高技術責任者',
    department: 'Technology',
  },
  {
    first_name: '美咲',
    last_name: '小林',
    email: 'misaki.kobayashi.demo@synapse-tech-demo.example.com',
    phone: '+81 3-6789-8901',
    title: '営業本部長',
    department: 'Sales',
  },
  // ── Ironbridge Manufacturing contacts (indices 3–6) ───────────────────────
  {
    first_name: 'Raymond',
    last_name: 'Osei',
    email: 'raymond.osei.demo@ironbridge-demo.example.com',
    phone: '+1-555-0401',
    title: 'CEO',
    department: 'Executive',
    linkedin_url: 'https://www.linkedin.com/in/raymond-osei-demo',
  },
  {
    first_name: 'Sophia',
    last_name: 'Laurent',
    email: 'sophia.laurent.demo@ironbridge-demo.example.com',
    phone: '+1-555-0402',
    title: 'CFO',
    department: 'Finance',
  },
  {
    first_name: 'Thomas',
    last_name: 'Ibe',
    email: 'thomas.ibe.demo@ironbridge-demo.example.com',
    phone: '+1-555-0403',
    title: 'Procurement Director',
    department: 'Operations',
  },
  {
    first_name: 'Uma',
    last_name: 'Krishnan',
    email: 'uma.krishnan.demo@ironbridge-demo.example.com',
    phone: '+1-555-0404',
    title: 'IT Manager',
    department: 'IT',
  },
  // ── Müller & Partner GmbH contact (index 7) ──────────────────────────────
  {
    first_name: 'Klaus',
    last_name: 'Brenner',
    email: 'klaus.brenner.demo@mueller-partner-demo.example.com',
    phone: '+49 89 54321678',
    title: 'Geschäftsführer',
    department: 'Executive',
    linkedin_url: 'https://www.linkedin.com/in/klaus-brenner-demo',
  },
];

// Rep-owned deals. pipeline: 'enterprise' routes to the Enterprise B2B pipeline.
const DEMO_REP_DEALS = [
  // ── Default pipeline ──────────────────────────────────────────────────────
  {
    name: 'シナプス — クラウド移行',
    stage: 'Prospecting',
    value: 8500000, // ¥8.5M — demonstrates JPY formatting
    currency: 'JPY' as const,
    close_date: futureMonths(5),
  },
  {
    name: 'Ironbridge — ERP Upgrade',
    stage: 'Closed Won',
    value: 110000,
    close_date: relativeDate(-3),
    loss_reason: null,
  },
  {
    name: 'Ironbridge — Compliance Audit',
    stage: 'Closed Lost',
    value: 38000,
    close_date: relativeDate(-7),
    loss_reason: 'Budget cut — project deferred to next fiscal year',
  },
  {
    name: 'Müller & Partner — CRM-Einführung',
    stage: 'Qualification',
    value: 22000,
    currency: 'EUR' as const,
    close_date: futureMonths(3),
  },
  // ── Enterprise B2B pipeline ───────────────────────────────────────────────
  {
    name: 'シナプス — DevOps プラットフォーム',
    stage: 'Technical Validation',
    value: 6200000, // ¥6.2M
    currency: 'JPY' as const,
    close_date: futureMonths(2),
    pipeline: 'enterprise' as const,
  },
];

const DEMO_REP_ACTIVITIES: Array<{
  type: string;
  subject: string;
  notes: string | null;
  due_date: string;
  status: string;
  direction: string | null;
  dealIndex: number;
  contactIndex: number;
}> = [
  {
    type: 'Call',
    subject: 'Intro call — シナプス cloud migration',
    notes: 'Good initial conversation. Budget confirmed for H2.',
    due_date: '2026-04-08',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 0,
    contactIndex: 0,
  },
  {
    type: 'Email',
    subject: 'DevOps platform proposal — シナプス',
    notes: null,
    due_date: '2026-04-17',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 1,
    contactIndex: 1,
  },
  {
    type: 'Meeting',
    subject: 'ERP upgrade kickoff — Ironbridge',
    notes: 'Contract signed. Implementation starts next month.',
    due_date: '2026-04-14',
    status: 'complete',
    direction: null,
    dealIndex: 2,
    contactIndex: 3,
  },
  {
    type: 'Call',
    subject: 'Post-mortem — Ironbridge Compliance loss',
    notes: 'Budget deferred. Revisit in Q1 next year.',
    due_date: '2026-04-21',
    status: 'complete',
    direction: 'Inbound',
    dealIndex: 3,
    contactIndex: 4,
  },
  {
    type: 'Task',
    subject: 'Send Müller & Partner CRM overview deck',
    notes: null,
    // Overdue task — past due date
    due_date: relativeDate(-4),
    status: 'open',
    direction: null,
    dealIndex: 4,
    contactIndex: 7,
  },
  {
    type: 'Task',
    subject: 'Schedule technical review — シナプス DevOps',
    notes: null,
    // Overdue task — past due date
    due_date: relativeDate(-2),
    status: 'open',
    direction: null,
    dealIndex: 1,
    contactIndex: 2,
  },
  {
    type: 'Meeting',
    subject: 'Quarterly business review — Ironbridge',
    notes: null,
    // Future task
    due_date: futureMonths(1),
    status: 'open',
    direction: null,
    dealIndex: 2,
    contactIndex: 5,
  },
];

// Rep leads include international names to reinforce i18n.
const DEMO_REP_LEADS = [
  {
    // French lead — inbound web inquiry
    first_name: 'Amélie',
    last_name: 'Fontaine',
    email: 'amelie.fontaine.demo@lumina-demo.example.com',
    company_name: 'Lumina Numérique',
    lead_source: 'Web',
    status: 'New',
  },
  {
    // Chinese lead — referral from existing customer
    first_name: '伟',
    last_name: '陈',
    email: 'wei.chen.demo@redrock-demo.example.com',
    company_name: '红岩工业有限公司',
    lead_source: 'Referral',
    status: 'Contacted',
  },
];

/**
 * Helper to build a Tiptap doc JSON string for a single plain-text paragraph.
 * The `body` column in the notes table stores serialised Tiptap JSON.
 */
function tiptapText(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

// Notes for admin-owned entities
// contactIndex references DEMO_CONTACTS; dealIndex references DEMO_DEALS; accountIndex references DEMO_ACCOUNTS.
const DEMO_NOTES: Array<{
  entityType: 'contact' | 'account' | 'deal';
  entityIndex: number;
  ownerType: 'admin' | 'rep';
  title: string | null;
  bodyText: string;
  visibility: 'team' | 'private';
  tags: string[];
}> = [
  // Admin-owned contact notes
  {
    entityType: 'contact',
    entityIndex: 0, // Alice Chen
    ownerType: 'admin',
    title: 'Initial discovery call summary',
    bodyText:
      'Alice confirmed the legacy system is causing significant friction for the sales team. Key pain points: no mobile access, slow reporting, and no API for integrations. She is the main champion — next step is a joint call with her CTO.',
    visibility: 'team',
    tags: [],
  },
  {
    entityType: 'contact',
    entityIndex: 9, // Jack Wilson (CEO)
    ownerType: 'admin',
    title: null,
    bodyText:
      'Jack seems lukewarm on the deal despite the positive signals from Alice. My read is he has a preferred vendor relationship with a competitor and is using us as leverage. Worth having a candid conversation before investing more time.',
    visibility: 'private',
    tags: [],
  },
  {
    entityType: 'contact',
    entityIndex: 2, // Carol Johnson (CFO)
    ownerType: 'admin',
    title: 'Budget discussion',
    bodyText:
      'Carol confirmed the finance team has allocated budget in Q3 for a CRM modernisation project. Total envelope is approximately $150k. She wants a phased proposal with payment milestones.',
    visibility: 'team',
    tags: [],
  },
  // Admin-owned deal notes
  {
    entityType: 'deal',
    entityIndex: 1, // Acme — Security Upgrade
    ownerType: 'admin',
    title: 'Proposal walkthrough notes',
    bodyText:
      'Walked Carol and Bob through the 3-year security roadmap. Carol raised concerns about the implementation timeline clashing with their fiscal year-end in September. Agreed to shift Phase 2 start to October. Bob is comfortable with the technical approach.',
    visibility: 'team',
    tags: [],
  },
  {
    entityType: 'deal',
    entityIndex: 5, // Globex — ERP Migration
    ownerType: 'admin',
    title: 'Risk note — procurement delay',
    bodyText:
      'Karen mentioned that the internal procurement process requires sign-off from three VPs and typically takes 6–8 weeks. We need to factor that into the timeline. Flag this to leadership as a deal risk.',
    visibility: 'team',
    tags: ['at-risk'],
  },
  // Account note
  {
    entityType: 'account',
    entityIndex: 0, // Acme Corporation
    ownerType: 'admin',
    title: 'Account strategy — FY2026',
    bodyText:
      'Acme is our largest active prospect. We have three active deals in play. Priority is to close the Support Contract renewal before Q2 ends, then convert the Analytics Add-on to a closed deal before the Enterprise Platform enters legal review.',
    visibility: 'team',
    tags: ['key-account'],
  },
  // Rep-owned contact notes
  {
    entityType: 'contact',
    entityIndex: 0, // Natalie Russo — rep contacts (resolved via repContactIds)
    ownerType: 'rep',
    title: 'First call notes',
    bodyText:
      'Great first conversation with Natalie. She is frustrated with their current CI/CD pipeline and keen to evaluate alternatives. Budget is not confirmed yet but she expects H2 approval. Sending a technical overview deck this week.',
    visibility: 'team',
    tags: [],
  },
  {
    entityType: 'contact',
    entityIndex: 3, // Raymond Osei (CEO, Ironbridge) — rep contacts
    ownerType: 'rep',
    title: null,
    bodyText:
      'Raymond signed off on the ERP upgrade contract. Implementation kick-off is scheduled for next month. Keep an eye on scope creep — he mentioned wanting reporting customisations that are outside the current SOW.',
    visibility: 'team',
    tags: [],
  },
];

// Custom field definitions
const DEMO_CUSTOM_FIELD_DEFINITIONS: Array<{
  entity_type: 'contact' | 'deal';
  name: string;
  field_type: 'text' | 'select' | 'date' | 'number';
  options: string[] | null;
  sort_order: number;
}> = [
  {
    entity_type: 'contact',
    name: 'LinkedIn URL',
    field_type: 'text',
    options: null,
    sort_order: 1,
  },
  {
    entity_type: 'contact',
    name: 'Lead Source Detail',
    field_type: 'select',
    options: ['Cold outreach', 'Referral', 'Event', 'Inbound'],
    sort_order: 2,
  },
  {
    entity_type: 'deal',
    name: 'Contract Signed Date',
    field_type: 'date',
    options: null,
    sort_order: 1,
  },
  {
    entity_type: 'deal',
    name: 'Estimated ARR',
    field_type: 'number',
    options: null,
    sort_order: 2,
  },
];

// Custom field values — keyed by definition name, then by entity index within the owner's set.
// contactIndices reference DEMO_CONTACTS (admin) or repContactIndices (rep).
// dealIndices reference DEMO_DEALS (admin) or repDealIndices (rep).
const DEMO_CUSTOM_FIELD_VALUES: Array<{
  definitionName: string;
  ownerType: 'admin' | 'rep';
  entityType: 'contact' | 'deal';
  entityIndex: number;
  value: string;
}> = [
  // LinkedIn URL — admin contacts
  {
    definitionName: 'LinkedIn URL',
    ownerType: 'admin',
    entityType: 'contact',
    entityIndex: 0, // Alice Chen
    value: 'https://www.linkedin.com/in/alice-chen-demo',
  },
  {
    definitionName: 'LinkedIn URL',
    ownerType: 'admin',
    entityType: 'contact',
    entityIndex: 9, // Jack Wilson
    value: 'https://www.linkedin.com/in/jack-wilson-demo',
  },
  {
    definitionName: 'LinkedIn URL',
    ownerType: 'rep',
    entityType: 'contact',
    entityIndex: 0, // Natalie Russo
    value: 'https://www.linkedin.com/in/natalie-russo-demo',
  },
  // Lead Source Detail — admin contacts
  {
    definitionName: 'Lead Source Detail',
    ownerType: 'admin',
    entityType: 'contact',
    entityIndex: 0, // Alice Chen
    value: 'Event',
  },
  {
    definitionName: 'Lead Source Detail',
    ownerType: 'admin',
    entityType: 'contact',
    entityIndex: 12, // Mia Thompson (Globex)
    value: 'Referral',
  },
  {
    definitionName: 'Lead Source Detail',
    ownerType: 'rep',
    entityType: 'contact',
    entityIndex: 3, // Raymond Osei
    value: 'Cold outreach',
  },
  // Contract Signed Date — admin closed-won deal
  {
    definitionName: 'Contract Signed Date',
    ownerType: 'admin',
    entityType: 'deal',
    entityIndex: 4, // Acme — Support Contract (Closed Won)
    value: relativeDate(-5),
  },
  {
    definitionName: 'Contract Signed Date',
    ownerType: 'rep',
    entityType: 'deal',
    entityIndex: 2, // Ironbridge — ERP Upgrade (Closed Won)
    value: relativeDate(-3),
  },
  // Estimated ARR — open deals
  {
    definitionName: 'Estimated ARR',
    ownerType: 'admin',
    entityType: 'deal',
    entityIndex: 0, // Acme — Enterprise Platform
    value: '120000',
  },
  {
    definitionName: 'Estimated ARR',
    ownerType: 'admin',
    entityType: 'deal',
    entityIndex: 5, // Globex — ERP Migration
    value: '200000',
  },
  {
    definitionName: 'Estimated ARR',
    ownerType: 'rep',
    entityType: 'deal',
    entityIndex: 0, // Stellartech — Cloud Migration
    value: '75000',
  },
];

// Webhook subscriptions
const DEMO_WEBHOOK_SUBSCRIPTIONS: Array<{
  url: string;
  events: string[];
  dummySecret: string;
}> = [
  {
    url: 'https://hooks.example.com/slack/minicrm-deals',
    events: ['deal.won', 'deal.lost'],
    dummySecret: 'demo-slack-webhook-secret-placeholder',
  },
  {
    url: 'https://hooks.zapier.com/example/minicrm',
    events: ['contact.created', 'contact.updated'],
    dummySecret: 'demo-zapier-webhook-secret-placeholder',
  },
];

// Demo webhook URLs — used for teardown matching
const DEMO_WEBHOOK_URLS = DEMO_WEBHOOK_SUBSCRIPTIONS.map((s) => s.url);

// Currency exchange rates
const DEMO_CURRENCIES: Array<{
  code: string;
  name: string;
  symbol: string;
  rate_to_home: number;
}> = [
  { code: 'GBP', name: 'British Pound Sterling', symbol: '£', rate_to_home: 1.27 },
  { code: 'EUR', name: 'Euro', symbol: '€', rate_to_home: 1.09 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', rate_to_home: 0.73 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', rate_to_home: 0.0067 },
];

const DEMO_CURRENCY_CODES = DEMO_CURRENCIES.map((c) => c.code);

// Names used for teardown — extracted so removeDemoData doesn't depend on the definitions array shape
const DEMO_CUSTOM_FIELD_DEFINITION_NAMES = DEMO_CUSTOM_FIELD_DEFINITIONS.map((d) => d.name);

// Demo sales sequence — showcases a 3-step new-customer cadence
const DEMO_SEQUENCE_STEPS = [
  {
    sort_order: 1,
    action_type: 'send_email',
    action_config: {
      subject: 'Welcome to MiniCRM!',
      body: 'Hi {{contact_name}}, welcome aboard. Let us know if you have any questions.',
    },
    delay_days: 0,
  },
  {
    sort_order: 2,
    action_type: 'log_call_reminder',
    action_config: {
      subject: 'Check-in call',
      notes: 'Ask how onboarding is going and address any blockers.',
    },
    delay_days: 3,
  },
  {
    sort_order: 3,
    action_type: 'create_task',
    action_config: {
      subject: 'Send product tour invitation',
      notes: 'Link to in-app tour or schedule a live walkthrough.',
    },
    delay_days: 7,
  },
];

// Demo saved reports — showcase common report patterns and visibility settings
const DEMO_CUSTOM_REPORTS: Array<{
  name: string;
  entity_type: string;
  visibility: string;
  config: object;
}> = [
  {
    name: 'Open Deals by Stage',
    entity_type: 'deal',
    visibility: 'public',
    config: {
      selected_fields: ['stage'],
      filters: [
        { field: 'stage', operator: 'neq', value: 'Closed Won' },
        { field: 'stage', operator: 'neq', value: 'Closed Lost' },
      ],
      group_by: 'stage',
      sort_field: '_sum',
      sort_direction: 'desc',
      aggregate: { type: 'sum', field: 'value' },
    },
  },
  {
    name: 'Contacts by Account',
    entity_type: 'contact',
    visibility: 'public_read_only',
    config: {
      selected_fields: ['id', 'first_name', 'last_name', 'email', 'title', 'account_id'],
      filters: [],
      sort_field: 'last_name',
      sort_direction: 'asc',
    },
  },
  {
    name: 'New Leads This Quarter',
    entity_type: 'lead',
    visibility: 'private',
    config: {
      selected_fields: [
        'id',
        'first_name',
        'last_name',
        'company_name',
        'status',
        'lead_source',
        'created_at',
      ],
      filters: [{ field: 'status', operator: 'neq', value: 'Disqualified' }],
      sort_field: 'created_at',
      sort_direction: 'desc',
    },
  },
];

const DEMO_CUSTOM_REPORT_NAMES = DEMO_CUSTOM_REPORTS.map((r) => r.name);

// Demo pipeline added by seed to demonstrate multi-pipeline support.
// This is a second, non-default pipeline so evaluators can see that pipelines are
// configurable beyond the built-in "Default" one.
const DEMO_PIPELINE_NAME = 'Enterprise B2B';

// Stages for the Enterprise B2B pipeline.  A complete set including terminal
// stages is required because deals.stage must resolve to a stage in the deal's
// own pipeline.
const DEMO_PIPELINE_STAGES = [
  { name: 'Discovery', sort_order: 10, probability: 15, is_terminal: false, is_fixed: false },
  {
    name: 'Technical Scoping',
    sort_order: 20,
    probability: 35,
    is_terminal: false,
    is_fixed: false,
  },
  {
    name: 'Technical Validation',
    sort_order: 30,
    probability: 60,
    is_terminal: false,
    is_fixed: false,
  },
  { name: 'Proposal', sort_order: 40, probability: 50, is_terminal: false, is_fixed: false },
  { name: 'Contract Review', sort_order: 50, probability: 85, is_terminal: false, is_fixed: false },
  { name: 'Closed Won', sort_order: 60, probability: 100, is_terminal: true, is_fixed: false },
  { name: 'Closed Lost', sort_order: 70, probability: 0, is_terminal: true, is_fixed: false },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if any demo records exist in the accounts table.
 *
 * @param client - Active DB client.
 */
async function hasDemoData(client: pg.PoolClient): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM accounts WHERE is_demo = true) AS exists`,
  );
  return result.rows[0].exists;
}

/**
 * Returns the UUID of the first active admin user.
 * Throws if no active admin exists.
 *
 * @param client - Active DB client.
 */
async function getAdminUserId(client: pg.PoolClient): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1`,
  );
  if (!result.rows[0]) {
    throw new Error('No active admin user found — cannot seed demo data.');
  }
  return result.rows[0].id;
}

// ── Public service functions ───────────────────────────────────────────────────

/**
 * Returns whether demo data is currently present in the database.
 */
export async function getDemoStatus(): Promise<{ active: boolean }> {
  const client = await pool.connect();
  try {
    const active = await hasDemoData(client);
    return { active };
  } finally {
    client.release();
  }
}

/**
 * Removes all demo-flagged records from the database inside a single transaction.
 * Deletion order respects FK constraints.
 *
 * @param client - Active DB client (must already be inside a transaction).
 */
async function removeDemoData(client: pg.PoolClient): Promise<void> {
  // Notes have no is_demo flag — identify by parent entity
  await client.query(`
    DELETE FROM notes
    WHERE entity_id IN (
      SELECT id FROM contacts WHERE is_demo = true
      UNION SELECT id FROM accounts WHERE is_demo = true
      UNION SELECT id FROM deals WHERE is_demo = true
      UNION SELECT id FROM leads WHERE is_demo = true
    )
  `);

  // Custom field values reference demo contacts and deals
  await client.query(`
    DELETE FROM custom_field_values
    WHERE record_id IN (
      SELECT id FROM contacts WHERE is_demo = true
      UNION SELECT id FROM deals WHERE is_demo = true
    )
  `);
  // Deleting definitions by name also cascade-deletes their values via ON DELETE CASCADE,
  // but we delete values first to be explicit about ordering.
  await client.query(`DELETE FROM custom_field_definitions WHERE name = ANY($1::text[])`, [
    DEMO_CUSTOM_FIELD_DEFINITION_NAMES,
  ]);

  // Sales sequences
  await client.query(`DELETE FROM sales_sequences WHERE is_demo = true`);

  // Custom reports identified by name (no is_demo flag)
  await client.query(`DELETE FROM custom_reports WHERE name = ANY($1::text[])`, [
    DEMO_CUSTOM_REPORT_NAMES,
  ]);

  // Webhook subscriptions identified by URL (no is_demo flag)
  await client.query(`DELETE FROM webhook_subscriptions WHERE url = ANY($1::text[])`, [
    DEMO_WEBHOOK_URLS,
  ]);

  // Currency rates — only remove the non-home demo rows
  await client.query(`DELETE FROM currencies WHERE code = ANY($1::text[]) AND is_home = false`, [
    DEMO_CURRENCY_CODES,
  ]);

  // lead_status_history cascades automatically when leads are deleted
  await client.query(`DELETE FROM leads WHERE is_demo = true`);

  await client.query(
    `DELETE FROM contact_addresses
     WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );

  await client.query(
    `DELETE FROM contact_tags
     WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await client.query(
    `DELETE FROM account_tags
     WHERE account_id IN (SELECT id FROM accounts WHERE is_demo = true)`,
  );
  await client.query(
    `DELETE FROM deal_tags
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)`,
  );

  // Prune tags that are no longer referenced by any junction table row.
  // Tags have no is_demo flag — we preserve tags independently created by real users.
  await client.query(
    `DELETE FROM tags
     WHERE id NOT IN (SELECT tag_id FROM contact_tags)
       AND id NOT IN (SELECT tag_id FROM account_tags)
       AND id NOT IN (SELECT tag_id FROM deal_tags)`,
  );

  // automation_rule_logs cascade automatically via ON DELETE CASCADE when rules are deleted
  await client.query(`DELETE FROM automation_rules WHERE is_demo = true`);

  await client.query(`DELETE FROM activities WHERE is_demo = true`);
  await client.query(
    `DELETE FROM deal_contacts
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)
        OR contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await client.query(`DELETE FROM deals WHERE is_demo = true`);

  // Delete the demo pipeline — pipeline_stages cascade automatically via ON DELETE CASCADE.
  // Guard on is_default = false so this can never remove the default pipeline.
  await client.query(`DELETE FROM pipelines WHERE name = $1 AND is_default = false`, [
    DEMO_PIPELINE_NAME,
  ]);

  await client.query(`DELETE FROM contacts WHERE is_demo = true`);
  await client.query(`DELETE FROM accounts WHERE is_demo = true`);

  // Remove the demo rep user — all their owned records are already deleted above via is_demo
  await client.query(`DELETE FROM users WHERE email = $1`, [DEMO_REP.email]);

  // remove IAM demo teams (cascade deletes team_memberships)
  await client.query(`DELETE FROM teams WHERE name = ANY($1::text[])`, [
    ['West Coast Sales', 'East Coast Sales', 'Sales'],
  ]);

  // remove Senior Rep custom role (cascade deletes role_capabilities + user_custom_roles)
  await client.query(`DELETE FROM public.custom_roles WHERE name = $1 AND is_builtin = false`, [
    DEMO_SENIOR_REP_ROLE_NAME,
  ]);

  // remove IAM demo users — owned records already gone via is_demo cascade above
  await client.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [
    DEMO_IAM_USERS.map((u) => u.email),
  ]);
}

/**
 * Inserts the full demo dataset inside a single transaction.
 * Idempotency is NOT checked here — callers must check first (or use seedDemo which does check).
 *
 * @param client - Active DB client (must already be inside a transaction).
 * @param adminId - UUID to use as owner_id for all inserted records.
 */
async function insertDemoData(
  client: pg.PoolClient,
  adminId: string,
  repPasswordHash: string,
): Promise<{ svcDemoToken: string }> {
  // 0. Create demo rep user — ON CONFLICT preserves idempotency if partially seeded
  await client.query(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (email) DO NOTHING`,
    [DEMO_REP.email, DEMO_REP.name, DEMO_REP.role, repPasswordHash],
  );
  const repResult = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    DEMO_REP.email,
  ]);
  const repId = repResult.rows[0].id;

  // 1. Accounts — Acme first so we have its ID for Globex's parent_account_id
  const accountIds: string[] = [];
  for (const account of DEMO_ACCOUNTS) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO accounts (name, industry, website, employee_range, revenue_range, account_type, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id`,
      [
        account.name,
        account.industry,
        account.website,
        account.employee_range,
        account.revenue_range,
        account.account_type,
        adminId,
      ],
    );
    accountIds.push(result.rows[0].id);
  }

  // Link Globex (index 1) as a subsidiary of Acme (index 0)
  await client.query(`UPDATE accounts SET parent_account_id = $1 WHERE id = $2`, [
    accountIds[0],
    accountIds[1],
  ]);

  // 2. Automation rules — no FK dependency on contacts/deals/activities
  for (const rule of DEMO_AUTOMATION_RULES) {
    await client.query(
      `INSERT INTO automation_rules
         (name, enabled, trigger_type, trigger_config, action_type, action_config, created_by, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [
        rule.name,
        rule.enabled,
        rule.trigger_type,
        JSON.stringify(rule.trigger_config),
        rule.action_type,
        JSON.stringify(rule.action_config),
        adminId,
      ],
    );
  }

  // 3. Contacts — first 10 → account 0 (Acme), next 10 → account 1 (Globex)
  const contactIds: string[] = [];
  for (let i = 0; i < DEMO_CONTACTS.length; i++) {
    const contact = DEMO_CONTACTS[i];
    const accountId = accountIds[i < 10 ? 0 : 1];
    const result = await client.query<{ id: string }>(
      `INSERT INTO contacts
         (first_name, last_name, email, phone, title, department,
          linkedin_url, twitter_x_url, account_id, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING id`,
      [
        contact.first_name,
        contact.last_name,
        contact.email,
        contact.phone,
        contact.title,
        contact.department,
        (contact as { linkedin_url?: string }).linkedin_url ?? null,
        (contact as { twitter_x_url?: string }).twitter_x_url ?? null,
        accountId,
        adminId,
      ],
    );
    contactIds.push(result.rows[0].id);
  }

  // 4. Contact addresses (contact_addresses table, not inline fields)
  for (const addr of DEMO_CONTACT_ADDRESSES) {
    await client.query(
      `INSERT INTO contact_addresses
         (contact_id, label, address_line1, city, state_region, postal_code, country, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        contactIds[addr.contactIndex],
        addr.label,
        addr.address_line1,
        addr.city,
        addr.state_region,
        addr.postal_code,
        addr.country,
        addr.is_default,
      ],
    );
  }

  // 5a. Demo pipeline + stages — must exist before deals reference them.
  // Resolve the default pipeline ID so deals are explicitly linked (not left as NULL).
  const defaultPipelineResult = await client.query<{ id: string }>(
    `SELECT id FROM pipelines WHERE is_default = true LIMIT 1`,
  );
  const defaultPipelineId = defaultPipelineResult.rows[0].id;

  // Create the "Enterprise B2B" pipeline if it doesn't exist, then seed its stages.
  // ON CONFLICT on lower(name) makes both inserts idempotent.
  await client.query(
    `INSERT INTO pipelines (name, is_default, created_by)
     VALUES ($1, false, $2)
     ON CONFLICT (lower(name)) DO NOTHING`,
    [DEMO_PIPELINE_NAME, adminId],
  );
  const demoPipelineResult = await client.query<{ id: string }>(
    `SELECT id FROM pipelines WHERE lower(name) = lower($1) LIMIT 1`,
    [DEMO_PIPELINE_NAME],
  );
  const demoPipelineId = demoPipelineResult.rows[0].id;

  for (const stage of DEMO_PIPELINE_STAGES) {
    await client.query(
      `INSERT INTO pipeline_stages (name, sort_order, probability, is_terminal, is_fixed, pipeline_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pipeline_id, lower(name)) DO NOTHING`,
      [
        stage.name,
        stage.sort_order,
        stage.probability,
        stage.is_terminal,
        stage.is_fixed,
        demoPipelineId,
      ],
    );
  }

  // 5. Deals — Acme deals → account 0, Globex deals → account 1.
  // pipeline: 'enterprise' → demoPipelineId; all others → defaultPipelineId.
  const dealIds: string[] = [];
  for (const deal of DEMO_DEALS) {
    const accountId = deal.name.startsWith('Acme') ? accountIds[0] : accountIds[1];
    const lossReason = (deal as { loss_reason?: string | null }).loss_reason ?? null;
    const probability = (deal as { probability?: number }).probability ?? null;
    const currency = (deal as { currency?: string }).currency ?? 'USD';
    const pipelineId =
      (deal as { pipeline?: string }).pipeline === 'enterprise'
        ? demoPipelineId
        : defaultPipelineId;
    const demoStageRow = await client.query<{ id: string }>(
      `SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1`,
      [deal.stage, pipelineId],
    );
    const demoPipelineStageId = demoStageRow.rows[0]?.id;
    if (!demoPipelineStageId) {
      throw new Error(`Demo seed: unknown stage '${deal.stage}' in pipeline ${pipelineId}`);
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO deals
         (name, stage, value, probability, currency, close_date, loss_reason, account_id, owner_id, pipeline_id, pipeline_stage_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
       RETURNING id`,
      [
        deal.name,
        deal.stage,
        deal.value,
        probability,
        currency,
        deal.close_date,
        lossReason,
        accountId,
        adminId,
        pipelineId,
        demoPipelineStageId,
      ],
    );
    dealIds.push(result.rows[0].id);
  }

  // 6. Link primary contact to each deal.
  // Indices 0–4: Acme contacts 0–4. Indices 5–9: Globex contacts 10–14.
  // Indices 10–16 (Enterprise B2B): Acme contacts cycle 0–4, Globex contacts cycle 10–14.
  let acmeContactIdx = 0;
  let globexContactIdx = 10;
  for (let i = 0; i < DEMO_DEALS.length; i++) {
    const isAcme = DEMO_DEALS[i].name.startsWith('Acme');
    const contactIndex = isAcme ? acmeContactIdx++ % 5 : (globexContactIdx++ % 5) + 10;
    await client.query(
      `INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [dealIds[i], contactIds[contactIndex]],
    );
  }

  // 7. Activities
  for (const activity of DEMO_ACTIVITIES) {
    const dealId = dealIds[activity.dealIndex];
    const contactId = contactIds[activity.contactIndex];
    await client.query(
      `INSERT INTO activities (type, subject, notes, due_date, status, direction, deal_id, contact_id, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
      [
        activity.type,
        activity.subject,
        activity.notes ?? null,
        activity.due_date,
        activity.status,
        activity.direction,
        dealId,
        contactId,
        adminId,
      ],
    );
  }

  // 8. Leads — showcase full status lifecycle and source variety
  for (const lead of DEMO_LEADS) {
    await client.query(
      `INSERT INTO leads
         (first_name, last_name, email, company_name, lead_source, status, disqualification_reason, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
      [
        lead.first_name,
        lead.last_name,
        lead.email,
        lead.company_name,
        lead.lead_source,
        lead.status,
        (lead as { disqualification_reason?: string }).disqualification_reason ?? null,
        adminId,
      ],
    );
  }

  // 9. Tags — insert tags then junction rows
  for (const tag of DEMO_TAGS) {
    const tagResult = await client.query<{ id: string }>(
      `INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [tag.name],
    );
    const tagId = tagResult.rows[0].id;

    for (const contactIndex of tag.contactIndices) {
      await client.query(
        `INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [contactIds[contactIndex], tagId],
      );
    }
    for (const accountIndex of tag.accountIndices) {
      await client.query(
        `INSERT INTO account_tags (account_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [accountIds[accountIndex], tagId],
      );
    }
    for (const dealIndex of tag.dealIndices) {
      await client.query(
        `INSERT INTO deal_tags (deal_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [dealIds[dealIndex], tagId],
      );
    }
  }

  // 10. Rep-owned accounts
  const repAccountIds: string[] = [];
  for (const account of DEMO_REP_ACCOUNTS) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO accounts (name, industry, website, employee_range, revenue_range, account_type, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id`,
      [
        account.name,
        account.industry,
        account.website,
        account.employee_range,
        account.revenue_range,
        account.account_type,
        repId,
      ],
    );
    repAccountIds.push(result.rows[0].id);
  }

  // 11. Rep-owned contacts — first 3 → Stellartech (index 0), next 4 → Ironbridge (index 1), last 1 → Clearwater (index 2)
  const repContactIds: string[] = [];
  const repContactAccountMap = [0, 0, 0, 1, 1, 1, 1, 2];
  for (let i = 0; i < DEMO_REP_CONTACTS.length; i++) {
    const contact = DEMO_REP_CONTACTS[i];
    const accountId = repAccountIds[repContactAccountMap[i]];
    const result = await client.query<{ id: string }>(
      `INSERT INTO contacts
         (first_name, last_name, email, phone, title, department,
          linkedin_url, twitter_x_url, account_id, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING id`,
      [
        contact.first_name,
        contact.last_name,
        contact.email,
        contact.phone,
        contact.title,
        contact.department,
        (contact as { linkedin_url?: string }).linkedin_url ?? null,
        null,
        accountId,
        repId,
      ],
    );
    repContactIds.push(result.rows[0].id);
  }

  // 12. Rep-owned deals — Stellartech (index 0), Ironbridge (index 1), Clearwater (index 2) by account name.
  const repDealIds: string[] = [];
  const repDealAccountMap = [0, 1, 1, 2, 0];
  for (let i = 0; i < DEMO_REP_DEALS.length; i++) {
    const deal = DEMO_REP_DEALS[i];
    const accountId = repAccountIds[repDealAccountMap[i]];
    const lossReason = (deal as { loss_reason?: string | null }).loss_reason ?? null;
    const probability = (deal as { probability?: number }).probability ?? null;
    const currency = (deal as { currency?: string }).currency ?? 'USD';
    const pipelineId =
      (deal as { pipeline?: string }).pipeline === 'enterprise'
        ? demoPipelineId
        : defaultPipelineId;
    const repDemoStageRow = await client.query<{ id: string }>(
      `SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1`,
      [deal.stage, pipelineId],
    );
    const repDemoPipelineStageId = repDemoStageRow.rows[0]?.id;
    if (!repDemoPipelineStageId) {
      throw new Error(`Demo seed: unknown stage '${deal.stage}' in pipeline ${pipelineId}`);
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO deals
         (name, stage, value, probability, currency, close_date, loss_reason, account_id, owner_id, pipeline_id, pipeline_stage_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
       RETURNING id`,
      [
        deal.name,
        deal.stage,
        deal.value,
        probability,
        currency,
        deal.close_date,
        lossReason,
        accountId,
        repId,
        pipelineId,
        repDemoPipelineStageId,
      ],
    );
    repDealIds.push(result.rows[0].id);
  }

  // 13. Link primary contact to each rep deal
  for (let i = 0; i < DEMO_REP_DEALS.length; i++) {
    const primaryContactIndex =
      repDealAccountMap[i] === 0 ? i % 3 : repDealAccountMap[i] === 1 ? 3 + (i - 2) : 7;
    await client.query(
      `INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [repDealIds[i], repContactIds[primaryContactIndex]],
    );
  }

  // 14. Rep-owned activities
  for (const activity of DEMO_REP_ACTIVITIES) {
    const dealId = repDealIds[activity.dealIndex];
    const contactId = repContactIds[activity.contactIndex];
    await client.query(
      `INSERT INTO activities (type, subject, notes, due_date, status, direction, deal_id, contact_id, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
      [
        activity.type,
        activity.subject,
        activity.notes ?? null,
        activity.due_date,
        activity.status,
        activity.direction,
        dealId,
        contactId,
        repId,
      ],
    );
  }

  // 15. Rep-owned leads
  for (const lead of DEMO_REP_LEADS) {
    await client.query(
      `INSERT INTO leads
         (first_name, last_name, email, company_name, lead_source, status, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [
        lead.first_name,
        lead.last_name,
        lead.email,
        lead.company_name,
        lead.lead_source,
        lead.status,
        repId,
      ],
    );
  }

  // 16. Notes — spread across contacts, accounts, and deals for both users
  for (const note of DEMO_NOTES) {
    let entityId: string;
    if (note.entityType === 'contact') {
      entityId =
        note.ownerType === 'admin' ? contactIds[note.entityIndex] : repContactIds[note.entityIndex];
    } else if (note.entityType === 'deal') {
      entityId =
        note.ownerType === 'admin' ? dealIds[note.entityIndex] : repDealIds[note.entityIndex];
    } else {
      // account — admin only in this fixture set
      entityId = accountIds[note.entityIndex];
    }
    const createdBy = note.ownerType === 'admin' ? adminId : repId;
    const body = tiptapText(note.bodyText);
    const noteInsertResult = await client.query<{ id: string }>(
      `INSERT INTO notes (entity_type, entity_id, title, body, body_text, visibility, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [note.entityType, entityId, note.title, body, note.bodyText, note.visibility, createdBy],
    );
    if (note.tags.length > 0) {
      await syncEntityTagsWithinTransaction(
        client,
        'note',
        noteInsertResult.rows[0]!.id,
        note.tags,
      );
    }
  }

  // 17. Custom field definitions and values
  const customFieldDefIds: Record<string, string> = {};
  for (const def of DEMO_CUSTOM_FIELD_DEFINITIONS) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO custom_field_definitions (entity_type, name, field_type, options, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (entity_type, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [
        def.entity_type,
        def.name,
        def.field_type,
        def.options !== null ? JSON.stringify(def.options) : null,
        def.sort_order,
      ],
    );
    customFieldDefIds[def.name] = result.rows[0].id;
  }

  for (const val of DEMO_CUSTOM_FIELD_VALUES) {
    const definitionId = customFieldDefIds[val.definitionName];
    let recordId: string;
    if (val.entityType === 'contact') {
      recordId =
        val.ownerType === 'admin' ? contactIds[val.entityIndex] : repContactIds[val.entityIndex];
    } else {
      recordId = val.ownerType === 'admin' ? dealIds[val.entityIndex] : repDealIds[val.entityIndex];
    }
    await client.query(
      `INSERT INTO custom_field_values (definition_id, record_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (definition_id, record_id) DO NOTHING`,
      [definitionId, recordId, val.value],
    );
  }

  // 18. Webhook subscriptions — no unique constraint on url, so we rely on the hasDemoData()
  // guard in seedDemo/resetDemo to prevent duplicate inserts.
  for (const webhook of DEMO_WEBHOOK_SUBSCRIPTIONS) {
    const encryptedSecret = encrypt(webhook.dummySecret);
    await client.query(
      `INSERT INTO webhook_subscriptions (url, events, secret_hash, created_by)
       VALUES ($1, $2, $3, $4)`,
      [webhook.url, webhook.events, encryptedSecret, adminId],
    );
  }

  // 19. Currency exchange rates
  for (const currency of DEMO_CURRENCIES) {
    await client.query(
      `INSERT INTO currencies (code, name, symbol, rate_to_home, is_home)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (code) DO NOTHING`,
      [currency.code, currency.name, currency.symbol, currency.rate_to_home],
    );
  }

  // 20. Custom reports — demonstrate the report builder with pre-built examples
  for (const report of DEMO_CUSTOM_REPORTS) {
    await client.query(
      `INSERT INTO custom_reports (name, entity_type, config, visibility, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO NOTHING`,
      [report.name, report.entity_type, JSON.stringify(report.config), report.visibility, adminId],
    );
  }

  // 21. Sales sequence — demonstrate a 3-step new-customer cadence
  const seqResult = await client.query<{ id: string }>(
    `INSERT INTO sales_sequences (name, description, enabled, created_by, is_demo)
     VALUES ($1, $2, true, $3, true)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    ['New Customer Onboarding', 'A 3-step cadence to welcome and onboard new customers.', adminId],
  );
  if (seqResult.rows[0]) {
    const sequenceId = seqResult.rows[0].id;
    for (const step of DEMO_SEQUENCE_STEPS) {
      await client.query(
        `INSERT INTO sales_sequence_steps
           (sequence_id, sort_order, action_type, action_config, delay_days)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          sequenceId,
          step.sort_order,
          step.action_type,
          JSON.stringify(step.action_config),
          step.delay_days,
        ],
      );
    }
    // Enroll the first demo contact so the sequence shows active usage in the UI
    if (contactIds[0]) {
      await client.query(
        `INSERT INTO sequence_enrollments
           (sequence_id, contact_id, enrolled_by_id, status, current_step_id, next_action_at)
         SELECT $1, $2, $3, 'active',
                (SELECT id FROM sales_sequence_steps WHERE sequence_id = $1 ORDER BY sort_order ASC LIMIT 1),
                now() + interval '1 day'
         ON CONFLICT DO NOTHING`,
        [sequenceId, contactIds[0], adminId],
      );
    }
  }

  // ── 22. IAM demo users, teams, custom role, and record redistribution ──

  // 22a. Hash password once (bcrypt is CPU-bound; do it before any DB calls to keep
  //      the hot path short while holding a transaction).
  const iamPasswordHash = await bcrypt.hash(DEMO_IAM_PASSWORD, BCRYPT_SALT_ROUNDS);

  // 22b. Upsert all IAM demo users and collect their IDs.
  const iamUserIds: Record<string, string> = {};
  for (const u of DEMO_IAM_USERS) {
    await client.query(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         status = 'active'`,
      [u.email, u.name, u.role, iamPasswordHash],
    );
    const row = await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      u.email,
    ]);
    // Safe: we just upserted the row above.
    iamUserIds[u.email] = row.rows[0]!.id;
  }

  const westMgrId = iamUserIds['manager.west@demo.minicrm.dev']!;
  const eastMgrId = iamUserIds['manager.east@demo.minicrm.dev']!;
  const rep1Id = iamUserIds['rep1@demo.minicrm.dev']!;
  const rep2Id = iamUserIds['rep2@demo.minicrm.dev']!;
  const rep3Id = iamUserIds['rep3@demo.minicrm.dev']!;
  const svcId = iamUserIds['svc-demo@demo.minicrm.dev']!;

  // 22c. Team hierarchy: Sales (parent, no manager) → West Coast Sales + East Coast Sales
  const salesTeamResult = await client.query<{ id: string }>(
    `INSERT INTO teams (name, manager_id, parent_team_id)
     VALUES ('Sales', NULL, NULL)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const salesTeamId = salesTeamResult.rows[0]!.id;

  const westTeamResult = await client.query<{ id: string }>(
    `INSERT INTO teams (name, manager_id, parent_team_id)
     VALUES ('West Coast Sales', $1, $2)
     ON CONFLICT (name) DO UPDATE SET manager_id = EXCLUDED.manager_id, parent_team_id = EXCLUDED.parent_team_id
     RETURNING id`,
    [westMgrId, salesTeamId],
  );
  const westTeamId = westTeamResult.rows[0]!.id;

  const eastTeamResult = await client.query<{ id: string }>(
    `INSERT INTO teams (name, manager_id, parent_team_id)
     VALUES ('East Coast Sales', $1, $2)
     ON CONFLICT (name) DO UPDATE SET manager_id = EXCLUDED.manager_id, parent_team_id = EXCLUDED.parent_team_id
     RETURNING id`,
    [eastMgrId, salesTeamId],
  );
  const eastTeamId = eastTeamResult.rows[0]!.id;

  // 22d. Team memberships
  const memberships: Array<{ team_id: string; user_id: string }> = [
    { team_id: westTeamId, user_id: westMgrId },
    { team_id: westTeamId, user_id: rep1Id },
    { team_id: westTeamId, user_id: rep2Id },
    { team_id: eastTeamId, user_id: eastMgrId },
    { team_id: eastTeamId, user_id: rep3Id },
  ];
  for (const m of memberships) {
    await client.query(
      `INSERT INTO team_memberships (team_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [m.team_id, m.user_id],
    );
  }

  // 22e. "Senior Rep" custom role with extra reporting/export capabilities
  const srRoleResult = await client.query<{ id: string }>(
    `INSERT INTO public.custom_roles (name, description, is_builtin)
     VALUES ($1, 'Additive role for experienced reps: adds reporting and export capabilities.', false)
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
    [DEMO_SENIOR_REP_ROLE_NAME],
  );
  const srRoleId = srRoleResult.rows[0]!.id;

  for (const cap of DEMO_SENIOR_REP_CAPABILITIES) {
    await client.query(
      `INSERT INTO public.role_capabilities (role_id, capability)
       VALUES ($1, $2)
       ON CONFLICT (role_id, capability) DO NOTHING`,
      [srRoleId, cap],
    );
  }

  // Assign Senior Rep role to rep3 (Jordan Closer)
  await client.query(
    `INSERT INTO public.user_custom_roles (user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [rep3Id, srRoleId],
  );

  // 22f. Record redistribution — 40% West Coast reps, 30% East, 30% admin
  // DEMO_CONTACTS has 20 records (0-19), all currently owned by adminId.
  // Indices 0-7 (8 contacts, ~40%) → West Coast reps, alternating Priya/Marcus
  // Indices 8-13 (6 contacts, ~30%) → East Coast (Jordan)
  // Indices 14-19 remain with admin (~30%)
  for (let i = 0; i < 8; i++) {
    const ownerId = i % 2 === 0 ? rep1Id : rep2Id;
    await client.query(`UPDATE contacts SET owner_id = $1 WHERE id = $2`, [ownerId, contactIds[i]]);
  }
  for (let i = 8; i < 14; i++) {
    await client.query(`UPDATE contacts SET owner_id = $1 WHERE id = $2`, [rep3Id, contactIds[i]]);
  }

  // DEMO_DEALS has 17+ deals seeded for adminId. Redistribute the first 10 similarly.
  // dealIds is scoped to this function — use them directly.
  const dealCount = dealIds.length;
  const westDealCount = Math.floor(dealCount * 0.4);
  const eastDealCount = Math.floor(dealCount * 0.3);
  for (let i = 0; i < westDealCount; i++) {
    const ownerId = i % 2 === 0 ? rep1Id : rep2Id;
    await client.query(`UPDATE deals SET owner_id = $1 WHERE id = $2`, [ownerId, dealIds[i]]);
  }
  for (let i = westDealCount; i < westDealCount + eastDealCount; i++) {
    await client.query(`UPDATE deals SET owner_id = $1 WHERE id = $2`, [rep3Id, dealIds[i]]);
  }

  // 22g. Service account API token — generate plaintext and store SHA-256 hash
  const svcPlainToken = crypto.randomBytes(DEMO_API_TOKEN_BYTES).toString('hex');
  const svcTokenHash = crypto.createHash('sha256').update(svcPlainToken).digest('hex');
  await client.query(
    `UPDATE users
     SET api_token_hash = $2, api_token_issued_at = now(), updated_at = now()
     WHERE id = $1 AND role = 'service_account'`,
    [svcId, svcTokenHash],
  );

  return { svcDemoToken: svcPlainToken };
}

/**
 * Seeds demo data if not already present.
 * Returns { seeded: true } on success or { seeded: false, reason: 'already_exists' } when demo data is already present.
 */
export async function seedDemo(): Promise<{ seeded: boolean; reason?: string }> {
  // Hash before acquiring a DB connection — bcrypt is CPU-bound and would block
  // the event loop while holding a pool client, risking connection timeout under load.
  const repPasswordHash = await bcrypt.hash(DEMO_REP.password, BCRYPT_SALT_ROUNDS);
  const client = await pool.connect();
  let svcToken: string | undefined;
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);
    // Idempotency check runs inside the transaction to prevent TOCTOU races
    // where two concurrent requests both pass the guard and double-insert.
    const already = await hasDemoData(client);
    if (already) {
      await client.query('ROLLBACK');
      return { seeded: false, reason: 'already_exists' };
    }

    const adminId = await getAdminUserId(client);
    const result = await insertDemoData(client, adminId, repPasswordHash);
    svcToken = result.svcDemoToken;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`[seed-demo] Demo rep user: ${DEMO_REP.email} / ${DEMO_REP.password}`);
  console.log(`[DEMO] svc-demo API token: ${svcToken}`);

  // Persist the token to .env.demo so local tooling can authenticate as the service account.
  const envDemoPath = path.resolve(process.cwd(), '.env.demo');
  await fs.writeFile(
    envDemoPath,
    `# Auto-generated by npm run seed:demo — do not commit\nDEMO_SVC_API_TOKEN=${svcToken}\n`,
    { encoding: 'utf-8' },
  );
  console.log(`[DEMO] Token written to ${envDemoPath}`);

  return { seeded: true };
}

/**
 * Removes all demo-flagged records.
 * Returns { removed: true } on success or { removed: false, reason: 'not_present' } when no demo data exists.
 */
export async function removeDemo(): Promise<{ removed: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);
    // Check runs inside the transaction so concurrent requests cannot both pass the guard.
    const active = await hasDemoData(client);
    if (!active) {
      await client.query('ROLLBACK');
      return { removed: false, reason: 'not_present' };
    }

    await removeDemoData(client);
    await client.query('COMMIT');
    return { removed: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes existing demo data and re-seeds in a single transaction.
 */
export async function resetDemo(): Promise<{ reset: boolean }> {
  // Hash before acquiring a DB connection — same reason as seedDemo.
  const repPasswordHash = await bcrypt.hash(DEMO_REP.password, BCRYPT_SALT_ROUNDS);
  const client = await pool.connect();
  let svcToken: string | undefined;
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);
    // getAdminUserId runs inside the transaction so any error triggers a clean ROLLBACK.
    const adminId = await getAdminUserId(client);
    await removeDemoData(client);
    const result = await insertDemoData(client, adminId, repPasswordHash);
    svcToken = result.svcDemoToken;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`[DEMO] svc-demo API token: ${svcToken}`);
  const envDemoPath = path.resolve(process.cwd(), '.env.demo');
  await fs.writeFile(
    envDemoPath,
    `# Auto-generated by npm run seed:demo — do not commit\nDEMO_SVC_API_TOKEN=${svcToken}\n`,
    { encoding: 'utf-8' },
  );
  console.log(`[DEMO] Token written to ${envDemoPath}`);

  return { reset: true };
}
