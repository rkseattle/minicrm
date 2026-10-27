import { domainOfAddress } from '../services/mail/address.js';

describe('domainOfAddress', () => {
  it.each([
    ['someone@Example.COM', 'example.com'],
    ['"a@b"@example.com', 'example.com'],
    ['first.last@mail.example.co.uk', 'mail.example.co.uk'],
    ['someone@example.com ', 'example.com'],
  ])('reads %s as %s', (address, domain) => {
    expect(domainOfAddress(address)).toBe(domain);
  });

  it.each(['no-at-sign', '@example.com', 'someone@', 'someone@  ', ''])(
    'returns null for %j',
    (address) => {
      expect(domainOfAddress(address)).toBeNull();
    },
  );
});
