/**
 * Inline styles an email body must not keep, shared by the jsdom unit test and the
 * Chromium E2E spec. jsdom's CSS parser is not a browser's, so the same corpus runs in both.
 *
 * Dependency-free on purpose: the E2E spec bundles this file into a blank page with esbuild.
 */

/** Styles that could load a remote resource; nothing of any of them may survive. */
export const HOSTILE_EMAIL_STYLES: readonly string[] = [
  'background-image: url(https://evil.test/pixel)',
  'background: url(https://evil.test/pixel)',
  'width: expression(alert(1))',
  'behavior: url(x.htc)',
  // CSS escapes resolve before the parser sees url(, so a text filter misses them.
  'background:u\\72l(https://evil.test/p)',
  'background:\\75rl(https://evil.test/p)',
  // image-set takes a bare string, no url( at all.
  "background-image:image-set('https://evil.test/p' 1x)",
  "background-image:-webkit-image-set('https://evil.test/p' 1x)",
  'background-image:var(--pixel)',
  'list-style-image: url(https://evil.test/p)',
  'border-image: url(https://evil.test/p) 30',
  'content: url(https://evil.test/p)',
  'cursor: url(https://evil.test/p), auto',
  'background:u/**/rl(https://evil.test/p)',
];

/** An allowed property whose value calls a function that is not allowed: the style goes whole. */
export const DISALLOWED_FUNCTION_STYLES: readonly string[] = [
  'color: var(--tracker)',
  'color: color-mix(in srgb, red, blue)',
  'width: attr(data-x)',
];
