import { describe, it, expect } from 'vitest';

import {
  EMAIL_SEND_BODY_MAX,
  EMAIL_SEND_MAX_RECIPIENTS,
  EMAIL_SEND_SUBJECT_MAX,
  sendEmailSchema,
  sendErrorOutcome,
} from '@minicrm/shared/schemas/emailMessageSchema.js';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const RECORD = '00000000-0000-4000-8000-000000000002';
const MESSAGE = '00000000-0000-4000-8000-000000000003';

function typed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connected_account_id: ACCOUNT,
    to: ['a@x.test'],
    subject: 'Hello',
    body_html: '<p>Hi</p>',
    ...overrides,
  };
}

function addresses(count: number): string[] {
  return Array.from({ length: count }, (_, n) => `r${String(n)}@x.test`);
}

/** The first issue's message, or null when the body parses. */
function refusal(body: Record<string, unknown>): string | null {
  const parsed = sendEmailSchema.safeParse(body);
  return parsed.success ? null : (parsed.error.errors[0]?.message ?? 'refused');
}

describe('sendEmailSchema — recipients', () => {
  it('accepts exactly the most recipients a message may have, across To and Cc', () => {
    const half = EMAIL_SEND_MAX_RECIPIENTS / 2;

    expect(refusal(typed({ to: addresses(half), cc: addresses(half) }))).toBeNull();
  });

  it('refuses one recipient more, counting Cc', () => {
    expect(
      refusal(typed({ to: addresses(EMAIL_SEND_MAX_RECIPIENTS), cc: ['extra@x.test'] })),
    ).toMatch(/at most/);
  });

  it('accepts a message addressed only in Cc', () => {
    expect(refusal(typed({ to: [], cc: ['a@x.test'] }))).toBeNull();
  });

  it('refuses a message with no recipient at all', () => {
    expect(refusal(typed({ to: [], cc: [] }))).toBe('At least one recipient is required');
  });

  it('refuses a malformed address', () => {
    expect(refusal(typed({ to: ['not-an-address'] }))).toMatch(/email address/);
  });
});

describe('sendEmailSchema — subject and body', () => {
  it('accepts a subject at the limit and refuses one character more', () => {
    expect(refusal(typed({ subject: 's'.repeat(EMAIL_SEND_SUBJECT_MAX) }))).toBeNull();
    expect(refusal(typed({ subject: 's'.repeat(EMAIL_SEND_SUBJECT_MAX + 1) }))).toMatch(
      /characters or fewer/,
    );
  });

  it('accepts a body at the limit and refuses one character more', () => {
    expect(refusal(typed({ body_html: 'b'.repeat(EMAIL_SEND_BODY_MAX) }))).toBeNull();
    expect(refusal(typed({ body_html: 'b'.repeat(EMAIL_SEND_BODY_MAX + 1) }))).toMatch(
      /characters or fewer/,
    );
  });

  it.each([
    ['a missing subject', { subject: undefined }, 'Subject is required'],
    ['a missing body', { body_html: undefined }, 'Body is required'],
    ['a whitespace-only body', { body_html: '   ' }, 'Body is required'],
    ['a whitespace-only subject', { subject: '  ' }, 'Subject is required'],
  ])('refuses %s', (_label, overrides, message) => {
    expect(refusal(typed(overrides))).toBe(message);
  });
});

describe('sendEmailSchema — templates, records, and threading', () => {
  const template = {
    subject: undefined,
    body_html: undefined,
    template_id: MESSAGE,
    record_type: 'contact',
    record_id: RECORD,
  };

  it('accepts a template rendered against a record', () => {
    expect(refusal(typed(template))).toBeNull();
  });

  it('refuses a template with no record to render against', () => {
    expect(refusal(typed({ ...template, record_type: undefined, record_id: undefined }))).toMatch(
      /name one/,
    );
  });

  it('refuses a template sent alongside typed text', () => {
    expect(refusal(typed({ ...template, subject: 'Typed' }))).toMatch(/not both/);
  });

  it.each([
    ['record_id without record_type', { record_id: RECORD }],
    ['record_type without record_id', { record_type: 'contact' }],
  ])('refuses %s', (_label, overrides) => {
    expect(refusal(typed(overrides))).toBe('record_type and record_id must be given together');
  });

  it('refuses a message that both replies to and forwards', () => {
    expect(
      refusal(typed({ in_reply_to_message_id: MESSAGE, forward_of_message_id: MESSAGE })),
    ).toBe('A message replies to or forwards one message, not both');
  });

  it.each(['in_reply_to_message_id', 'forward_of_message_id'])('accepts %s alone', (field) => {
    expect(refusal(typed({ [field]: MESSAGE }))).toBeNull();
  });
});

describe('sendErrorOutcome', () => {
  it.each([
    ['SENT_NOT_RECORDED', 'went'],
    ['SEND_ALREADY_SENT', 'went'],
    ['SEND_FAILED', 'not_sent'],
    ['VALIDATION_ERROR', 'not_sent'],
    ['SEND_NOT_CONFIRMED', 'unknown'],
    ['SEND_UNCONFIRMED', 'unknown'],
  ])('reads %s as %s', (code, outcome) => {
    expect(sendErrorOutcome(code)).toBe(outcome);
  });

  // A code the client has never heard of may come from a send that went.
  it.each([undefined, 'SOMETHING_NEW', 'toString', '__proto__'])('reads %s as unknown', (code) => {
    expect(sendErrorOutcome(code)).toBe('unknown');
  });
});
