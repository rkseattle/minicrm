/**
 * Cases for the glob rules in ciFilterWiring's coverage check.
 *
 * The helper decides whether a filter output triggers on a file the guard reads, so a rule
 * that over-accepts makes every guard using it pass regardless of its wiring. That failure
 * is invisible from the calling guards — all of them go green — which is why the accept
 * and reject cases are asserted here rather than left to the one production call site.
 */

import { describe, it, expect } from 'vitest';
import { coveringSubtrees } from './ciFilterWiring.js';

describe('filter globs that count as covering a subtree', () => {
  it('accepts a plain directory subtree', () => {
    expect(coveringSubtrees(['docs/user-guide/**'])).toEqual(['docs/user-guide/']);
  });

  // A leading wildcard strips to the empty string, and every path starts with that —
  // one such entry would mark every file covered and void the check for that output.
  it('rejects a leading-wildcard glob', () => {
    expect(coveringSubtrees(['**.md', '**/*.env*.example'])).toEqual([]);
  });

  // picomatch's single '*' does not cross '/', so this matches one segment, not a subtree.
  it('rejects a single-star glob', () => {
    expect(coveringSubtrees(['.claude/gates/*.md', 'docs/*'])).toEqual([]);
  });

  it('ignores literal paths, which are matched exactly rather than by prefix', () => {
    expect(coveringSubtrees(['client/src/App.tsx', '.github/workflows/ci.yml'])).toEqual([]);
  });

  it('picks only the usable entries out of a mixed list', () => {
    expect(
      coveringSubtrees(['client/src/App.tsx', 'docs/user-guide/**', '**.md', 'qa/e2e/**']),
    ).toEqual(['docs/user-guide/', 'qa/e2e/']);
  });
});
