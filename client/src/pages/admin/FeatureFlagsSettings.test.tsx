/**
 * Tests for FeatureFlagsSettings — admin feature flag registry UI.
 * Covers: loading/error/empty states, flag list rendering, toggle confirmation dialog,
 * role override matrix, save error, scheduled enable_at (MINCRM-488), beta users panel (MINCRM-489).
 * (MINCRM-463, MINCRM-488, MINCRM-489)
 */

import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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

  it('shows role override error indicator when custom roles fetch fails', async () => {
    server.use(http.get('/api/v1/custom-roles', () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-role-overrides-error-notes')).toBeInTheDocument();
    });
    // Loading indicator must not remain visible
    expect(
      screen.queryByTestId('feature-flag-role-overrides-loading-notes'),
    ).not.toBeInTheDocument();
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

  // MINCRM-565: every flag now shows a role override panel (no longer restricted to an allowlist)
  it('renders role override panel for all flags, including notes', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-role-overrides-reporting')).toBeInTheDocument();
    });

    // notes flag also shows role override panel (MINCRM-565 — no more ROLE_OVERRIDE_FLAG_KEYS)
    expect(screen.getByTestId('feature-flag-role-overrides-notes')).toBeInTheDocument();
    // Role checkboxes default to flag.enabled since role_overrides is null for notes
    expect(screen.getByTestId('feature-flag-role-override-notes-admin')).toBeInTheDocument();
    expect(screen.getByTestId('feature-flag-role-override-notes-rep')).toBeInTheDocument();
  });

  // MINCRM-460: AI sub-feature flags also render role override matrix
  it('renders role override matrix for AI sub-feature flags', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-role-overrides-ai_nli_page')).toBeInTheDocument();
    });

    // Admin and rep checkboxes should be present for ai_nli_page
    expect(screen.getByTestId('feature-flag-role-override-ai_nli_page-admin')).toBeInTheDocument();
    expect(screen.getByTestId('feature-flag-role-override-ai_nli_page-rep')).toBeInTheDocument();
  });

  it('AI sub-feature role override checkboxes reflect fixture values', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(
        screen.getByTestId('feature-flag-role-override-ai_nli_page-admin'),
      ).toBeInTheDocument();
    });

    // Fixture has admin=true, rep=true for all AI sub-feature flags
    expect(screen.getByTestId('feature-flag-role-override-ai_nli_page-admin')).toBeChecked();
    expect(screen.getByTestId('feature-flag-role-override-ai_nli_page-rep')).toBeChecked();
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

  // MINCRM-565: stale role keys from deleted custom roles are stripped before PATCH
  it('strips other stale role keys when removing one stale role override', async () => {
    // Fixture: reporting has two stale keys ('stale_a', 'stale_b') not in custom-roles.
    // Clicking Remove on 'stale_a' must send a payload that omits both stale keys,
    // not just the targeted one, to avoid a 422 FEATURE_FLAG_UNKNOWN_ROLE_KEY.
    server.use(
      http.get('/api/v1/admin/feature-flags', () =>
        HttpResponse.json({
          flags: FEATURE_FLAGS_FIXTURE.map((f) =>
            f.flag_key === 'reporting'
              ? { ...f, role_overrides: { admin: true, rep: true, stale_a: false, stale_b: false } }
              : f,
          ),
        }),
      ),
    );

    let sentBody: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/v1/admin/feature-flags/:key', async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        const flag = FEATURE_FLAGS_FIXTURE.find((f) => f.flag_key === 'reporting')!;
        return HttpResponse.json({ flag: { ...flag, role_overrides: sentBody['role_overrides'] } });
      }),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    // Stale key remove button only appears for keys not present in allRoles
    await waitFor(() => {
      expect(
        screen.getByTestId('feature-flag-role-override-remove-reporting-stale_a'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('feature-flag-role-override-remove-reporting-stale_a'));

    await waitFor(() => {
      expect(sentBody).not.toBeNull();
    });

    // Neither stale key should appear in the payload — only known roles survive the filter
    const overrides = sentBody!['role_overrides'] as Record<string, boolean>;
    expect(overrides).not.toHaveProperty('stale_a');
    expect(overrides).not.toHaveProperty('stale_b');
    expect(overrides['admin']).toBe(true);
    expect(overrides['rep']).toBe(true);
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

    await waitFor(() => {
      expect(screen.getByText(/save|error/i)).toBeInTheDocument();
    });
  });

  // ── Scheduled enable_at (MINCRM-488) ────────────────────────────────────────

  it('shows Scheduled badge when enable_at is set and flag is disabled', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    server.use(
      http.get('/api/v1/admin/feature-flags', () =>
        HttpResponse.json({
          flags: FEATURE_FLAGS_FIXTURE.map((f) =>
            f.flag_key === 'mobile_access' ? { ...f, enabled: false, enable_at: futureDate } : f,
          ),
        }),
      ),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-badge-scheduled-mobile_access')).toBeInTheDocument();
    });

    // Off badge must NOT be shown when Scheduled badge is shown
    expect(screen.queryByTestId('feature-flag-badge-off-mobile_access')).not.toBeInTheDocument();
  });

  it('does not show Scheduled badge when enable_at is null', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-row-mobile_access')).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId('feature-flag-badge-scheduled-mobile_access'),
    ).not.toBeInTheDocument();
    // Off badge should be present since enabled=false and no schedule
    expect(screen.getByTestId('feature-flag-badge-off-mobile_access')).toBeInTheDocument();
  });

  it('shows datetime picker for disabled flags', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-enable-at-input-mobile_access')).toBeInTheDocument();
    });
  });

  it('does not show datetime picker for enabled flags', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-row-notes')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('feature-flag-enable-at-input-notes')).not.toBeInTheDocument();
  });

  it('shows Clear schedule button when enable_at is set', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    server.use(
      http.get('/api/v1/admin/feature-flags', () =>
        HttpResponse.json({
          flags: FEATURE_FLAGS_FIXTURE.map((f) =>
            f.flag_key === 'mobile_access' ? { ...f, enabled: false, enable_at: futureDate } : f,
          ),
        }),
      ),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-enable-at-clear-mobile_access')).toBeInTheDocument();
    });
  });

  it('sends enable_at: null when Clear schedule is clicked and confirmed', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    let patchBody: Record<string, unknown> | null = null;

    server.use(
      http.get('/api/v1/admin/feature-flags', () =>
        HttpResponse.json({
          flags: FEATURE_FLAGS_FIXTURE.map((f) =>
            f.flag_key === 'mobile_access' ? { ...f, enabled: false, enable_at: futureDate } : f,
          ),
        }),
      ),
      http.patch('/api/v1/admin/feature-flags/:key', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        const flag = FEATURE_FLAGS_FIXTURE.find((f) => f.flag_key === 'mobile_access')!;
        return HttpResponse.json({ flag: { ...flag, enable_at: null } });
      }),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-enable-at-clear-mobile_access')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('feature-flag-enable-at-clear-mobile_access'));

    // enable_at changes now route through the confirm dialog
    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-confirm-dialog')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('feature-flag-confirm-ok'));

    await waitFor(() => {
      expect(patchBody).not.toBeNull();
    });
    expect(patchBody!['enable_at']).toBeNull();
  });

  it('shows Fired badge and On state when enable_at is in the past', async () => {
    const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    server.use(
      http.get('/api/v1/admin/feature-flags', () =>
        HttpResponse.json({
          flags: FEATURE_FLAGS_FIXTURE.map((f) =>
            f.flag_key === 'mobile_access' ? { ...f, enabled: false, enable_at: pastDate } : f,
          ),
        }),
      ),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-badge-on-mobile_access')).toBeInTheDocument();
    });

    // Scheduled badge must NOT appear for a fired schedule
    expect(
      screen.queryByTestId('feature-flag-badge-scheduled-mobile_access'),
    ).not.toBeInTheDocument();
    // Off badge must NOT appear
    expect(screen.queryByTestId('feature-flag-badge-off-mobile_access')).not.toBeInTheDocument();
  });

  // ── Beta users panel (MINCRM-489) ────────────────────────────────────────────

  it('shows beta user count badge when beta_user_count > 0', async () => {
    server.use(
      http.get('/api/v1/admin/feature-flags', () =>
        HttpResponse.json({
          flags: FEATURE_FLAGS_FIXTURE.map((f) =>
            f.flag_key === 'mobile_access' ? { ...f, beta_user_count: 2 } : f,
          ),
        }),
      ),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-beta-count-mobile_access')).toBeInTheDocument();
    });
  });

  it('does not show beta count badge when beta_user_count is 0', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-row-mobile_access')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('feature-flag-beta-count-mobile_access')).not.toBeInTheDocument();
  });

  it('shows empty beta panel with search box', async () => {
    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-advanced-toggle-mobile_access')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('feature-flag-advanced-toggle-mobile_access'));

    await waitFor(() => {
      expect(screen.getByTestId('beta-user-search-mobile_access')).toBeInTheDocument();
    });

    expect(screen.getByTestId('feature-flag-beta-panel-mobile_access')).toBeInTheDocument();
  });

  it('shows enrolled users returned from GET beta-users', async () => {
    server.use(
      http.get('/api/v1/admin/feature-flags/:key/beta-users', () =>
        HttpResponse.json({
          users: [
            {
              id: 'entry-1',
              user_id: 'user-uuid-1',
              name: 'Alice Beta',
              email: 'alice@example.com',
              added_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    );

    renderWithProviders(<FeatureFlagsSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('feature-flag-advanced-toggle-mobile_access')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('feature-flag-advanced-toggle-mobile_access'));

    const betaRow = await screen.findByTestId('beta-user-row-mobile_access-user-uuid-1');
    expect(betaRow).toBeInTheDocument();
    expect(within(betaRow).getByText('Alice Beta')).toBeInTheDocument();
  });
});
