/**
 * Integration tests for leadScoreService.
 * Runs against a real PostgreSQL test database for activity-count lookups.
 * No AI call is made — pure deterministic scoring.
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createLead } from '../services/leadsService.js';
import { createContact } from '../services/contactService.js';
import { createActivity } from '../services/activityService.js';
import { scoreLead } from '../services/leadScoreService.js';
import type { LeadRow } from '../services/leadsService.js';

const FILE_PREFIX = 'lead-score-svc';

let ownerId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Lead Score Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ownerId = owner.id;
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('scoreLead', () => {
  it('scores a brand-new lead with no source as insufficient data and a low score', async () => {
    const lead = await createLead(
      {
        first_name: 'New',
        last_name: 'Lead',
        email: `${FILE_PREFIX}-new@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Owner' },
    );

    const result = await scoreLead(lead);

    expect(result.insufficient_data).toBe(true);
    // New status (5) + recency credit for just-created (20) + no source (0) + no engagement (0)
    expect(result.score).toBe(25);
    expect(result.factors).toHaveLength(4);
  });

  it('awards higher source_quality points for Referral than Cold Outreach', async () => {
    const referralLead = await createLead(
      {
        first_name: 'Referral',
        last_name: 'Lead',
        email: `${FILE_PREFIX}-referral@example.com`,
        lead_source: 'Referral',
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Owner' },
    );
    const coldLead = await createLead(
      {
        first_name: 'Cold',
        last_name: 'Lead',
        email: `${FILE_PREFIX}-cold@example.com`,
        lead_source: 'Cold Outreach',
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Owner' },
    );

    const referralResult = await scoreLead(referralLead);
    const coldResult = await scoreLead(coldLead);

    const referralSourcePoints = referralResult.factors.find(
      (f) => f.factor === 'source_quality',
    )!.points;
    const coldSourcePoints = coldResult.factors.find((f) => f.factor === 'source_quality')!.points;

    expect(referralSourcePoints).toBeGreaterThan(coldSourcePoints);
  });

  it('awards more status_progression points for Qualified than New', async () => {
    const lead = await createLead(
      {
        first_name: 'Qualified',
        last_name: 'Lead',
        email: `${FILE_PREFIX}-qualified@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Owner' },
    );

    const updated: LeadRow = { ...lead, status: 'Qualified' };
    const result = await scoreLead(updated);
    const newResult = await scoreLead(lead);

    const qualifiedPoints = result.factors.find((f) => f.factor === 'status_progression')!.points;
    const newPoints = newResult.factors.find((f) => f.factor === 'status_progression')!.points;

    expect(qualifiedPoints).toBeGreaterThan(newPoints);
  });

  it('awards post_conversion_engagement points proportional to activity count after conversion', async () => {
    const contact = await createContact(
      {
        first_name: 'Converted',
        last_name: 'Contact',
        email: `${FILE_PREFIX}-converted@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Owner' },
    );
    await createActivity(
      { type: 'Call', subject: 'Follow-up call', contact_id: contact.id, owner_id: ownerId },
      { id: ownerId, name: 'Lead Score Owner' },
    );
    await createActivity(
      {
        type: 'Email',
        subject: 'Follow-up email',
        direction: 'Outbound',
        contact_id: contact.id,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Owner' },
    );

    const convertedLead = await createLead(
      {
        first_name: 'Converted',
        last_name: 'Lead',
        email: `${FILE_PREFIX}-convertedlead@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Owner' },
    );
    const withConversion: LeadRow = { ...convertedLead, converted_contact_id: contact.id };

    const result = await scoreLead(withConversion);
    const engagementFactor = result.factors.find((f) => f.factor === 'post_conversion_engagement')!;

    expect(engagementFactor.points).toBeGreaterThan(0);
    expect(result.insufficient_data).toBe(false);
  });

  it('caps post_conversion_engagement at its max_points regardless of activity count', async () => {
    const contact = await createContact(
      {
        first_name: 'Heavy',
        last_name: 'Engagement',
        email: `${FILE_PREFIX}-heavy@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Owner' },
    );
    for (let i = 0; i < 10; i++) {
      await createActivity(
        { type: 'Note', subject: `Note ${i}`, contact_id: contact.id, owner_id: ownerId },
        { id: ownerId, name: 'Lead Score Owner' },
      );
    }

    const lead = await createLead(
      {
        first_name: 'Heavy',
        last_name: 'Lead',
        email: `${FILE_PREFIX}-heavylead@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Lead Score Owner' },
    );
    const withConversion: LeadRow = { ...lead, converted_contact_id: contact.id };

    const result = await scoreLead(withConversion);
    const engagementFactor = result.factors.find((f) => f.factor === 'post_conversion_engagement')!;

    expect(engagementFactor.points).toBe(engagementFactor.max_points);
  });
});
