/**
 * A fresh UUID v4 for an Idempotency-Key.
 *
 * Built from `crypto.getRandomValues` rather than `crypto.randomUUID`, which exists only in
 * secure contexts: over plain HTTP to a non-localhost host it throws before any request is
 * made, and a send that cannot mint a key cannot be retried safely either.
 */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Safe: getRandomValues fills all 16 bytes, so indexes 6 and 8 exist.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
