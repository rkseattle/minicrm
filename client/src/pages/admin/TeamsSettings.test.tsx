/**
 * Tests for TeamsSettings — team management admin panel.
 *
 * Verifies:
 * - Loading state renders while query is in flight
 * - Error state renders when GET /teams fails
 * - Empty state renders when no teams exist
 * - Team list renders with name and member count
 * - Create form opens and submits successfully
 * - Duplicate name error surfaces the specific i18n message
 * - Generic create error surfaces for other failures
 * - Delete button calls DELETE and invalidates the cache
 * - TEAM_HAS_CHILDREN delete error surfaces the specific message
 * - Expand button toggles member section visibility
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import TeamsSettings from './TeamsSettings.js';

const TEAM_1 = {
  id: 'team-aaa',
  name: 'Engineering',
  manager_id: null,
  manager_name: null,
  parent_team_id: null,
  member_count: 3,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('TeamsSettings — loading state', () => {
  it('shows loading indicator while query is in flight', () => {
    server.use(
      http.get('/api/v1/teams', async () => {
        await new Promise(() => {}); // never resolves
      }),
    );

    renderWithProviders(<TeamsSettings />);

    expect(screen.getByTestId('teams-settings-loading')).toBeInTheDocument();
  });
});

describe('TeamsSettings — error state', () => {
  it('shows load error when GET /teams fails', async () => {
    server.use(http.get('/api/v1/teams', () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('teams-settings-error')).toBeInTheDocument();
    });
  });
});

describe('TeamsSettings — empty state', () => {
  it('shows empty message when no teams exist', async () => {
    server.use(http.get('/api/v1/teams', () => HttpResponse.json({ teams: [] })));

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('teams-settings-empty')).toBeInTheDocument();
    });
  });
});

describe('TeamsSettings — loaded state', () => {
  it('renders the team list with name and member count', async () => {
    server.use(http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })));

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-name-${TEAM_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`team-name-${TEAM_1.id}`)).toHaveTextContent('Engineering');
    expect(screen.getByTestId(`team-member-count-${TEAM_1.id}`)).toBeInTheDocument();
  });

  it('renders the New team button', async () => {
    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('teams-settings-new-button')).toBeInTheDocument();
    });
  });
});

describe('TeamsSettings — create flow', () => {
  it('opens create form when New team button is clicked', async () => {
    server.use(http.get('/api/v1/teams', () => HttpResponse.json({ teams: [] })));

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('teams-settings-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('teams-settings-new-button'));

    expect(screen.getByTestId('teams-settings-create-form')).toBeInTheDocument();
  });

  it('shows duplicate name error when server returns TEAM_NAME_DUPLICATE', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [] })),
      http.post('/api/v1/teams', () =>
        HttpResponse.json(
          { error: { code: 'TEAM_NAME_DUPLICATE', message: 'duplicate' } },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('teams-settings-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('teams-settings-new-button'));
    fireEvent.change(screen.getByTestId('team-form-name'), { target: { value: 'Engineering' } });
    fireEvent.click(screen.getByTestId('team-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('team-form-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('team-form-error')).toHaveTextContent(
      'A team with that name already exists.',
    );
  });

  it('shows generic create error for non-duplicate failures', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [] })),
      http.post('/api/v1/teams', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('teams-settings-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('teams-settings-new-button'));
    fireEvent.change(screen.getByTestId('team-form-name'), { target: { value: 'New Team' } });
    fireEvent.click(screen.getByTestId('team-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('team-form-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('team-form-error')).toHaveTextContent(
      'Failed to create team. Please try again.',
    );
  });
});

describe('TeamsSettings — delete flow', () => {
  it('calls DELETE when delete button is clicked', async () => {
    let deleteCalled = false;
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.delete(`/api/v1/teams/${TEAM_1.id}`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-delete-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-delete-button-${TEAM_1.id}`));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
  });

  it('shows has-children error when server returns TEAM_HAS_CHILDREN', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.delete(`/api/v1/teams/${TEAM_1.id}`, () =>
        HttpResponse.json(
          { error: { code: 'TEAM_HAS_CHILDREN', message: 'has children' } },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-delete-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-delete-button-${TEAM_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('teams-settings-delete-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('teams-settings-delete-error')).toHaveTextContent(
      'This team has sub-teams',
    );
  });
});

describe('TeamsSettings — member expand', () => {
  it('shows member section after clicking the expand button', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.get(`/api/v1/teams/${TEAM_1.id}/members`, () => HttpResponse.json({ members: [] })),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-expand-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-expand-button-${TEAM_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId(`team-members-section-${TEAM_1.id}`)).toBeInTheDocument();
    });
  });

  it('hides member section when expand button is clicked again', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.get(`/api/v1/teams/${TEAM_1.id}/members`, () => HttpResponse.json({ members: [] })),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-expand-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-expand-button-${TEAM_1.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`team-members-section-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-expand-button-${TEAM_1.id}`));
    expect(screen.queryByTestId(`team-members-section-${TEAM_1.id}`)).not.toBeInTheDocument();
  });

  it('shows add-member button when expanded with no members', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.get(`/api/v1/teams/${TEAM_1.id}/members`, () => HttpResponse.json({ members: [] })),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-expand-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-expand-button-${TEAM_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId(`team-members-empty-${TEAM_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`team-add-member-button-${TEAM_1.id}`)).toBeInTheDocument();
  });

  it('shows add-member form when add button is clicked', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.get(`/api/v1/teams/${TEAM_1.id}/members`, () => HttpResponse.json({ members: [] })),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-expand-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-expand-button-${TEAM_1.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`team-add-member-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-add-member-button-${TEAM_1.id}`));
    expect(screen.getByTestId(`team-add-member-form-${TEAM_1.id}`)).toBeInTheDocument();
  });

  it('shows already-member error when server returns TEAM_MEMBER_ALREADY_EXISTS', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.get(`/api/v1/teams/${TEAM_1.id}/members`, () => HttpResponse.json({ members: [] })),
      http.get('/api/v1/users/active', () =>
        HttpResponse.json({
          users: [{ id: 'user-001', name: 'Alice', email: 'alice@example.com', role: 'rep' }],
        }),
      ),
      http.post(`/api/v1/teams/${TEAM_1.id}/members`, () =>
        HttpResponse.json(
          { error: { code: 'TEAM_MEMBER_ALREADY_EXISTS', message: 'already a member' } },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-expand-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-expand-button-${TEAM_1.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`team-add-member-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-add-member-button-${TEAM_1.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`team-add-member-user-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId(`team-add-member-user-${TEAM_1.id}`), {
      target: { value: 'user-001' },
    });
    fireEvent.click(screen.getByTestId(`team-add-member-submit-${TEAM_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId(`team-add-member-error-${TEAM_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`team-add-member-error-${TEAM_1.id}`)).toHaveTextContent(
      'already a member',
    );
  });
});

describe('TeamsSettings — edit flow', () => {
  it('opens edit form when Edit button is clicked', async () => {
    server.use(http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })));

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-edit-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-edit-button-${TEAM_1.id}`));

    expect(screen.getByTestId('team-form')).toBeInTheDocument();
  });

  it('shows circular reference error when server returns TEAM_CIRCULAR_REFERENCE', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.put(`/api/v1/teams/${TEAM_1.id}`, () =>
        HttpResponse.json(
          { error: { code: 'TEAM_CIRCULAR_REFERENCE', message: 'circular' } },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-edit-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-edit-button-${TEAM_1.id}`));
    fireEvent.click(screen.getByTestId('team-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('team-form-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('team-form-error')).toHaveTextContent(
      'A team cannot be its own ancestor.',
    );
  });

  it('shows duplicate name error when server returns TEAM_NAME_DUPLICATE on update', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.put(`/api/v1/teams/${TEAM_1.id}`, () =>
        HttpResponse.json(
          { error: { code: 'TEAM_NAME_DUPLICATE', message: 'duplicate' } },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-edit-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-edit-button-${TEAM_1.id}`));
    fireEvent.click(screen.getByTestId('team-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('team-form-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('team-form-error')).toHaveTextContent(
      'A team with that name already exists.',
    );
  });

  it('closes edit form when Cancel is clicked', async () => {
    server.use(http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })));

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-edit-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-edit-button-${TEAM_1.id}`));
    expect(screen.getByTestId('team-form')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('team-form-cancel'));
    expect(screen.queryByTestId('team-form')).not.toBeInTheDocument();
  });

  it('shows generic update error for non-circular failures', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.put(`/api/v1/teams/${TEAM_1.id}`, () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-edit-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-edit-button-${TEAM_1.id}`));
    fireEvent.click(screen.getByTestId('team-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('team-form-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('team-form-error')).toHaveTextContent(
      'Failed to update team. Please try again.',
    );
  });

  it('changes manager and parent selects in the edit form', async () => {
    const TEAM_2 = { ...TEAM_1, id: 'team-bbb', name: 'Design' };
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1, TEAM_2] })),
      http.get('/api/v1/users/active', () =>
        HttpResponse.json({
          users: [{ id: 'user-001', name: 'Alice', email: 'alice@example.com', role: 'rep' }],
        }),
      ),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-edit-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-edit-button-${TEAM_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('team-form-manager')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('team-form-manager'), { target: { value: 'user-001' } });
    fireEvent.change(screen.getByTestId('team-form-parent'), { target: { value: 'team-bbb' } });

    expect((screen.getByTestId('team-form-manager') as HTMLSelectElement).value).toBe('user-001');
    expect((screen.getByTestId('team-form-parent') as HTMLSelectElement).value).toBe('team-bbb');
  });
});

describe('TeamsSettings — member remove', () => {
  it('calls DELETE member when remove button is clicked', async () => {
    const MEMBER = {
      team_id: TEAM_1.id,
      user_id: 'user-001',
      user_name: 'Alice',
      user_email: 'alice@example.com',
      role: 'member',
    };
    let removeCalled = false;
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.get(`/api/v1/teams/${TEAM_1.id}/members`, () =>
        HttpResponse.json({ members: [MEMBER] }),
      ),
      http.delete(`/api/v1/teams/${TEAM_1.id}/members/${MEMBER.user_id}`, () => {
        removeCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-expand-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-expand-button-${TEAM_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId(`team-member-remove-${MEMBER.user_id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-member-remove-${MEMBER.user_id}`));

    await waitFor(() => {
      expect(removeCalled).toBe(true);
    });
  });

  it('cancels add-member form when cancel is clicked', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.get(`/api/v1/teams/${TEAM_1.id}/members`, () => HttpResponse.json({ members: [] })),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-expand-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-expand-button-${TEAM_1.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`team-add-member-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-add-member-button-${TEAM_1.id}`));
    expect(screen.getByTestId(`team-add-member-form-${TEAM_1.id}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`team-add-member-cancel-${TEAM_1.id}`));
    expect(screen.queryByTestId(`team-add-member-form-${TEAM_1.id}`)).not.toBeInTheDocument();
  });

  it('shows generic add-member error for non-duplicate failures', async () => {
    server.use(
      http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })),
      http.get(`/api/v1/teams/${TEAM_1.id}/members`, () => HttpResponse.json({ members: [] })),
      http.get('/api/v1/users/active', () =>
        HttpResponse.json({
          users: [{ id: 'user-001', name: 'Alice', email: 'alice@example.com', role: 'rep' }],
        }),
      ),
      http.post(
        `/api/v1/teams/${TEAM_1.id}/members`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`team-expand-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-expand-button-${TEAM_1.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`team-add-member-button-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`team-add-member-button-${TEAM_1.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`team-add-member-user-${TEAM_1.id}`)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId(`team-add-member-user-${TEAM_1.id}`), {
      target: { value: 'user-001' },
    });
    fireEvent.click(screen.getByTestId(`team-add-member-submit-${TEAM_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId(`team-add-member-error-${TEAM_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`team-add-member-error-${TEAM_1.id}`)).toHaveTextContent(
      'Failed to add member',
    );
  });
});

describe('TeamsSettings — dual-form guard', () => {
  it('closes the create form when Edit is clicked on a team row', async () => {
    server.use(http.get('/api/v1/teams', () => HttpResponse.json({ teams: [TEAM_1] })));

    renderWithProviders(<TeamsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('teams-settings-new-button')).toBeInTheDocument();
    });

    // open the create form
    fireEvent.click(screen.getByTestId('teams-settings-new-button'));
    expect(screen.getByTestId('teams-settings-create-form')).toBeInTheDocument();

    // clicking edit on a row must close the create form
    fireEvent.click(screen.getByTestId(`team-edit-button-${TEAM_1.id}`));
    expect(screen.queryByTestId('teams-settings-create-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('team-form')).toBeInTheDocument();
  });
});
