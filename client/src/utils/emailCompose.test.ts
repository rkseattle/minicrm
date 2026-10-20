import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '@shared/schemas/emailMessageSchema.js';
import { parseRecipients, replyRecipients, replySubject } from './emailCompose.js';

function message(overrides: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'm',
    connected_account_id: 'a',
    thread_id: 't',
    direction: 'inbound',
    from_address: 'ada@client.test',
    to_addresses: ['rep@example.com', 'team@example.com'],
    cc_addresses: [],
    subject: 'Hello',
    snippet: null,
    has_attachments: false,
    sent_at: null,
    is_private: false,
    ...overrides,
  };
}

describe('parseRecipients', () => {
  it.each<[string, string[]]>([
    ['a@x.test, b@x.test,c@x.test', ['a@x.test', 'b@x.test', 'c@x.test']],
    ['Ada Lovelace <ada@x.test>, Bob <bob@x.test>', ['ada@x.test', 'bob@x.test']],
    ['"Lovelace, Ada" <ada@x.test>', ['ada@x.test']],
    ['Team: a@x.test, b@x.test;', ['a@x.test', 'b@x.test']],
    ['', []],
    ['   ', []],
  ])('reads %j as %j', (input, expected) => {
    expect(parseRecipients(input)).toEqual(expected);
  });

  it.each([
    'Ada <a@x.test> Bob <b@x.test>',
    'a@x.test b@x.test',
    'not an address',
    'a@x.test,,b@x.test',
  ])('refuses %j whole rather than dropping part of it', (input) => {
    expect(parseRecipients(input)).toBeNull();
  });
});

describe('replyRecipients', () => {
  it('answers the sender of mail received', () => {
    expect(replyRecipients(message({ direction: 'inbound' }))).toEqual(['ada@client.test']);
  });

  it('answers the recipients of mail sent', () => {
    expect(replyRecipients(message({ direction: 'outbound' }))).toEqual([
      'rep@example.com',
      'team@example.com',
    ]);
  });
});

describe('replySubject', () => {
  it.each<[string | null, string]>([
    ['Pricing', 'Re: Pricing'],
    ['Re: Pricing', 'Re: Pricing'],
    ['RE: Pricing', 'Re: Pricing'],
    ['re:Pricing', 'Re: Pricing'],
    ['AW: Angebot', 'Re: Angebot'],
    ['Re: AW: Re: Angebot', 'Re: Angebot'],
    ['SV: Offert', 'Re: Offert'],
    ['RE[2]: Pricing', 'Re: Pricing'],
    ['Re^3: Pricing', 'Re: Pricing'],
    ['Réf : Devis', 'Re: Devis'],
    ['回复：报价', 'Re: 报价'],
    ['Regarding: Pricing', 'Re: Regarding: Pricing'],
    ['Fwd: Pricing', 'Re: Fwd: Pricing'],
    ['Re:', 'Re:'],
    [null, 'Re:'],
    ['   ', 'Re:'],
  ])('turns %j into %j', (subject, expected) => {
    expect(replySubject(subject)).toBe(expected);
  });
});
