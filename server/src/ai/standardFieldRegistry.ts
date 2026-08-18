/**
 * Registry of standard (non-custom) entity fields eligible for admin-configurable
 * AI payload exclusion.
 *
 * Deliberately excludes internal/system columns (id, owner_id, created_at,
 * updated_at, version, is_demo, foreign keys) that have no PII/business-sensitivity
 * value as an exclusion toggle. Fields already covered unconditionally by
 * ALWAYS_EXCLUDED_FIELDS in piiFilter.ts are also excluded here — there is no
 * value in offering a toggle for a field that can never be un-excluded.
 *
 * A small static list is used rather than introspecting table columns at runtime:
 * standard fields rarely change, and runtime introspection would surface internal
 * columns that were never meant to be admin-configurable.
 */

import type { EntityType } from '@minicrm/shared/schemas/customFieldSchema.js';

export const STANDARD_FIELDS_BY_ENTITY: Readonly<Record<EntityType, readonly string[]>> = {
  contact: [
    'first_name',
    'last_name',
    'email',
    'phone',
    'title',
    'department',
    'address_line1',
    'address_line2',
    'city',
    'state_region',
    'postal_code',
    'country',
    'linkedin_url',
    'twitter_x_url',
    'other_url',
  ],
  account: ['name', 'industry', 'website', 'employee_range', 'revenue_range', 'account_type'],
  deal: ['name', 'stage', 'value', 'close_date', 'loss_reason', 'currency', 'probability'],
};

/** Returns true if fieldName is a recognised standard field for entityType. */
export function isKnownStandardField(entityType: string, fieldName: string): boolean {
  const fields = STANDARD_FIELDS_BY_ENTITY[entityType as EntityType];
  return fields !== undefined && fields.includes(fieldName);
}
