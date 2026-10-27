/**
 * The exclusion rule email sync applies before storing a page: skip a message only when it
 * has counterparties and every one of them is on an excluded domain.
 */

import { isExcludedMessage, withoutExcludedMessages } from '../services/mail/excludedDomains.js';
import type { NormalizedMessage } from '../services/mail/mailProvider.js';

const MAILBOX = 'rep@crm-owner.example';
const EXCLUDED = new Set(['hr.example', 'family.example']);

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    providerMessageId: 'INBOX:1',
    threadId: 'thread-1',
    direction: 'inbound',
    fromAddress: 'someone@hr.example',
    toAddresses: [MAILBOX],
    ccAddresses: [],
    subject: 'Hello',
    hasAttachments: false,
    sentAt: new Date('2026-08-01T12:00:00Z'),
    bodyText: null,
    bodyHtml: null,
    snippet: null,
    rfcMessageId: null,
    references: null,
    replyToAddresses: [],
    ...overrides,
  };
}

describe('isExcludedMessage', () => {
  it('excludes a message whose only counterparty is on an excluded domain', () => {
    expect(isExcludedMessage(message(), MAILBOX, EXCLUDED)).toBe(true);
  });

  it('excludes outbound mail when every recipient is excluded', () => {
    const outbound = message({
      direction: 'outbound',
      fromAddress: MAILBOX,
      toAddresses: ['a@hr.example'],
      ccAddresses: ['b@family.example'],
    });
    expect(isExcludedMessage(outbound, MAILBOX, EXCLUDED)).toBe(true);
  });

  it('keeps a message when any counterparty is outside the list', () => {
    const mixed = message({ ccAddresses: ['buyer@customer.example'] });
    expect(isExcludedMessage(mixed, MAILBOX, EXCLUDED)).toBe(false);
  });

  it('counts a Reply-To address as a counterparty', () => {
    const replyTo = message({ replyToAddresses: ['support@customer.example'] });
    expect(isExcludedMessage(replyTo, MAILBOX, EXCLUDED)).toBe(false);
  });

  it('never treats the mailbox itself as a counterparty, in any case', () => {
    const toSelfUppercase = message({ toAddresses: [MAILBOX.toUpperCase()] });
    expect(isExcludedMessage(toSelfUppercase, MAILBOX, EXCLUDED)).toBe(true);
  });

  it('keeps a note to self, which has no counterparty to exclude', () => {
    const noteToSelf = message({ fromAddress: MAILBOX, toAddresses: [MAILBOX] });
    expect(isExcludedMessage(noteToSelf, MAILBOX, EXCLUDED)).toBe(false);
  });

  it('matches the domain exactly, not its subdomains', () => {
    const subdomain = message({ fromAddress: 'someone@mail.hr.example' });
    expect(isExcludedMessage(subdomain, MAILBOX, EXCLUDED)).toBe(false);
  });

  it('matches a domain whatever its case in the address', () => {
    const upper = message({ fromAddress: 'Someone@HR.Example' });
    expect(isExcludedMessage(upper, MAILBOX, EXCLUDED)).toBe(true);
  });

  it('keeps a message with an unparseable address no list can match', () => {
    const odd = message({ ccAddresses: ['undisclosed-recipients:'] });
    expect(isExcludedMessage(odd, MAILBOX, EXCLUDED)).toBe(false);
  });

  it('excludes nothing when the list is empty', () => {
    expect(isExcludedMessage(message(), MAILBOX, new Set())).toBe(false);
  });
});

describe('withoutExcludedMessages', () => {
  const exclusion = { mailboxAddress: MAILBOX, domains: EXCLUDED };
  const none = { providerMessageIds: [], rfcMessageIds: [] };

  it('drops excluded messages and keeps the rest, in order', () => {
    const kept = message({ providerMessageId: 'INBOX:2', fromAddress: 'x@customer.example' });
    const result = withoutExcludedMessages([message(), kept], none, exclusion);
    expect(result.map((m) => m.providerMessageId)).toEqual(['INBOX:2']);
  });

  it('keeps a Sent copy an open intent claims by provider id', () => {
    const sent = message({ providerMessageId: 'SENT:9', direction: 'outbound' });
    const claimed = { providerMessageIds: ['SENT:9'], rfcMessageIds: [] };
    expect(withoutExcludedMessages([sent], claimed, exclusion)).toEqual([sent]);
  });

  it('keeps a Sent copy an open intent claims by Message-ID', () => {
    const sent = message({ rfcMessageId: '<abc@crm>', direction: 'outbound' });
    const claimed = { providerMessageIds: [], rfcMessageIds: ['<abc@crm>'] };
    expect(withoutExcludedMessages([sent], claimed, exclusion)).toEqual([sent]);
  });

  it('returns a copy, untouched, when nothing is excluded', () => {
    const messages = [message()];
    const result = withoutExcludedMessages(messages, none, {
      mailboxAddress: MAILBOX,
      domains: new Set(),
    });
    expect(result).toEqual(messages);
    expect(result).not.toBe(messages);
  });
});
