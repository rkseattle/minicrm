/**
 * Tests for FeatureFlagsSettings — admin feature flag registry UI. (MINCRM-463)
 *
 * Verifies: loading state, error state, empty state, flag list rendering,
 * toggle confirmation dialog, role override matrix, and mutation success/error paths.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { FEATURE_FLAGS_FIXTURE } from '../../test/msw/handlers.js';
import FeatureFlagsSettings from './FeatureFlagsSettings.js';

describe('FeatureFlagsSettings', () => {
  // ── Loading state ───────────────────────────────────────────────────────────

  it('shows loading skeleton before data arrives', async () => {
    server.use(
      http.get('/api/v1/admin/feature-flags', async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ flags: FEATURE_FLAGS_FIXTURE });
      }),
    );

    renderWithProviders(<FeatureFlagsSettings />);
    expect(screen.getByTestId('feature-flags-loading')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId('feature-flags-loading')).not.toBeInTheDocument();
    });
  });

  // ── Error state ─────────────────────────────────────────────────────────────

  it('shows error state when fetch fails', async () => {
    server.use(
      http.get('/api/v1/admin/feature-flags', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flags-error')).toBeInTheDocument();
    });
  });

  // ── Empty state ─────────────────────────────────────────────────────────────

  it('shows empty state when the server returns no flags', async () => {
    server.use(http.get('/api/v1/admin/feature-flags', () => HttpResponse.json({ flags: [] })));

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flags-empty')).toBeInTheDocument();
    });
  });

  // ── Flag list rendering ─────────────────────────────────────────────────────

  it('renders flag rows grouped by category', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flags-list')).toBeInTheDocument();
    });

    // Notes flag row
    expect(screen.getByTestId('feature-flag-row-notes')).toBeInTheDocument();
    // Reporting flag row
    expect(screen.getByTestId('feature-flag-row-reporting')).toBeInTheDocument();
    // Mobile access flag row (disabled)
    expect(screen.getByTestId('feature-flag-row-mobile_access')).toBeInTheDocument();
  });

  it('shows OFF badge for disabled flags', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-badge-off-mobile_access')).toBeInTheDocument();
    });

    // Enabled flags must not have an OFF badge
    expect(screen.queryByTestId('feature-flag-badge-off-notes')).not.toBeInTheDocument();
  });

  it('toggle switch reflects enabled state', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-toggle-notes')).toBeInTheDocument();
    });

    const notesToggle = screen.getByTestId('feature-flag-toggle-notes');
    expect(notesToggle).toHaveAttribute('aria-checked', 'true');

    const mobileToggle = screen.getByTestId('feature-flag-toggle-mobile_access');
    expect(mobileToggle).toHaveAttribute('aria-checked', 'false');
  });

  it('renders role override matrix only for flags that support it', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-role-overrides-reporting')).toBeInTheDocument();
    });

    // notes does not support role overrides
    expect(screen.queryByTestId('feature-flag-role-overrides-notes')).not.toBeInTheDocument();
  });

  it('role override checkboxes reflect role_overrides values', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-role-override-reporting-admin')).toBeInTheDocument();
    });

    const adminCheckbox = screen.getByTestId('feature-flag-role-override-reporting-admin');
    const repCheckbox = screen.getByTestId('feature-flag-role-override-reporting-rep');

    // Fixture has admin=true, rep=true
    expect(adminCheckbox).toBeChecked();
    expect(repCheckbox).toBeChecked();
  });

  // ── Confirmation dialog ─────────────────────────────────────────────────────

  it('shows confirmation dialog when toggle is clicked', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-toggle-notes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('feature-flag-toggle-notes'));

    expect(screen.getByTestId('feature-flag-confirm-dialog')).toBeInTheDocument();
  });

  it('cancels without mutation when cancel is clicked', async () => {
    let patchCalled = false;
    server.use(
      http.patch('/api/v1/admin/feature-flags/:key', () => {
        patchCalled = true;
        return HttpResponse.json({ flag: FEATURE_FLAGS_FIXTURE[0] });
      }),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-toggle-notes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('feature-flag-toggle-notes'));
    expect(screen.getByTestId('feature-flag-confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('feature-flag-confirm-cancel'));

    expect(screen.queryByTestId('feature-flag-confirm-dialog')).not.toBeInTheDocument();
    expect(patchCalled).toBe(false);
  });

  it('fires mutation and closes dialog when confirm is clicked', async () => {
    let patchedKey: string | undefined;
    server.use(
      http.patch('/api/v1/admin/feature-flags/:key', async ({ params, request }) => {
        patchedKey = params['key'] as string;
        const body = (await request.json()) as { enabled: boolean };
        return HttpResponse.json({
          flag: { ...FEATURE_FLAGS_FIXTURE[0], enabled: body.enabled },
        });
      }),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-toggle-notes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('feature-flag-toggle-notes'));
    fireEvent.click(screen.getByTestId('feature-flag-confirm-ok'));

    await waitFor(() => {
      expect(screen.queryByTestId('feature-flag-confirm-dialog')).not.toBeInTheDocument();
    });
    expect(patchedKey).toBe('notes');
  });

  it('shows active users warning in dialog when disabling a flag with active users', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-toggle-reporting')).toBeInTheDocument();
    });

    // Reporting fixture has active_user_count: 3 and is currently enabled — clicking disables it
    fireEvent.click(screen.getByTestId('feature-flag-toggle-reporting'));

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-confirm-dialog')).toBeInTheDocument();
    });

    // Active users warning should appear because active_user_count >= 1 and we're disabling
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  // ── Save error ──────────────────────────────────────────────────────────────

  it('shows save error message when mutation fails', async () => {
    server.use(
      http.patch('/api/v1/admin/feature-flags/:key', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-toggle-notes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('feature-flag-toggle-notes'));
    fireEvent.click(screen.getByTestId('feature-flag-confirm-ok'));

    await waitFor(() => {
      expect(screen.queryByTestId('feature-flag-confirm-dialog')).not.toBeInTheDocument();
    });

    // The mutation error causes a save error message to appear
    // The error message is shown inline (not a testid — check by the i18n key fallback text)
    // Since i18n is set up in tests, the translated text will be rendered
    await waitFor(() => {
      expect(screen.getByText(/save|error/i)).toBeInTheDocument();
    });
  });
});
