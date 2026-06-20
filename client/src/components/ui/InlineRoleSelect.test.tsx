/**
 * Tests for InlineRoleSelect — inline built-in role <select> for the user table.
 * Covers optimistic update, rollback on failure, service account display,
 * canEdit=false read-only mode, and custom role chips (MINCRM-560).
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { InlineRoleSelect } from './InlineRoleSelect.js';
import type { UserResponse } from '@shared/schemas/userSchema.js';
import type { CustomRoleResponse } from '@/api/customRoles.js';

const ACTIVE_REP: UserResponse = {
  id: 'user-rep-1',
  email: 'rep@example.com',
  name: 'Rep User',
  role: 'rep',
  status: 'active',
  must_change_password: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

const SERVICE_ACCOUNT: UserResponse = {
  ...ACTIVE_REP,
  id: 'user-sa-1',
  role: 'service_account',
};

const CUSTOM_ROLE: CustomRoleResponse = {
  id: 'cr-1',
  name: 'Billing Admin',
  description: null,
  is_builtin: false,
  capabilities: [],
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function defaultProps(overrides: Partial<React.ComponentProps<typeof InlineRoleSelect>> = {}) {
  return {
    user: ACTIVE_REP,
    canEdit: true,
    currentUserId: 'other-user-id',
    assignedCustomRoles: [],
    usersQueryKey: ['users'] as const,
    onRoleChanged: vi.fn(),
    onRoleError: vi.fn(),
    ...overrides,
  };
}

describe('InlineRoleSelect', () => {
  it('renders a select showing current role for non-service-account users when canEdit=true', () => {
    renderWithProviders(<InlineRoleSelect {...defaultProps()} />);

    const select = screen.getByTestId(`role-select-${ACTIVE_REP.id}`);
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('rep');
  });

  it('service account renders disabled span with tooltip text (no select)', () => {
    renderWithProviders(<InlineRoleSelect {...defaultProps({ user: SERVICE_ACCOUNT })} />);

    expect(screen.queryByTestId(`role-select-${SERVICE_ACCOUNT.id}`)).not.toBeInTheDocument();
    const span = screen.getByTestId(`role-cell-${SERVICE_ACCOUNT.id}`);
    expect(span).toBeInTheDocument();
    expect(span).toHaveAttribute('title');
  });

  it('canEdit=false renders a disabled select (not editable)', () => {
    renderWithProviders(<InlineRoleSelect {...defaultProps({ canEdit: false })} />);

    expect(screen.getByTestId(`role-select-${ACTIVE_REP.id}`)).toBeDisabled();
  });

  it('changing role fires PATCH and updates select optimistically', async () => {
    renderWithProviders(<InlineRoleSelect {...defaultProps()} />);

    const select = screen.getByTestId(`role-select-${ACTIVE_REP.id}`);
    fireEvent.change(select, { target: { value: 'manager' } });

    // Optimistic update is synchronous
    expect(select).toHaveValue('manager');

    // Wait for the mutation to settle
    await waitFor(() => expect(select).not.toBeDisabled());
  });

  it('failed PATCH rolls back to old role and calls onRoleError', async () => {
    server.use(
      http.patch('/api/v1/users/:id/role', () => {
        return HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
          { status: 403 },
        );
      }),
    );

    const onRoleError = vi.fn();
    renderWithProviders(<InlineRoleSelect {...defaultProps({ onRoleError })} />);

    const select = screen.getByTestId(`role-select-${ACTIVE_REP.id}`);
    fireEvent.change(select, { target: { value: 'admin' } });

    // After the server rejects, the value should roll back
    await waitFor(() => {
      expect(select).toHaveValue('rep');
    });
    expect(onRoleError).toHaveBeenCalledOnce();
  });

  it('renders custom role chips for users with custom roles', () => {
    renderWithProviders(
      <InlineRoleSelect {...defaultProps({ assignedCustomRoles: [CUSTOM_ROLE] })} />,
    );

    expect(
      screen.getByTestId(`custom-role-chip-${ACTIVE_REP.id}-${CUSTOM_ROLE.id}`),
    ).toBeInTheDocument();
    expect(screen.getByText('Billing Admin')).toBeInTheDocument();
  });

  it('custom role chip links to the roles admin tab', () => {
    renderWithProviders(
      <InlineRoleSelect {...defaultProps({ assignedCustomRoles: [CUSTOM_ROLE] })} />,
    );

    const chip = screen.getByTestId(`custom-role-chip-${ACTIVE_REP.id}-${CUSTOM_ROLE.id}`);
    expect(chip.tagName).toBe('A');
    expect(chip).toHaveAttribute('href', '/admin/settings?tab=roles');
  });

  it('select is disabled and has tooltip when currentUserId matches the user row', () => {
    renderWithProviders(<InlineRoleSelect {...defaultProps({ currentUserId: ACTIVE_REP.id })} />);

    const select = screen.getByTestId(`role-select-${ACTIVE_REP.id}`);
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('title');
  });
});
