/**
 * Tests the environment-classification predicates directly.
 *
 * appEnvGating.test.ts covers what the gates expose by re-importing app.ts per
 * case, which is the expensive half. These are the predicates themselves, and
 * unrecognizedEnvMessage in particular: server.ts throws on it before listen(),
 * and the spawnSync harness in startupValidation.test.ts can only observe that a
 * boot failed, never which guard rejected it or what it said.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isAuthBypassEnv,
  isNonProductionEnv,
  isProductionEnv,
  unrecognizedEnvMessage,
} from '../utils/nodeEnv.js';
import { RECOGNIZED_ENVS, UNRECOGNIZED_ENVS } from './nodeEnvCorpus.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

function withNodeEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
}

describe('unrecognizedEnvMessage', () => {
  it.each(RECOGNIZED_ENVS)('accepts %s', (value) => {
    withNodeEnv(value);

    expect(unrecognizedEnvMessage()).toBeNull();
  });

  it.each(UNRECOGNIZED_ENVS)('rejects a %s NODE_ENV', (_label, value) => {
    withNodeEnv(value);

    const message = unrecognizedEnvMessage();

    expect(message).not.toBeNull();
    // The operator has to know what to set it to; a bare rejection sends them
    // to the source to find out.
    for (const recognized of RECOGNIZED_ENVS) {
      expect(message).toContain(recognized);
    }
  });

  it('names the offending value so a typo is visible in the log', () => {
    withNodeEnv('producton');

    expect(unrecognizedEnvMessage()).toContain("'producton'");
  });
});

describe('the gates still fail closed on an unrecognized value', () => {
  // The boot guard makes these states unreachable in a running server, but the
  // predicates are called from module scope in files that tests import directly,
  // so the safe default still has to hold.
  it.each(UNRECOGNIZED_ENVS)('gives a %s NODE_ENV the production posture', (_label, value) => {
    withNodeEnv(value);

    expect(isNonProductionEnv()).toBe(false);
    expect(isAuthBypassEnv()).toBe(false);
    expect(isProductionEnv()).toBe(true);
  });

  it('keeps staging out of the auth bypass while allowing the docs', () => {
    withNodeEnv('staging');

    expect(isNonProductionEnv()).toBe(true);
    expect(isAuthBypassEnv()).toBe(false);
    expect(isProductionEnv()).toBe(true);
  });
});
