import type { Request, Response } from 'express';
import { vi } from 'vitest';

import { uuidParams } from '../utils/uuidParams.js';

const A = '00000000-0000-4000-8000-0000000000e1';
const B = '00000000-0000-4000-8000-0000000000e2';

function call(params: Record<string, string>, names: string[]) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  // Safe: uuidParams reads only params and writes only status().json().
  const result = uuidParams(
    { params } as unknown as Request,
    { status } as unknown as Response,
    names,
    'Bad id',
  );
  return { result, status, json };
}

describe('uuidParams', () => {
  it('returns every named param, in order, when all are UUIDs', () => {
    const { result, status } = call({ id: A, linkId: B }, ['id', 'linkId']);

    expect(result).toEqual([A, B]);
    expect(status).not.toHaveBeenCalled();
  });

  it.each([
    ['the first', { id: 'nope', linkId: B }],
    ['the second', { id: A, linkId: 'nope' }],
    ['a missing one', { id: A }],
  ])('answers 400 VALIDATION_ERROR once when %s is not a UUID', (_label, params) => {
    const { result, status, json } = call(params, ['id', 'linkId']);

    expect(result).toBeNull();
    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: { code: 'VALIDATION_ERROR', message: 'Bad id' } });
  });
});
