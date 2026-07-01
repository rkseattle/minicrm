/**
 * Integration tests for customFieldService.
 *
 * Runs against a real PostgreSQL test database.
 * Tables are truncated before each test to ensure isolation. (MINCRM-276)
 */

import 'dotenv/config';
import {
  listDefinitions,
  createDefinition,
  updateDefinition,
  deleteDefinition,
  getValuesForRecord,
  upsertValues,
} from '../services/customFieldService.js';
import pool from '../db.js';

const SYSTEM_ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

async function truncate(): Promise<void> {
  await pool.query('DELETE FROM custom_field_values');
  await pool.query('DELETE FROM custom_field_definitions');
}

beforeEach(async () => {
  await truncate();
});

afterAll(async () => {
  await truncate();
  await pool.end();
});

describe('listDefinitions', () => {
  it('returns empty array when no definitions exist', async () => {
    const result = await listDefinitions('contact');
    expect(result).toEqual([]);
  });

  it('returns definitions for the given entity type in sort order', async () => {
    await createDefinition({
      entity_type: 'contact',
      name: 'Z Field',
      field_type: 'text',
      sort_order: 10,
    });
    await createDefinition({
      entity_type: 'contact',
      name: 'A Field',
      field_type: 'number',
      sort_order: 5,
    });
    await createDefinition({
      entity_type: 'deal',
      name: 'Deal Field',
      field_type: 'date',
      sort_order: 0,
    });

    const contactDefs = await listDefinitions('contact');
    expect(contactDefs).toHaveLength(2);
    // sort_order 5 (A Field) comes before sort_order 10 (Z Field)
    expect(contactDefs[0].name).toBe('A Field');
    expect(contactDefs[1].name).toBe('Z Field');

    const dealDefs = await listDefinitions('deal');
    expect(dealDefs).toHaveLength(1);
    expect(dealDefs[0].name).toBe('Deal Field');
  });
});

describe('createDefinition', () => {
  it('creates a text custom field definition', async () => {
    const def = await createDefinition({
      entity_type: 'contact',
      name: 'NPS Score',
      field_type: 'text',
    });

    expect(def.id).toBeDefined();
    expect(def.entity_type).toBe('contact');
    expect(def.name).toBe('NPS Score');
    expect(def.field_type).toBe('text');
    expect(def.options).toBeNull();
    expect(def.sort_order).toBe(0);
  });

  it('creates a select field with options', async () => {
    const def = await createDefinition({
      entity_type: 'account',
      name: 'Tier',
      field_type: 'select',
      options: ['Bronze', 'Silver', 'Gold'],
    });

    expect(def.options).toEqual(['Bronze', 'Silver', 'Gold']);
  });

  it('throws CUSTOM_FIELD_NAME_CONFLICT on duplicate name for same entity_type', async () => {
    await createDefinition({ entity_type: 'contact', name: 'Duplicate', field_type: 'text' });

    await expect(
      createDefinition({ entity_type: 'contact', name: 'Duplicate', field_type: 'number' }),
    ).rejects.toMatchObject({ code: 'CUSTOM_FIELD_NAME_CONFLICT' });
  });

  it('allows same name for different entity types', async () => {
    await createDefinition({ entity_type: 'contact', name: 'Priority', field_type: 'text' });
    const dealDef = await createDefinition({
      entity_type: 'deal',
      name: 'Priority',
      field_type: 'text',
    });
    expect(dealDef.name).toBe('Priority');
  });
});

describe('updateDefinition', () => {
  it('updates the name of a definition', async () => {
    const def = await createDefinition({
      entity_type: 'contact',
      name: 'Old Name',
      field_type: 'text',
    });
    const updated = await updateDefinition(def.id, { name: 'New Name' });
    expect(updated?.name).toBe('New Name');
  });

  it('returns null for a non-existent id', async () => {
    const result = await updateDefinition('00000000-0000-0000-0000-000000000000', { name: 'X' });
    expect(result).toBeNull();
  });

  it('throws CUSTOM_FIELD_NAME_CONFLICT when renaming to a taken name', async () => {
    await createDefinition({ entity_type: 'contact', name: 'Field A', field_type: 'text' });
    const b = await createDefinition({
      entity_type: 'contact',
      name: 'Field B',
      field_type: 'text',
    });

    await expect(updateDefinition(b.id, { name: 'Field A' })).rejects.toMatchObject({
      code: 'CUSTOM_FIELD_NAME_CONFLICT',
    });
  });

  it('defaults pii_excluded to false on creation', async () => {
    const def = await createDefinition({
      entity_type: 'contact',
      name: 'Notes',
      field_type: 'text',
    });
    expect(def.pii_excluded).toBe(false);
  });

  it('sets pii_excluded to true (MINCRM-461)', async () => {
    const def = await createDefinition({ entity_type: 'contact', name: 'SSN', field_type: 'text' });
    const updated = await updateDefinition(def.id, { pii_excluded: true }, SYSTEM_ACTOR);
    expect(updated?.pii_excluded).toBe(true);
  });

  it('writes an audit entry when pii_excluded changes', async () => {
    const def = await createDefinition({
      entity_type: 'contact',
      name: 'BankRef',
      field_type: 'text',
    });
    await updateDefinition(def.id, { pii_excluded: true }, SYSTEM_ACTOR);

    let found = false;
    for (let attempt = 0; attempt < 10 && !found; attempt++) {
      const row = await pool.query<{ old_value: string; new_value: string }>(
        `SELECT old_value, new_value FROM audit_log
         WHERE record_type = 'ai_field_exclusion' AND record_id = $1 AND field_name = 'pii_excluded'
         ORDER BY id DESC LIMIT 1`,
        [def.id],
      );
      if (row.rows.length > 0) {
        found = true;
        expect(row.rows[0].old_value).toBe('false');
        expect(row.rows[0].new_value).toBe('true');
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    expect(found).toBe(true);
  });

  it('does not write an audit entry when pii_excluded is unchanged by the update', async () => {
    const def = await createDefinition({
      entity_type: 'contact',
      name: 'NameOnlyChange',
      field_type: 'text',
    });
    await updateDefinition(def.id, { name: 'RenamedField' }, SYSTEM_ACTOR);

    const row = await pool.query(
      `SELECT id FROM audit_log WHERE record_type = 'ai_field_exclusion' AND record_id = $1`,
      [def.id],
    );
    expect(row.rows).toHaveLength(0);
  });
});

describe('deleteDefinition', () => {
  it('deletes a definition and returns it', async () => {
    const def = await createDefinition({
      entity_type: 'contact',
      name: 'To Delete',
      field_type: 'text',
    });
    const deleted = await deleteDefinition(def.id);
    expect(deleted?.id).toBe(def.id);

    const remaining = await listDefinitions('contact');
    expect(remaining).toHaveLength(0);
  });

  it('returns null for a non-existent id', async () => {
    const result = await deleteDefinition('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('cascades to custom_field_values on delete', async () => {
    const def = await createDefinition({
      entity_type: 'contact',
      name: 'Cascade Test',
      field_type: 'text',
    });
    const recordId = '11111111-1111-1111-1111-111111111111';

    await upsertValues(
      recordId,
      [{ definition_id: def.id, value: 'test' }],
      SYSTEM_ACTOR,
      'contact',
    );

    const valuesBefore = await getValuesForRecord(recordId);
    expect(valuesBefore).toHaveLength(1);

    await deleteDefinition(def.id);

    const valuesAfter = await getValuesForRecord(recordId);
    expect(valuesAfter).toHaveLength(0);
  });
});

describe('upsertValues', () => {
  it('inserts a new value for a record', async () => {
    const def = await createDefinition({
      entity_type: 'contact',
      name: 'Score',
      field_type: 'number',
    });
    const recordId = '22222222-2222-2222-2222-222222222222';

    await upsertValues(recordId, [{ definition_id: def.id, value: '42' }], SYSTEM_ACTOR, 'contact');

    const values = await getValuesForRecord(recordId);
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe('42');
    expect(values[0].definition.name).toBe('Score');
  });

  it('updates an existing value on conflict', async () => {
    const def = await createDefinition({
      entity_type: 'contact',
      name: 'Level',
      field_type: 'text',
    });
    const recordId = '33333333-3333-3333-3333-333333333333';

    await upsertValues(
      recordId,
      [{ definition_id: def.id, value: 'initial' }],
      SYSTEM_ACTOR,
      'contact',
    );
    await upsertValues(
      recordId,
      [{ definition_id: def.id, value: 'updated' }],
      SYSTEM_ACTOR,
      'contact',
    );

    const values = await getValuesForRecord(recordId);
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe('updated');
  });

  it('stores null values', async () => {
    const def = await createDefinition({ entity_type: 'deal', name: 'Notes', field_type: 'text' });
    const recordId = '44444444-4444-4444-4444-444444444444';

    await upsertValues(recordId, [{ definition_id: def.id, value: null }], SYSTEM_ACTOR, 'deal');

    const values = await getValuesForRecord(recordId);
    expect(values[0].value).toBeNull();
  });

  it('is a no-op when given an empty array', async () => {
    await expect(
      upsertValues('55555555-5555-5555-5555-555555555555', [], SYSTEM_ACTOR, 'contact'),
    ).resolves.toBeUndefined();
  });
});
