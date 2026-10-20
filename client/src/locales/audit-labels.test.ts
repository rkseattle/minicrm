/**
 * Every audit event and record type the server can write has a label, so the admin audit log
 * never shows a raw identifier. locale-completeness then carries each label to every locale.
 */

import { describe, expect, it } from 'vitest';
import { AUDIT_EVENT_TYPES, AUDIT_RECORD_TYPES } from '@shared/schemas/auditSchema.js';
import en from './en.json';

describe('audit log labels', () => {
  it.each(AUDIT_EVENT_TYPES)('labels the %s event', (eventType) => {
    expect(en.auditLog.eventTypes).toHaveProperty(eventType);
  });

  it.each(AUDIT_RECORD_TYPES)('labels the %s record type', (recordType) => {
    expect(en.auditLog.recordTypes).toHaveProperty(recordType);
  });
});
