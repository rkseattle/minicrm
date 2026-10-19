import { canSendFrom, GMAIL_SEND_SCOPE } from '../services/mail/sendGrants.js';

describe('canSendFrom', () => {
  it.each<[string, Parameters<typeof canSendFrom>[0], string[], boolean]>([
    ['a Gmail grant with send', 'google', ['gmail.readonly', GMAIL_SEND_SCOPE], true],
    ['a Gmail grant without send', 'google', ['gmail.readonly'], false],
    [
      'a Microsoft grant with send and read-write, as echoed bare',
      'microsoft',
      ['Mail.Read', 'Mail.Send', 'Mail.ReadWrite'],
      true,
    ],
    [
      'a Microsoft grant with send and read-write, as full URIs',
      'microsoft',
      ['https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/Mail.ReadWrite'],
      true,
    ],
    [
      'a Microsoft grant from before read-write was needed',
      'microsoft',
      ['Mail.Read', 'Mail.Send'],
      false,
    ],
    ['an IMAP mailbox, which has no send driver', 'imap', [GMAIL_SEND_SCOPE], false],
  ])('%s → %s', (_label, provider, scopes, expected) => {
    expect(canSendFrom(provider, scopes)).toBe(expected);
  });
});
