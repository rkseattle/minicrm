/**
 * Tests for specGlob.
 *
 * Pins each wildcard token form independently, because the translator's whole
 * reason for splitting on tokens is that a chained-replace implementation
 * silently corrupts one form using another's output.
 */

import { globToRegExp } from '../coverageAgent/testSelection/specGlob.js';

describe('globToRegExp', () => {
  it('matches a direct child through a double-star separator', () => {
    expect(globToRegExp('auth/**/*.spec.ts').test('auth/auth.spec.ts')).toBe(true);
  });

  it('matches one level deeper', () => {
    expect(globToRegExp('auth/**/*.spec.ts').test('auth/sub/login.spec.ts')).toBe(true);
  });

  it('matches several levels deeper', () => {
    expect(globToRegExp('auth/**/*.spec.ts').test('auth/a/b/c/login.spec.ts')).toBe(true);
  });

  it('does not match outside the globbed directory', () => {
    expect(globToRegExp('auth/**/*.spec.ts').test('deals/deals.spec.ts')).toBe(false);
  });

  it('matches a trailing double-star at every depth', () => {
    const matcher = globToRegExp('server/src/**');
    expect(matcher.test('server/src/app.ts')).toBe(true);
    expect(matcher.test('server/src/a/b/c/deep.ts')).toBe(true);
  });

  it('keeps a single star inside one path segment', () => {
    const matcher = globToRegExp('docker-compose*.yml');
    expect(matcher.test('docker-compose.dev.yml')).toBe(true);
    expect(matcher.test('nested/docker-compose.dev.yml')).toBe(false);
  });

  it('anchors both ends', () => {
    const matcher = globToRegExp('db/migrations/**');
    expect(matcher.test('qa/db/migrations/001.js')).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    const matcher = globToRegExp('a+b/c.d');
    expect(matcher.test('a+b/c.d')).toBe(true);
    expect(matcher.test('axb/cxd')).toBe(false);
  });
});
