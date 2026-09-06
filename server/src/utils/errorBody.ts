/**
 * The error envelope every failure path returns.
 *
 * `{ error: { code, message } }` with a SCREAMING_SNAKE_CASE code is the repo-wide
 * contract, and clients branch on the code rather than the prose.
 */
export function errorBody(
  code: string,
  message: string,
): { error: { code: string; message: string } } {
  return { error: { code, message } };
}
