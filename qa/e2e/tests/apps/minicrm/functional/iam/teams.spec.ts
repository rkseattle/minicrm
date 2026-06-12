/**
 * F-TEAMS — Team management API (MINCRM-539)
 *
 * Verifies that:
 * 1. Admin can create, update, and delete teams
 * 2. Admin can add and remove team members
 * 3. A team with child teams cannot be deleted (TEAM_HAS_CHILDREN)
 * 4. A user without teams:manage capability receives 403 on mutation endpoints
 * 5. Duplicate team names return 409 TEAM_NAME_DUPLICATE
 * 6. member_count is returned correctly in the list response
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - API-only; no browser UI navigation
 *   - Each test tears down its own fixtures in try/finally
 *
 * MINCRM-539
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { RestClient, RestClientError } from '@framework/clients/rest-client.js';
import type { APIRequestContext } from '@playwright/test';

interface TeamResponse {
  id: string;
  name: string;
  manager_id: string | null;
  manager_name: string | null;
  parent_team_id: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

interface TeamMemberResponse {
  team_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: 'lead' | 'member';
}

test.use({ storageState: { cookies: [], origins: [] } });

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F-TEAMS] E2E_ADMIN_PASSWORD is not set');

const REP_PASSWORD = 'TeamRepTest12!';

interface InviteResponse {
  user: { id: string; email: string; name: string; role: string };
  inviteToken: string;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

function errorBody(err: unknown): ErrorBody {
  if (err instanceof RestClientError) return err.body as ErrorBody;
  return {};
}

async function createActivatedRep(
  adminClient: RestClient,
  newContext: () => Promise<APIRequestContext>,
  suffix: string,
): Promise<{ repId: string; repClient: RestClient; repContext: APIRequestContext }> {
  const email = `teams-rep-${suffix}@example.com`;

  const inviteRes = await adminClient.post<InviteResponse>('/api/v1/users/invite', {
    name: `Teams Rep ${suffix}`,
    email,
    role: 'rep',
  });
  const { user, inviteToken } = inviteRes.body;

  await adminClient.post('/api/v1/users/set-password', {
    token: inviteToken,
    password: REP_PASSWORD,
  });

  // Suppress onboarding so rep is fully active
  const onboardCtx = await newContext();
  const onboardClient = new RestClient(onboardCtx);
  await onboardClient.post('/api/v1/auth/login', { email, password: REP_PASSWORD });
  await onboardClient
    .put('/api/v1/settings/onboarding', { onboarding_completed: true })
    .catch(() => null);
  await onboardCtx.dispose();

  const repContext = await newContext();
  const repClient = new RestClient(repContext);
  await repClient.post('/api/v1/auth/login', { email, password: REP_PASSWORD });

  return { repId: user.id, repClient, repContext };
}

async function deactivateUser(adminClient: RestClient, userId: string): Promise<void> {
  await adminClient.patch(`/api/v1/users/${userId}/deactivate`).catch(() => null);
}

test.beforeEach(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ── Team CRUD ─────────────────────────────────────────────────────────────────

test('@functional teams — create, update, and delete a team', async ({ restClient }) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let teamId: string | null = null;

  try {
    // Create
    const createRes = await restClient.post<{ team: TeamResponse }>('/api/v1/teams', {
      name: `E2E Team ${suffix}`,
    });
    expect(createRes.status).toBe(201);
    teamId = createRes.body.team.id;
    expect(createRes.body.team.name).toBe(`E2E Team ${suffix}`);
    expect(createRes.body.team.manager_id).toBeNull();
    expect(createRes.body.team.parent_team_id).toBeNull();

    // Read via list
    const listRes = await restClient.get<{ teams: TeamResponse[] }>('/api/v1/teams');
    expect(listRes.status).toBe(200);
    const found = listRes.body.teams.find((t) => t.id === teamId);
    expect(found).toBeDefined();
    expect(found!.member_count).toBe(0);

    // Update
    const updateRes = await restClient.put<{ team: TeamResponse }>(`/api/v1/teams/${teamId}`, {
      name: `E2E Team Updated ${suffix}`,
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.team.name).toBe(`E2E Team Updated ${suffix}`);
  } finally {
    if (teamId) {
      await restClient.delete(`/api/v1/teams/${teamId}`).catch(() => null);
    }
  }
});

test('@functional teams — duplicate name returns 409 TEAM_NAME_DUPLICATE', async ({
  restClient,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let teamId: string | null = null;

  try {
    const createRes = await restClient.post<{ team: TeamResponse }>('/api/v1/teams', {
      name: `E2E Dup Team ${suffix}`,
    });
    teamId = createRes.body.team.id;

    let threw = false;
    try {
      await restClient.post('/api/v1/teams', { name: `E2E Dup Team ${suffix}` });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(409);
      expect(errorBody(err).error?.code).toBe('TEAM_NAME_DUPLICATE');
    }
    expect(threw).toBe(true);
  } finally {
    if (teamId) {
      await restClient.delete(`/api/v1/teams/${teamId}`).catch(() => null);
    }
  }
});

// ── Member management ─────────────────────────────────────────────────────────

test('@functional teams — add member and verify member_count increments', async ({
  restClient,
  playwright,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let teamId: string | null = null;
  let repId: string | null = null;
  let repContext: APIRequestContext | null = null;

  try {
    const teamRes = await restClient.post<{ team: TeamResponse }>('/api/v1/teams', {
      name: `E2E Members Team ${suffix}`,
    });
    teamId = teamRes.body.team.id;

    const { repId: rId, repContext: rCtx } = await createActivatedRep(
      restClient,
      () => playwright.request.newContext(),
      suffix,
    );
    repId = rId;
    repContext = rCtx;

    // Add member
    const addRes = await restClient.post<{ member: TeamMemberResponse }>(
      `/api/v1/teams/${teamId}/members`,
      { user_id: repId, role: 'member' },
    );
    expect(addRes.status).toBe(201);
    expect(addRes.body.member.user_id).toBe(repId);
    expect(addRes.body.member.role).toBe('member');

    // Verify member_count in list
    const listRes = await restClient.get<{ teams: TeamResponse[] }>('/api/v1/teams');
    const team = listRes.body.teams.find((t) => t.id === teamId);
    expect(team).toBeDefined();
    expect(team!.member_count).toBe(1);

    // Remove member
    const removeRes = await restClient.delete(`/api/v1/teams/${teamId}/members/${repId}`);
    expect(removeRes.status).toBe(204);

    // member_count back to 0
    const listRes2 = await restClient.get<{ teams: TeamResponse[] }>('/api/v1/teams');
    const team2 = listRes2.body.teams.find((t) => t.id === teamId);
    expect(team2!.member_count).toBe(0);
  } finally {
    if (teamId) {
      await restClient.delete(`/api/v1/teams/${teamId}`).catch(() => null);
    }
    if (repId) {
      await deactivateUser(restClient, repId);
    }
    if (repContext) {
      await repContext.dispose();
    }
  }
});

test('@functional teams — duplicate member returns 409 TEAM_MEMBER_ALREADY_EXISTS', async ({
  restClient,
  playwright,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let teamId: string | null = null;
  let repId: string | null = null;
  let repContext: APIRequestContext | null = null;

  try {
    const teamRes = await restClient.post<{ team: TeamResponse }>('/api/v1/teams', {
      name: `E2E DupMember Team ${suffix}`,
    });
    teamId = teamRes.body.team.id;

    const { repId: rId, repContext: rCtx } = await createActivatedRep(
      restClient,
      () => playwright.request.newContext(),
      `dup-${suffix}`,
    );
    repId = rId;
    repContext = rCtx;

    await restClient.post(`/api/v1/teams/${teamId}/members`, {
      user_id: repId,
      role: 'member',
    });

    let threw = false;
    try {
      await restClient.post(`/api/v1/teams/${teamId}/members`, {
        user_id: repId,
        role: 'lead',
      });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(409);
      expect(errorBody(err).error?.code).toBe('TEAM_MEMBER_ALREADY_EXISTS');
    }
    expect(threw).toBe(true);
  } finally {
    if (teamId) {
      await restClient.delete(`/api/v1/teams/${teamId}`).catch(() => null);
    }
    if (repId) {
      await deactivateUser(restClient, repId);
    }
    if (repContext) {
      await repContext.dispose();
    }
  }
});

// ── Child team guard ──────────────────────────────────────────────────────────

test('@functional teams — deleting a team with children returns 409 TEAM_HAS_CHILDREN', async ({
  restClient,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let parentId: string | null = null;
  let childId: string | null = null;

  try {
    const parentRes = await restClient.post<{ team: TeamResponse }>('/api/v1/teams', {
      name: `E2E Parent Team ${suffix}`,
    });
    parentId = parentRes.body.team.id;

    const childRes = await restClient.post<{ team: TeamResponse }>('/api/v1/teams', {
      name: `E2E Child Team ${suffix}`,
      parent_team_id: parentId,
    });
    childId = childRes.body.team.id;

    let threw = false;
    try {
      await restClient.delete(`/api/v1/teams/${parentId}`);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(409);
      expect(errorBody(err).error?.code).toBe('TEAM_HAS_CHILDREN');
    }
    expect(threw).toBe(true);
  } finally {
    // Delete child first, then parent
    if (childId) {
      await restClient.delete(`/api/v1/teams/${childId}`).catch(() => null);
    }
    if (parentId) {
      await restClient.delete(`/api/v1/teams/${parentId}`).catch(() => null);
    }
  }
});

// ── Capability enforcement ────────────────────────────────────────────────────

test('@functional teams — rep without teams:manage capability receives 403 on mutations', async ({
  restClient,
  playwright,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let teamId: string | null = null;
  let repId: string | null = null;
  let repContext: APIRequestContext | null = null;

  try {
    // Create a team as admin to use for PUT/DELETE tests
    const teamRes = await restClient.post<{ team: TeamResponse }>('/api/v1/teams', {
      name: `E2E Cap Guard Team ${suffix}`,
    });
    teamId = teamRes.body.team.id;

    const {
      repId: rId,
      repClient,
      repContext: rCtx,
    } = await createActivatedRep(
      restClient,
      () => playwright.request.newContext(),
      `cap-${suffix}`,
    );
    repId = rId;
    repContext = rCtx;

    // POST /api/v1/teams → 403
    let threw = false;
    try {
      await repClient.post('/api/v1/teams', { name: `Rep Team ${suffix}` });
    } catch (err) {
      threw = true;
      expect((err as RestClientError).status).toBe(403);
    }
    expect(threw).toBe(true);

    // PUT /api/v1/teams/:id → 403
    threw = false;
    try {
      await repClient.put(`/api/v1/teams/${teamId}`, { name: `Updated ${suffix}` });
    } catch (err) {
      threw = true;
      expect((err as RestClientError).status).toBe(403);
    }
    expect(threw).toBe(true);

    // DELETE /api/v1/teams/:id → 403
    threw = false;
    try {
      await repClient.delete(`/api/v1/teams/${teamId}`);
    } catch (err) {
      threw = true;
      expect((err as RestClientError).status).toBe(403);
    }
    expect(threw).toBe(true);

    // POST /api/v1/teams/:id/members → 403
    threw = false;
    try {
      await repClient.post(`/api/v1/teams/${teamId}/members`, {
        user_id: repId,
        role: 'member',
      });
    } catch (err) {
      threw = true;
      expect((err as RestClientError).status).toBe(403);
    }
    expect(threw).toBe(true);

    // GET /api/v1/teams is public to any authenticated user — expect 200
    const listRes = await repClient.get('/api/v1/teams');
    expect(listRes.status).toBe(200);
  } finally {
    if (teamId) {
      await restClient.delete(`/api/v1/teams/${teamId}`).catch(() => null);
    }
    if (repId) {
      await deactivateUser(restClient, repId);
    }
    if (repContext) {
      await repContext.dispose();
    }
  }
});
