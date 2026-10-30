/**
 * The string `code` an error carries, or undefined when it carries none.
 *
 * Errors in this codebase are tagged with Object.assign(new Error(...), { code }), and pg
 * and Node errors carry `code` too. A thrown non-Error, null included, has no code, and
 * neither does an error whose code is not a string, such as a DOMException's number.
 *
 * @param err - Anything a catch clause received.
 */
export function thrownCode(err: unknown): string | undefined {
  // Safe: narrowed to Error first, and `code` is read as unknown, then checked.
  const code = err instanceof Error ? (err as Error & { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The string `code` on an error's `cause`, as fetch reports a network failure's errno.
 *
 * The cause is any object, not only an Error: undici's are, but a cause is free-form.
 *
 * @param err - Anything a catch clause received.
 */
export function thrownCauseCode(err: unknown): string | undefined {
  const cause = err instanceof Error ? err.cause : undefined;
  if (typeof cause !== 'object' || cause === null) return undefined;
  // Safe: cause is a non-null object; `code` is read as unknown, then checked.
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
