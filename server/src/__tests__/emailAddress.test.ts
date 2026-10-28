import { domainOfAddress, normalizeAddress } from '../utils/emailAddress.js';

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

describe('normalizeAddress', () => {
  it.each([
    ['Someone@Example.COM', 'someone@example.com'],
    ['  someone@example.com\t', 'someone@example.com'],
    ['someone@example.com', 'someone@example.com'],
    ['', ''],
    ['   ', ''],
  ])('normalizes %j to %j', (address, normalized) => {
    expect(normalizeAddress(address)).toBe(normalized);
  });
});
