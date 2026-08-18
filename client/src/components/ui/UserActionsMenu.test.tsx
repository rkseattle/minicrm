/**
 * Tests for UserActionsMenu — meatball menu for per-row user admin actions.
 * Role changes are now handled by InlineRoleSelect; this menu
 * covers password, onboarding-reset, activation, and service-account token actions.
 *
 * Verifies:
 * - Trigger button renders with correct aria attributes
 * - Menu is closed by default
 * - Clicking trigger calls onToggle
 * - Set Password shown for active/invited users; absent for inactive
 * - Clicking Set Password calls onSetPassword
 * - Deactivate shown for active users; Reactivate shown for inactive
 * - Clicking Deactivate calls onDeactivate
 * - Clicking Reactivate calls onReactivate
 * - isPending disables the trigger button
 * - Escape key closes the menu via onToggle
 * - Make Admin / Make Rep items are NOT present
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { UserActionsMenu } from './UserActionsMenu.js';
import type { UserResponse } from '@shared/schemas/userSchema.js';

const ACTIVE_REP: UserResponse = {
  id: 'user-rep',
  email: 'rep@example.com',
  name: 'Rep User',
  role: 'rep',
  status: 'active',
  must_change_password: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

const ACTIVE_ADMIN: UserResponse = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  status: 'active',
  must_change_password: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

const INACTIVE_REP: UserResponse = {
  ...ACTIVE_REP,
  id: 'user-inactive',
  status: 'inactive',
};

function defaultProps(overrides: Partial<Parameters<typeof UserActionsMenu>[0]> = {}) {
  return {
    user: ACTIVE_REP,
    isPending: false,
    onSetPassword: vi.fn(),
    onDeactivate: vi.fn(),
    onReactivate: vi.fn(),
    onResetOnboarding: vi.fn(),
    currentUserId: 'other-admin-id',
    isOpen: false,
    onToggle: vi.fn(),
    ...overrides,
  };
}

describe('UserActionsMenu', () => {
  it('renders the trigger button', () => {
    renderWithProviders(<UserActionsMenu {...defaultProps()} />);

    expect(screen.getByTestId(`user-actions-${ACTIVE_REP.id}`)).toBeInTheDocument();
  });

  it('has aria-expanded=false when closed', () => {
    renderWithProviders(<UserActionsMenu {...defaultProps({ isOpen: false })} />);

    expect(screen.getByTestId(`user-actions-${ACTIVE_REP.id}`)).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('has aria-expanded=true when open', () => {
    renderWithProviders(<UserActionsMenu {...defaultProps({ isOpen: true })} />);

    expect(screen.getByTestId(`user-actions-${ACTIVE_REP.id}`)).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('clicking trigger calls onToggle with user id', () => {
    const onToggle = vi.fn();
    renderWithProviders(<UserActionsMenu {...defaultProps({ onToggle })} />);

    fireEvent.click(screen.getByTestId(`user-actions-${ACTIVE_REP.id}`));

    expect(onToggle).toHaveBeenCalledWith(ACTIVE_REP.id);
  });

  it('disables the trigger button when isPending is true', () => {
    renderWithProviders(<UserActionsMenu {...defaultProps({ isPending: true })} />);

    expect(screen.getByTestId(`user-actions-${ACTIVE_REP.id}`)).toBeDisabled();
  });

  it('does not render menu items when closed', () => {
    renderWithProviders(<UserActionsMenu {...defaultProps({ isOpen: false })} />);

    expect(screen.queryByTestId(`set-password-toggle-${ACTIVE_REP.id}`)).not.toBeInTheDocument();
  });

  it('does not render Make Admin or Make Rep items', () => {
    renderWithProviders(<UserActionsMenu {...defaultProps({ isOpen: true })} />);

    expect(screen.queryByTestId(`make-admin-${ACTIVE_REP.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`make-rep-${ACTIVE_REP.id}`)).not.toBeInTheDocument();
  });

  it('does not render Make Rep for admin user', () => {
    renderWithProviders(
      <UserActionsMenu {...defaultProps({ user: ACTIVE_ADMIN, isOpen: true })} />,
    );

    expect(screen.queryByTestId(`make-rep-${ACTIVE_ADMIN.id}`)).not.toBeInTheDocument();
  });

  describe('when open with a rep user', () => {
    it('shows Set Password option for active rep', () => {
      renderWithProviders(<UserActionsMenu {...defaultProps({ isOpen: true })} />);

      expect(screen.getByTestId(`set-password-toggle-${ACTIVE_REP.id}`)).toBeInTheDocument();
    });

    it('clicking Set Password calls onSetPassword', () => {
      const onSetPassword = vi.fn();
      renderWithProviders(<UserActionsMenu {...defaultProps({ isOpen: true, onSetPassword })} />);

      fireEvent.click(screen.getByTestId(`set-password-toggle-${ACTIVE_REP.id}`));

      expect(onSetPassword).toHaveBeenCalledWith(ACTIVE_REP.id);
    });

    it('shows Deactivate option for active rep', () => {
      renderWithProviders(<UserActionsMenu {...defaultProps({ isOpen: true })} />);

      expect(screen.getByTestId(`deactivate-${ACTIVE_REP.id}`)).toBeInTheDocument();
    });

    it('clicking Deactivate calls onDeactivate', () => {
      const onDeactivate = vi.fn();
      renderWithProviders(<UserActionsMenu {...defaultProps({ isOpen: true, onDeactivate })} />);

      fireEvent.click(screen.getByTestId(`deactivate-${ACTIVE_REP.id}`));

      expect(onDeactivate).toHaveBeenCalledWith(ACTIVE_REP.id);
    });
  });

  describe('when open with an inactive user', () => {
    it('shows Reactivate option', () => {
      renderWithProviders(
        <UserActionsMenu {...defaultProps({ user: INACTIVE_REP, isOpen: true })} />,
      );

      expect(screen.getByTestId(`reactivate-${INACTIVE_REP.id}`)).toBeInTheDocument();
    });

    it('does not show Set Password for inactive user', () => {
      renderWithProviders(
        <UserActionsMenu {...defaultProps({ user: INACTIVE_REP, isOpen: true })} />,
      );

      expect(
        screen.queryByTestId(`set-password-toggle-${INACTIVE_REP.id}`),
      ).not.toBeInTheDocument();
    });

    it('clicking Reactivate calls onReactivate', () => {
      const onReactivate = vi.fn();
      renderWithProviders(
        <UserActionsMenu {...defaultProps({ user: INACTIVE_REP, isOpen: true, onReactivate })} />,
      );

      fireEvent.click(screen.getByTestId(`reactivate-${INACTIVE_REP.id}`));

      expect(onReactivate).toHaveBeenCalledWith(INACTIVE_REP.id);
    });
  });

  it('Escape key on the menu triggers onToggle to close', () => {
    const onToggle = vi.fn();
    renderWithProviders(<UserActionsMenu {...defaultProps({ isOpen: true, onToggle })} />);

    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });

    expect(onToggle).toHaveBeenCalledWith(ACTIVE_REP.id);
  });

  describe('Reset onboarding action', () => {
    it('shows Reset onboarding when user is not the current user', () => {
      renderWithProviders(
        <UserActionsMenu
          {...defaultProps({ user: ACTIVE_REP, currentUserId: 'other-admin-id', isOpen: true })}
        />,
      );

      expect(screen.getByTestId(`reset-onboarding-${ACTIVE_REP.id}`)).toBeInTheDocument();
    });

    it('hides Reset onboarding for the current admin own row', () => {
      renderWithProviders(
        <UserActionsMenu
          {...defaultProps({ user: ACTIVE_REP, currentUserId: ACTIVE_REP.id, isOpen: true })}
        />,
      );

      expect(screen.queryByTestId(`reset-onboarding-${ACTIVE_REP.id}`)).not.toBeInTheDocument();
    });

    it('clicking Reset onboarding calls onResetOnboarding with user id', () => {
      const onResetOnboarding = vi.fn();
      renderWithProviders(
        <UserActionsMenu
          {...defaultProps({
            user: ACTIVE_REP,
            currentUserId: 'other-admin-id',
            isOpen: true,
            onResetOnboarding,
          })}
        />,
      );

      fireEvent.click(screen.getByTestId(`reset-onboarding-${ACTIVE_REP.id}`));

      expect(onResetOnboarding).toHaveBeenCalledWith(ACTIVE_REP.id);
    });
  });
});
