/**
 * The `code` an error carries, or undefined when it carries none.
 *
 * Errors in this codebase are tagged with Object.assign(new Error(...), { code }), and pg
 * and Node errors carry `code` too. A thrown non-Error, null included, has no code.
 *
 * @param err - Anything a catch clause received.
 */
export function thrownCode(err: unknown): unknown {
  // Safe: narrowed to Error first, and `code` is read as unknown, never trusted.
  return err instanceof Error ? (err as Error & { code?: unknown }).code : undefined;
}
