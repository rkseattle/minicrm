/**
 * Tests for InlineStatusSelect — inline status <select> for the user table.
 * Covers optimistic update, rollback on failure, invited badge display,
 * canEdit=false read-only mode, and self-deactivation confirmation.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { InlineStatusSelect } from './InlineStatusSelect.js';
import type { UserResponse } from '@shared/schemas/userSchema.js';

const ACTIVE_USER: UserResponse = {
  id: 'user-active-1',
  email: 'active@example.com',
  name: 'Active User',
  role: 'rep',
  status: 'active',
  must_change_password: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

const INACTIVE_USER: UserResponse = {
  ...ACTIVE_USER,
  id: 'user-inactive-1',
  status: 'inactive',
};

const INVITED_USER: UserResponse = {
  ...ACTIVE_USER,
  id: 'user-invited-1',
  status: 'invited',
};

/** Default handler for the status PATCH endpoint — not in global handlers */
function useStatusPatchSuccess(overrideUser: UserResponse = ACTIVE_USER) {
  server.use(
    http.patch('/api/v1/users/:id/status', async ({ params, request }) => {
      const body = (await request.json()) as { active: boolean };
      return HttpResponse.json({
        user: {
          ...overrideUser,
          id: params.id as string,
          status: body.active ? 'active' : 'inactive',
        },
      });
    }),
  );
}

function defaultProps(overrides: Partial<React.ComponentProps<typeof InlineStatusSelect>> = {}) {
  return {
    user: ACTIVE_USER,
    canEdit: true,
    currentUserId: 'admin-other',
    usersQueryKey: ['users'] as const,
    onStatusError: vi.fn(),
    ...overrides,
  };
}

describe('InlineStatusSelect', () => {
  it('active user shows select with Active/Inactive options', () => {
    renderWithProviders(<InlineStatusSelect {...defaultProps()} />);

    const select = screen.getByTestId(`status-select-${ACTIVE_USER.id}`);
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('active');
  });

  it('inactive user shows select defaulting to inactive', () => {
    renderWithProviders(<InlineStatusSelect {...defaultProps({ user: INACTIVE_USER })} />);

    expect(screen.getByTestId(`status-select-${INACTIVE_USER.id}`)).toHaveValue('inactive');
  });

  it('invited user shows read-only badge with tooltip text (no select)', () => {
    renderWithProviders(<InlineStatusSelect {...defaultProps({ user: INVITED_USER })} />);

    expect(screen.queryByTestId(`status-select-${INVITED_USER.id}`)).not.toBeInTheDocument();
    const badge = screen.getByTestId(`status-invited-${INVITED_USER.id}`);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title');
  });

  it('canEdit=false renders a disabled select', () => {
    renderWithProviders(<InlineStatusSelect {...defaultProps({ canEdit: false })} />);

    expect(screen.getByTestId(`status-select-${ACTIVE_USER.id}`)).toBeDisabled();
  });

  it('changing active to inactive fires PATCH and updates optimistically', async () => {
    useStatusPatchSuccess();
    renderWithProviders(<InlineStatusSelect {...defaultProps()} />);

    const select = screen.getByTestId(`status-select-${ACTIVE_USER.id}`);
    fireEvent.change(select, { target: { value: 'inactive' } });

    // Optimistic update is synchronous
    expect(select).toHaveValue('inactive');

    await waitFor(() => expect(select).not.toBeDisabled());
  });

  it('failed PATCH rolls back to old status and calls onStatusError', async () => {
    server.use(
      http.patch('/api/v1/users/:id/status', () => {
        return HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
          { status: 403 },
        );
      }),
    );

    const onStatusError = vi.fn();
    renderWithProviders(<InlineStatusSelect {...defaultProps({ onStatusError })} />);

    const select = screen.getByTestId(`status-select-${ACTIVE_USER.id}`);
    fireEvent.change(select, { target: { value: 'inactive' } });

    await waitFor(() => {
      expect(select).toHaveValue('active');
    });
    expect(onStatusError).toHaveBeenCalledOnce();
  });

  it('self-deactivation shows confirmation dialog instead of immediately firing PATCH', () => {
    renderWithProviders(
      <InlineStatusSelect
        {...defaultProps({ user: ACTIVE_USER, currentUserId: ACTIVE_USER.id })}
      />,
    );

    const select = screen.getByTestId(`status-select-${ACTIVE_USER.id}`);
    fireEvent.change(select, { target: { value: 'inactive' } });

    expect(screen.getByTestId('deactivate-self-dialog')).toBeInTheDocument();
  });

  it('clicking close in self-deactivation blocked dialog dismisses it without firing PATCH', async () => {
    const onStatusError = vi.fn();
    renderWithProviders(
      <InlineStatusSelect
        {...defaultProps({
          user: ACTIVE_USER,
          currentUserId: ACTIVE_USER.id,
          onStatusError,
        })}
      />,
    );

    const select = screen.getByTestId(`status-select-${ACTIVE_USER.id}`);
    fireEvent.change(select, { target: { value: 'inactive' } });
    fireEvent.click(screen.getByTestId('deactivate-self-close'));

    await waitFor(() => {
      expect(screen.queryByTestId('deactivate-self-dialog')).not.toBeInTheDocument();
    });
    // Select stays at 'active' — no mutation fired, no error
    expect(select).toHaveValue('active');
    expect(onStatusError).not.toHaveBeenCalled();
  });
});
