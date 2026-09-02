import { beforeEach, afterEach } from 'vitest';

/**
 * Records `window.location.href` assignments instead of navigating.
 *
 * jsdom throws `Not implemented: navigation` on a real assignment, so any path
 * leaving by full document load — the session boundaries, which cannot use the
 * router without leaving root-level providers mounted to refetch after the cache
 * clear — is untestable and noisy without this.
 *
 * Call once inside a `describe`; it registers its own setup and teardown and
 * returns a getter for whatever the code under test assigned.
 *
 * A copy of `client/src/test/stubLocationHref.ts`, kept in sync by hand: this
 * app builds and deploys independently and takes no dependency on the client
 * workspace, the same reason `renderWithProviders.tsx` is an adaptation rather
 * than an import.
 */
export function installLocationHrefStub(): () => string | null {
  let assigned: string | null = null;
  let restore: (() => void) | null = null;

  beforeEach(() => {
    assigned = null;
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...original,
        get href() {
          return original.href;
        },
        set href(value: string) {
          assigned = value;
        },
      },
    });
    restore = () =>
      Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  afterEach(() => {
    restore?.();
    restore = null;
  });

  return () => assigned;
}
