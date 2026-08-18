/**
 * Unit tests for requireAiTokenBudget middleware.
 *
 * Covers:
 *  - Returns 401 when req.user is not set
 *  - Allows admins through regardless of usage
 *  - Allows reps through when status is 'ok'
 *  - Allows reps through when status is 'warning'
 *  - Returns 429 with AI_BUDGET_EXCEEDED when status is 'exceeded'
 */

import 'dotenv/config';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the service before importing the middleware.
vi.mock('../services/aiTokenBudgetService.js', () => ({
  getUserBudgetStatus: vi.fn(),
}));

import { requireAiTokenBudget } from '../middleware/requireAiTokenBudget.js';
import { getUserBudgetStatus } from '../services/aiTokenBudgetService.js';

const mockGetUserBudgetStatus = vi.mocked(getUserBudgetStatus);

function makeReq(overrides: Partial<Request['user']> = {}): Partial<Request> {
  return {
    user: {
      id: 'user-1',
      email: 'test@example.com',
      role: 'rep',
      name: 'Test User',
      status: 'active',
      must_change_password: false,
      ...overrides,
    } as Request['user'],
  };
}

function makeRes(): {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  statusCode?: number;
} {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAiTokenBudget', () => {
  it('returns 401 when req.user is undefined', async () => {
    const req = { user: undefined } as Partial<Request>;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireAiTokenBudget(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for admin users without checking budget', async () => {
    const req = makeReq({ role: 'admin' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireAiTokenBudget(req as Request, res as unknown as Response, next);

    expect(mockGetUserBudgetStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('calls next() for reps when status is ok', async () => {
    mockGetUserBudgetStatus.mockResolvedValue({
      limit: 100_000,
      used: 50_000,
      percentage: 50,
      status: 'ok',
    });
    const req = makeReq({ role: 'rep' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireAiTokenBudget(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() for reps when status is warning (not yet blocked)', async () => {
    mockGetUserBudgetStatus.mockResolvedValue({
      limit: 100_000,
      used: 85_000,
      percentage: 85,
      status: 'warning',
    });
    const req = makeReq({ role: 'rep' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireAiTokenBudget(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 429 with AI_BUDGET_EXCEEDED for reps when status is exceeded', async () => {
    mockGetUserBudgetStatus.mockResolvedValue({
      limit: 100_000,
      used: 100_000,
      percentage: 100,
      status: 'exceeded',
    });
    const req = makeReq({ role: 'rep' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireAiTokenBudget(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'AI_BUDGET_EXCEEDED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next(err) when the service throws', async () => {
    const error = new Error('DB error');
    mockGetUserBudgetStatus.mockRejectedValue(error);
    const req = makeReq({ role: 'rep' });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await requireAiTokenBudget(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
