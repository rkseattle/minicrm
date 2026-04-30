/**
 * Tests for OwnerSelect — select populated with active users for owner assignment.
 *
 * Verifies:
 * - Renders a select with the label
 * - Active users appear as options
 * - Selecting a different user calls onChange
 * - Unknown owner shows a disabled placeholder option
 * - No unknown placeholder when the value is in the user list
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../test/renderWithProviders.js';
import OwnerSelect from './OwnerSelect.js';

const USERS = [
  { id: 'user-1', name: 'Alice Smith' },
  { id: 'user-2', name: 'Bob Jones' },
];

describe('OwnerSelect', () => {
  it('renders a select element with the given label', () => {
    renderWithProviders(
      <OwnerSelect
        id="owner"
        label="Owner"
        users={USERS}
        value="user-1"
        unknownLabel="Unknown owner"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Owner')).toBeInTheDocument();
  });

  it('renders all active users as options', () => {
    renderWithProviders(
      <OwnerSelect
        id="owner"
        label="Owner"
        users={USERS}
        value="user-1"
        unknownLabel="Unknown owner"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: 'Alice Smith' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bob Jones' })).toBeInTheDocument();
  });

  it('has the correct option selected', () => {
    renderWithProviders(
      <OwnerSelect
        id="owner"
        label="Owner"
        users={USERS}
        value="user-2"
        unknownLabel="Unknown owner"
        onChange={vi.fn()}
      />,
    );

    const select = screen.getByLabelText('Owner') as HTMLSelectElement;
    expect(select.value).toBe('user-2');
  });

  it('calls onChange when a different user is selected', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <OwnerSelect
        id="owner"
        label="Owner"
        users={USERS}
        value="user-1"
        unknownLabel="Unknown owner"
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'user-2' } });

    expect(onChange).toHaveBeenCalled();
  });

  it('shows a disabled placeholder option when the current value is not in the user list', () => {
    renderWithProviders(
      <OwnerSelect
        id="owner"
        label="Owner"
        users={USERS}
        value="user-deactivated"
        unknownLabel="Deactivated user"
        onChange={vi.fn()}
      />,
    );

    const unknownOption = screen.getByRole('option', { name: 'Deactivated user' });
    expect(unknownOption).toBeInTheDocument();
    expect(unknownOption).toBeDisabled();
  });

  it('does not show unknown placeholder when value matches a user', () => {
    renderWithProviders(
      <OwnerSelect
        id="owner"
        label="Owner"
        users={USERS}
        value="user-1"
        unknownLabel="Deactivated user"
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('option', { name: 'Deactivated user' })).not.toBeInTheDocument();
  });

  it('does not show unknown placeholder when value is empty', () => {
    renderWithProviders(
      <OwnerSelect
        id="owner"
        label="Owner"
        users={USERS}
        value=""
        unknownLabel="Unknown owner"
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('option', { name: 'Unknown owner' })).not.toBeInTheDocument();
  });
});
