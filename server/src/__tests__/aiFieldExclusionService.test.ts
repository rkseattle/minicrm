/**
 * Unit tests for aiFieldExclusionService. (MINCRM-461)
 *
 * Covers:
 *  - getEffectiveExclusionList merges always_excluded, standard_fields, custom_fields
 *  - setFieldExclusion persists overrides, writes audit entries, rejects unknown fields
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pool from '../db.js';
import { createDefinition } from '../services/customFieldService.js';
import {
  getEffectiveExclusionList,
  setFieldExclusion,
} from '../services/aiFieldExclusionService.js';
import { invalidateFieldExclusionCache } from '../ai/piiFilter.js';

// A per-file actor, NOT the all-zeros SYSTEM_ACTOR: audit assertions below scope
// by changed_by_id, and the system UUID is shared with every other SYSTEM_ACTOR
// write in the repo, so it would isolate nothing. changed_by_id has no FK, so
// this needs no users row. (MINCRM-693)
const SYSTEM_ACTOR = { id: randomUUID(), name: 'AI Field Exclusion Svc Test' };

beforeEach(async () => {
  await pool.query('DELETE FROM ai_field_exclusions');
  await pool.query('DELETE FROM custom_field_values');
  await pool.query('DELETE FROM custom_field_definitions');
  invalidateFieldExclusionCache();
});

describe('getEffectiveExclusionList', () => {
  it('includes the hardcoded always-excluded fields', async () => {
    const list = await getEffectiveExclusionList();
    expect(list.always_excluded).toContain('password_hash');
    expect(list.always_excluded).toContain('ssn');
  });

  it('lists every registered standard field with excluded=false by default', async () => {
    const list = await getEffectiveExclusionList();
    const contactEmail = list.standard_fields.find(
      (f) => f.entity_type === 'contact' && f.field_name === 'email',
    );
    expect(contactEmail).toBeDefined();
    expect(contactEmail?.excluded).toBe(false);
  });

  it('reflects an admin override in the standard_fields list', async () => {
    await setFieldExclusion('contact', 'department', true, SYSTEM_ACTOR);
    const list = await getEffectiveExclusionList();
    const dept = list.standard_fields.find(
      (f) => f.entity_type === 'contact' && f.field_name === 'department',
    );
    expect(dept?.excluded).toBe(true);
  });

  it('includes custom fields with their current pii_excluded state', async () => {
    await createDefinition({ entity_type: 'deal', name: 'InternalRiskScore', field_type: 'text' });
    const list = await getEffectiveExclusionList();
    const custom = list.custom_fields.find((f) => f.field_name === 'InternalRiskScore');
    expect(custom).toBeDefined();
    expect(custom?.excluded).toBe(false);
  });
});

describe('setFieldExclusion', () => {
  it('persists a new exclusion override', async () => {
    await setFieldExclusion('account', 'website', true, SYSTEM_ACTOR);
    const row = await pool.query<{ excluded: boolean }>(
      `SELECT excluded FROM ai_field_exclusions WHERE entity_type = 'account' AND field_name = 'website'`,
    );
    expect(row.rows[0].excluded).toBe(true);
  });

  it('toggles an existing override back off', async () => {
    await setFieldExclusion('account', 'website', true, SYSTEM_ACTOR);
    await setFieldExclusion('account', 'website', false, SYSTEM_ACTOR);
    const row = await pool.query<{ excluded: boolean }>(
      `SELECT excluded FROM ai_field_exclusions WHERE entity_type = 'account' AND field_name = 'website'`,
    );
    expect(row.rows[0].excluded).toBe(false);
  });

  it('writes an audit entry recording the change', async () => {
    await setFieldExclusion('deal', 'loss_reason', true, SYSTEM_ACTOR);
    const row = await pool.query<{ old_value: string; new_value: string; record_name: string }>(
      // changed_by_id scoping: record_type + record_name + field_name are all
      // shared with aiFieldExclusionController.test.ts. (MINCRM-693)
      `SELECT old_value, new_value, record_name FROM audit_log
       WHERE record_type = 'ai_field_exclusion' AND field_name = 'excluded'
         AND record_name = 'deal.loss_reason' AND changed_by_id = $1
       ORDER BY id DESC LIMIT 1`,
      [SYSTEM_ACTOR.id],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].old_value).toBe('false');
    expect(row.rows[0].new_value).toBe('true');
  });

  it('rejects an unknown field name for a known entity type', async () => {
    await expect(
      setFieldExclusion('contact', 'not_a_real_field', true, SYSTEM_ACTOR),
    ).rejects.toMatchObject({ code: 'UNKNOWN_FIELD' });
  });

  it('rejects an unknown entity type', async () => {
    await expect(setFieldExclusion('widget', 'name', true, SYSTEM_ACTOR)).rejects.toMatchObject({
      code: 'UNKNOWN_FIELD',
    });
  });
});
