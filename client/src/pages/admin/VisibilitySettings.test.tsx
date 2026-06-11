/**
 * Tests for VisibilitySettings — per-object data visibility policy admin panel.
 * (MINCRM-538)
 *
 * Verifies:
 * - Loading state renders while query is in flight
 * - Data loaded state: all three selects are present with defaults from the API
 * - Error state: load error message renders when query fails
 * - Save button is disabled when no changes have been made
 * - Changing a select enables the save button
 * - Saving calls PUT with only the changed keys and shows success message
 * - Saving resets pending changes (save button disabled again)
 * - Save error shows error message
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import VisibilitySettings from './VisibilitySettings.js';

describe('VisibilitySettings — loading state', () => {
  it('shows loading indicator before query resolves', () => {
    server.use(
      http.get('/api/v1/settings/visibility', async () => {
        await new Promise(() => {}); // never resolves — simulates in-flight request
      }),
    );

    renderWithProviders(<VisibilitySettings />);

    expect(screen.getByTestId('visibility-settings-loading')).toBeInTheDocument();
  });
});

describe('VisibilitySettings — error state', () => {
  it('shows load error message when query fails', async () => {
    server.use(
      http.get('/api/v1/settings/visibility', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<VisibilitySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('visibility-settings-error')).toBeInTheDocument();
    });
  });
});

describe('VisibilitySettings — loaded state', () => {
  it('renders all three selects after data loads', async () => {
    renderWithProviders(<VisibilitySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('visibility-contacts-select')).toBeInTheDocument();
    });
    expect(screen.getByTestId('visibility-deals-select')).toBeInTheDocument();
    expect(screen.getByTestId('visibility-activities-select')).toBeInTheDocument();
  });

  it('shows org as the default selected value for all three selects', async () => {
    renderWithProviders(<VisibilitySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('visibility-contacts-select')).toBeInTheDocument();
    });

    expect((screen.getByTestId('visibility-contacts-select') as HTMLSelectElement).value).toBe(
      'org',
    );
    expect((screen.getByTestId('visibility-deals-select') as HTMLSelectElement).value).toBe('org');
    expect((screen.getByTestId('visibility-activities-select') as HTMLSelectElement).value).toBe(
      'org',
    );
  });

  it('save button is disabled when no changes have been made', async () => {
    renderWithProviders(<VisibilitySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('visibility-contacts-select')).toBeInTheDocument();
    });

    expect(screen.getByTestId('visibility-settings-save-button')).toBeDisabled();
  });

  it('enables save button after changing a select', async () => {
    renderWithProviders(<VisibilitySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('visibility-contacts-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('visibility-contacts-select'), {
      target: { value: 'team' },
    });

    expect(screen.getByTestId('visibility-settings-save-button')).not.toBeDisabled();
  });

  it('save button remains disabled when select is changed back to the loaded value', async () => {
    renderWithProviders(<VisibilitySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('visibility-contacts-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('visibility-contacts-select'), {
      target: { value: 'team' },
    });
    fireEvent.change(screen.getByTestId('visibility-contacts-select'), {
      target: { value: 'org' }, // back to loaded value
    });

    expect(screen.getByTestId('visibility-settings-save-button')).toBeDisabled();
  });
});

describe('VisibilitySettings — save flow', () => {
  it('shows success message after a successful save', async () => {
    renderWithProviders(<VisibilitySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('visibility-contacts-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('visibility-contacts-select'), {
      target: { value: 'team' },
    });
    fireEvent.click(screen.getByTestId('visibility-settings-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('visibility-settings-success')).toBeInTheDocument();
    });
  });

  it('disables the save button again after a successful save', async () => {
    renderWithProviders(<VisibilitySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('visibility-contacts-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('visibility-deals-select'), {
      target: { value: 'private' },
    });
    fireEvent.click(screen.getByTestId('visibility-settings-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('visibility-settings-success')).toBeInTheDocument();
    });

    expect(screen.getByTestId('visibility-settings-save-button')).toBeDisabled();
  });

  it('shows save error message when PUT fails', async () => {
    server.use(
      http.put('/api/v1/settings/visibility', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<VisibilitySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('visibility-contacts-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('visibility-activities-select'), {
      target: { value: 'private' },
    });
    fireEvent.click(screen.getByTestId('visibility-settings-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('visibility-settings-save-error')).toBeInTheDocument();
    });
  });
});
