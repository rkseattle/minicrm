/**
 * Unit tests for qa/scripts/container-commit-sha.ts.
 *
 * This is the parse half of scripts/pre-push-tia.ts's stale-test-stack check.
 * Every fixture below is real `docker inspect` output shape — the exact format
 * string that script passes:
 *
 *   docker inspect <name> --format '{{.State.Running}}\n{{json .Config.Env}}'
 *
 * The three outcomes are behaviourally distinct and each drives a different
 * message in the hook, so all three are covered — `empty` in particular must
 * NOT collapse into `unreadable`, since an empty GIT_COMMIT_SHA is the defect
 * this ticket exists for (docker-compose.test.yml's `${GIT_COMMIT_SHA:-}`) and
 * means every dump the stack produces is tagged 'unknown'.
 */

import { test, expect } from '@playwright/test';
import { parseContainerCommitSha } from '../../../scripts/container-commit-sha.js';

/** Builds the exact two-part shape the docker --format string produces. */
function inspectOutput(running: boolean, env: readonly string[]): string {
  return `${String(running)}\n${JSON.stringify(env)}`;
}

const REAL_SHA = '45c3da32645836cb158794d6b1f2639005019459';

test.describe('parseContainerCommitSha', () => {
  test('returns the SHA when the container is running and the value is set', () => {
    const raw = inspectOutput(true, [
      'PATH=/usr/local/bin',
      `GIT_COMMIT_SHA=${REAL_SHA}`,
      'NODE_ENV=development',
    ]);

    expect(parseContainerCommitSha(raw)).toEqual({ kind: 'present', value: REAL_SHA });
  });

  test('reports empty separately from unreadable when the variable is blank', () => {
    // What `GIT_COMMIT_SHA: ${GIT_COMMIT_SHA:-}` produces when the operator
    // never exported it — Compose sets the variable to an empty string rather
    // than leaving it unset, which is why this case exists at all.
    const raw = inspectOutput(true, ['PATH=/usr/local/bin', 'GIT_COMMIT_SHA=']);

    expect(parseContainerCommitSha(raw)).toEqual({ kind: 'empty' });
  });

  test('reports unreadable when the container exists but is not running', () => {
    // `docker inspect` succeeds for stopped/exited/dead containers and returns
    // their full creation-time config, so without the running guard a stopped
    // stack would report a stale SHA for a run that cannot produce any dumps.
    const raw = inspectOutput(false, [`GIT_COMMIT_SHA=${REAL_SHA}`]);

    expect(parseContainerCommitSha(raw)).toEqual({ kind: 'unreadable' });
  });

  test('reports unreadable when the variable is absent entirely', () => {
    const raw = inspectOutput(true, ['PATH=/usr/local/bin', 'NODE_ENV=development']);

    expect(parseContainerCommitSha(raw)).toEqual({ kind: 'unreadable' });
  });

  test('reports unreadable on empty input', () => {
    expect(parseContainerCommitSha('')).toEqual({ kind: 'unreadable' });
  });

  test('reports unreadable when the env payload is not valid JSON', () => {
    expect(parseContainerCommitSha('true\nnot-json')).toEqual({ kind: 'unreadable' });
  });

  test('reports unreadable when the env payload is JSON but not an array', () => {
    expect(parseContainerCommitSha('true\n{"GIT_COMMIT_SHA":"x"}')).toEqual({
      kind: 'unreadable',
    });
  });

  test('is not fooled by a decoy entry embedded BEFORE the real one', () => {
    const raw = inspectOutput(true, [
      'SOME_VAR=harmless\nGIT_COMMIT_SHA=spoofed-value',
      `GIT_COMMIT_SHA=${REAL_SHA}`,
    ]);

    expect(parseContainerCommitSha(raw)).toEqual({ kind: 'present', value: REAL_SHA });
  });

  test('is not fooled by a decoy entry embedded AFTER the real one', () => {
    // The case a positional scan cannot solve in general: docker-compose.test.yml
    // declares GIT_COMMIT_SHA in the MIDDLE of its environment block, with
    // JWT_SECRET, CORS_ORIGIN, NODE_ENCRYPTION_KEY and the SMTP_* values after
    // it — several sourced from .env — so a value with an embedded newline can
    // sit on either side of the real entry. Taking the last match would fail
    // this; JSON array boundaries make the whole class impossible.
    const raw = inspectOutput(true, [
      `GIT_COMMIT_SHA=${REAL_SHA}`,
      'SMTP_PASS=hunter2\nGIT_COMMIT_SHA=spoofed-value',
    ]);

    expect(parseContainerCommitSha(raw)).toEqual({ kind: 'present', value: REAL_SHA });
  });

  test('trims surrounding whitespace from the resolved value', () => {
    const raw = inspectOutput(true, [`GIT_COMMIT_SHA=  ${REAL_SHA}  `]);

    expect(parseContainerCommitSha(raw)).toEqual({ kind: 'present', value: REAL_SHA });
  });

  test('treats a whitespace-only value as empty, not present', () => {
    const raw = inspectOutput(true, ['GIT_COMMIT_SHA=   ']);

    expect(parseContainerCommitSha(raw)).toEqual({ kind: 'empty' });
  });
});
