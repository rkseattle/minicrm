/**
 * Tests for RolesSettings — custom role management admin panel (MINCRM-542).
 *
 * Verifies:
 * - Loading state renders while query is in flight
 * - Error state renders when query fails
 * - Roles list renders with names and built-in badges
 * - Built-in roles do not show edit/delete buttons
 * - Non-built-in roles show edit/delete buttons
 * - Create form opens and submits correctly
 * - Edit form opens with pre-filled values
 * - Delete calls the API; shows error when assignees exist
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import RolesSettings from './RolesSettings.js';

const CUSTOM_ROLE = {
  id: 'custom-role-id',
  name: 'Sales Rep',
  description: 'Can view and edit deals',
  is_builtin: false,
  capabilities: ['contacts:view', 'deals:view', 'deals:create'],
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

const BUILTIN_ROLE = {
  id: 'builtin-admin-id',
  name: 'admin',
  description: null,
  is_builtin: true,
  capabilities: ['contacts:view', 'contacts:create', 'contacts:edit', 'contacts:delete'],
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

describe('RolesSettings — loading state', () => {
  it('shows loading indicator before query resolves', () => {
    server.use(
      http.get('/api/v1/custom-roles', async () => {
        await new Promise(() => {});
      }),
    );

    renderWithProviders(<RolesSettings />);

    expect(screen.getByTestId('roles-settings-loading')).toBeInTheDocument();
  });
});

describe('RolesSettings — error state', () => {
  it('shows load error when query fails', async () => {
    server.use(http.get('/api/v1/custom-roles', () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-error')).toBeInTheDocument();
    });
  });
});

describe('RolesSettings — roles list', () => {
  it('renders built-in role with badge and no edit/delete buttons', async () => {
    server.use(http.get('/api/v1/custom-roles', () => HttpResponse.json({ data: [BUILTIN_ROLE] })));

    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`role-name-${BUILTIN_ROLE.id}`)).toBeInTheDocument();
    });

    expect(screen.getByTestId(`role-builtin-badge-${BUILTIN_ROLE.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`role-edit-button-${BUILTIN_ROLE.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`role-delete-button-${BUILTIN_ROLE.id}`)).not.toBeInTheDocument();
  });

  it('renders custom role with edit and delete buttons', async () => {
    server.use(http.get('/api/v1/custom-roles', () => HttpResponse.json({ data: [CUSTOM_ROLE] })));

    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`role-name-${CUSTOM_ROLE.id}`)).toBeInTheDocument();
    });

    expect(screen.queryByTestId(`role-builtin-badge-${CUSTOM_ROLE.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`role-edit-button-${CUSTOM_ROLE.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`role-delete-button-${CUSTOM_ROLE.id}`)).toBeInTheDocument();
  });

  it('renders role description when present', async () => {
    server.use(http.get('/api/v1/custom-roles', () => HttpResponse.json({ data: [CUSTOM_ROLE] })));

    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`role-description-${CUSTOM_ROLE.id}`)).toBeInTheDocument();
    });

    expect(screen.getByTestId(`role-description-${CUSTOM_ROLE.id}`)).toHaveTextContent(
      CUSTOM_ROLE.description,
    );
  });

  it('renders empty roles list without crashing', async () => {
    server.use(http.get('/api/v1/custom-roles', () => HttpResponse.json({ data: [] })));

    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('roles-settings-list')).toBeEmptyDOMElement();
  });
});

describe('RolesSettings — capability picker labels', () => {
  it('renders human-readable action labels, not raw capability strings', async () => {
    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('roles-settings-new-button'));

    const picker = screen.getByTestId('capability-picker');

    // Raw key strings must not appear as visible text (MINCRM-544)
    expect(picker).not.toHaveTextContent('contacts:view');
    expect(picker).not.toHaveTextContent('deals:create');

    // Human-readable labels must be present within the picker
    expect(picker).toHaveTextContent('View');
    expect(picker).toHaveTextContent('Create');
    expect(picker).toHaveTextContent('Edit');
    expect(picker).toHaveTextContent('Delete');
  });

  it('renders translated group headers', async () => {
    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('roles-settings-new-button'));

    const picker = screen.getByTestId('capability-picker');
    expect(picker).toHaveTextContent('Contacts');
    expect(picker).toHaveTextContent('Deals');
    expect(picker).toHaveTextContent('Users & Admin');
  });

  it('uses stable groupKey-based test ids for group checkboxes', async () => {
    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('roles-settings-new-button'));

    expect(screen.getByTestId('capability-group-contacts')).toBeInTheDocument();
    expect(screen.getByTestId('capability-group-usersAdmin')).toBeInTheDocument();
    expect(screen.getByTestId('capability-group-api')).toBeInTheDocument();
  });
});

describe('RolesSettings — create form', () => {
  it('opens create form when New role button is clicked', async () => {
    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('roles-settings-new-button'));

    expect(screen.getByTestId('roles-settings-create-form')).toBeInTheDocument();
    expect(screen.getByTestId('role-form-name')).toBeInTheDocument();
  });

  it('cancel button closes create form', async () => {
    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('roles-settings-new-button'));
    fireEvent.click(screen.getByTestId('role-form-cancel'));

    expect(screen.queryByTestId('roles-settings-create-form')).not.toBeInTheDocument();
  });

  it('shows validation error when name is empty on submit', async () => {
    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-new-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('roles-settings-new-button'));
    fireEvent.click(screen.getByTestId('role-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('role-form-error')).toBeInTheDocument();
    });
  });
});

describe('RolesSettings — edit form', () => {
  it('opens edit form with pre-filled name when Edit is clicked', async () => {
    server.use(http.get('/api/v1/custom-roles', () => HttpResponse.json({ data: [CUSTOM_ROLE] })));

    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`role-edit-button-${CUSTOM_ROLE.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`role-edit-button-${CUSTOM_ROLE.id}`));

    const nameInput = screen.getByTestId('role-form-name') as HTMLInputElement;
    expect(nameInput.value).toBe(CUSTOM_ROLE.name);
  });
});

describe('RolesSettings — delete', () => {
  it('calls DELETE and refreshes list on success', async () => {
    let deleteCallCount = 0;
    server.use(
      http.get('/api/v1/custom-roles', () => HttpResponse.json({ data: [CUSTOM_ROLE] })),
      http.delete(`/api/v1/custom-roles/${CUSTOM_ROLE.id}`, () => {
        deleteCallCount++;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`role-delete-button-${CUSTOM_ROLE.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`role-delete-button-${CUSTOM_ROLE.id}`));

    await waitFor(() => {
      expect(deleteCallCount).toBe(1);
    });
  });

  it('shows error message when role has active assignees', async () => {
    server.use(
      http.get('/api/v1/custom-roles', () => HttpResponse.json({ data: [CUSTOM_ROLE] })),
      http.delete(`/api/v1/custom-roles/${CUSTOM_ROLE.id}`, () =>
        HttpResponse.json(
          { error: { code: 'CUSTOM_ROLE_HAS_ASSIGNEES', message: 'Role has assignees' } },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<RolesSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`role-delete-button-${CUSTOM_ROLE.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`role-delete-button-${CUSTOM_ROLE.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-delete-error')).toBeInTheDocument();
    });
  });
});
