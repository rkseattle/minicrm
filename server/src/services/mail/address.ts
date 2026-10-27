/**
 * The domain of an email address: the text after its last `@`, lowercased.
 *
 * The last, not the first, because RFC 5322 lets a quoted local part contain `@`
 * (`"a@b"@example.com`), and the domain is always what follows the final one.
 *
 * @returns null for a value with no `@`, or nothing on either side of the last one.
 */
export function domainOfAddress(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain === '' ? null : domain;
}

/** An address as stored and compared: trimmed and lowercased, as every provider writes it. */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}
