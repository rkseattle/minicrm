/**
 * Tests for AiSettings admin panel. (MINCRM-457)
 *
 * Covers:
 *  - Loading state
 *  - Error state
 *  - Default (no config) state renders all sections
 *  - Master toggle confirmation dialog flow
 *  - Deployment mode base URL field shown/hidden
 *  - API key masked display and change flow
 *  - DPA acknowledgment checkbox interaction
 *  - Test connection result display
 *  - DPA warning banner visibility
 *  - Self-hosted mode suppresses DPA acknowledgment
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import AiSettings from './AiSettings.js';

const DEFAULT_CONFIG = {
  enabled: false,
  enabled_updated_at: null,
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  api_key_set: false,
  deployment_mode: 'cloud_api',
  base_url: '',
  dpa_acknowledged: false,
  dpa_acknowledged_by: '',
  dpa_acknowledged_at: null,
  dpa_acknowledged_for_provider: '',
  custom_dpa_url: '',
  dpa_status: 'not_acknowledged',
  data_posture: 'amber',
  available_models: [
    {
      id: 'claude-sonnet-4-20250514',
      display_name: 'Claude Sonnet 4 (2025-05-14)',
      provider: 'anthropic',
    },
    { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8', provider: 'anthropic' },
  ],
  provider_dpa_url: 'https://www.anthropic.com/legal/data-processing-agreement',
};

// ── Loading state ─────────────────────────────────────────────────────────────

describe('AiSettings — loading state', () => {
  it('shows loading indicator while config is being fetched', () => {
    server.use(
      http.get(
        '/api/v1/admin/ai/config',
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );
    renderWithProviders(<AiSettings />);
    expect(screen.getByTestId('ai-settings-loading')).toBeInTheDocument();
  });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe('AiSettings — error state', () => {
  it('shows error message when config fetch fails', async () => {
    server.use(http.get('/api/v1/admin/ai/config', () => new HttpResponse(null, { status: 500 })));
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-settings-error')).toBeInTheDocument();
    });
  });
});

// ── Default / no-config state ─────────────────────────────────────────────────

describe('AiSettings — default state', () => {
  it('renders the panel with toggle, provider, DPA sections', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-settings-panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-master-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-select')).toBeInTheDocument();
    expect(screen.getByTestId('ai-model-select')).toBeInTheDocument();
    expect(screen.getByTestId('ai-test-connection-button')).toBeInTheDocument();
    expect(screen.getByTestId('ai-dpa-checkbox')).toBeInTheDocument();
  });

  it('shows the DPA warning banner when DPA is not acknowledged', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-dpa-warning-banner')).toBeInTheDocument();
    });
  });

  it('shows amber data posture badge', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-data-posture-badge')).toBeInTheDocument();
    });
  });
});

// ── Master toggle confirmation dialog ─────────────────────────────────────────

describe('AiSettings — master toggle', () => {
  it('shows confirmation dialog when toggle is clicked', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-master-toggle'));

    fireEvent.click(screen.getByTestId('ai-master-toggle'));
    expect(screen.getByTestId('ai-toggle-confirm-dialog')).toBeInTheDocument();
  });

  it('dismisses the dialog when cancel is clicked', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-master-toggle'));

    fireEvent.click(screen.getByTestId('ai-master-toggle'));
    expect(screen.getByTestId('ai-toggle-confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ai-toggle-cancel-button'));
    expect(screen.queryByTestId('ai-toggle-confirm-dialog')).not.toBeInTheDocument();
  });

  it('calls the toggle API and dismisses on confirm', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-master-toggle'));

    fireEvent.click(screen.getByTestId('ai-master-toggle'));
    fireEvent.click(screen.getByTestId('ai-toggle-confirm-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('ai-toggle-confirm-dialog')).not.toBeInTheDocument();
    });
  });
});

// ── Deployment mode base URL field ────────────────────────────────────────────

describe('AiSettings — deployment mode', () => {
  it('hides base URL field for cloud_api mode', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-settings-panel'));
    expect(screen.queryByTestId('ai-base-url-input')).not.toBeInTheDocument();
  });

  it('shows base URL field when private_endpoint is selected', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-settings-panel'));

    fireEvent.click(screen.getByTestId('ai-deployment-mode-radio-private_endpoint'));
    expect(screen.getByTestId('ai-base-url-input')).toBeInTheDocument();
  });

  it('shows base URL field when self_hosted is selected', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-settings-panel'));

    fireEvent.click(screen.getByTestId('ai-deployment-mode-radio-self_hosted'));
    expect(screen.getByTestId('ai-base-url-input')).toBeInTheDocument();
  });
});

// ── API key display ────────────────────────────────────────────────────────────

describe('AiSettings — API key', () => {
  it('shows the key input when no key is stored', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-api-key-input'));
    expect(screen.getByTestId('ai-api-key-input')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-api-key-masked')).not.toBeInTheDocument();
  });

  it('shows masked display and change button when a key is stored', async () => {
    server.use(
      http.get('/api/v1/admin/ai/config', () =>
        HttpResponse.json({ ...DEFAULT_CONFIG, api_key_set: true }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-api-key-masked')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-api-key-change-button')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-api-key-input')).not.toBeInTheDocument();
  });

  it('switches to input when Change button is clicked', async () => {
    server.use(
      http.get('/api/v1/admin/ai/config', () =>
        HttpResponse.json({ ...DEFAULT_CONFIG, api_key_set: true }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-api-key-change-button'));

    fireEvent.click(screen.getByTestId('ai-api-key-change-button'));
    expect(screen.getByTestId('ai-api-key-input')).toBeInTheDocument();
    expect(screen.getByTestId('ai-api-key-cancel-button')).toBeInTheDocument();
  });
});

// ── DPA acknowledgment ────────────────────────────────────────────────────────

describe('AiSettings — DPA acknowledgment', () => {
  it('shows not-acknowledged state by default', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-dpa-not-acknowledged-state')).toBeInTheDocument();
    });
  });

  it('shows acknowledged state when DPA is acknowledged', async () => {
    server.use(
      http.get('/api/v1/admin/ai/config', () =>
        HttpResponse.json({
          ...DEFAULT_CONFIG,
          dpa_acknowledged: true,
          dpa_acknowledged_by: 'Admin User',
          dpa_acknowledged_at: '2026-01-15T10:00:00.000Z',
          dpa_acknowledged_for_provider: 'anthropic',
          dpa_status: 'acknowledged',
          data_posture: 'green',
        }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-dpa-acknowledged-state')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ai-dpa-warning-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-dpa-checkbox')).not.toBeInTheDocument();
  });

  it('shows self-hosted notice and hides checkbox in self_hosted mode', async () => {
    server.use(
      http.get('/api/v1/admin/ai/config', () =>
        HttpResponse.json({
          ...DEFAULT_CONFIG,
          deployment_mode: 'self_hosted',
          data_posture: 'green',
        }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-dpa-self-hosted-notice')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ai-dpa-checkbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-dpa-warning-banner')).not.toBeInTheDocument();
  });
});

// ── Test connection ───────────────────────────────────────────────────────────

describe('AiSettings — test connection', () => {
  it('shows failure message when test-connection returns ok:false', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-test-connection-button'));

    fireEvent.click(screen.getByTestId('ai-test-connection-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-test-connection-result')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-test-connection-result').textContent).toContain('API key');
  });

  it('shows success message when test-connection returns ok:true', async () => {
    server.use(
      http.post('/api/v1/admin/ai/test-connection', () =>
        HttpResponse.json({ ok: true, message: 'Connection successful' }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-test-connection-button'));

    fireEvent.click(screen.getByTestId('ai-test-connection-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-test-connection-result')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-test-connection-result').textContent).toContain('successful');
  });
});

// ── DPA status badge colors ───────────────────────────────────────────────────

describe('AiSettings — DPA status badge', () => {
  beforeEach(() => {
    // covered by default config handler — not_acknowledged
  });

  it('shows the DPA status badge', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-dpa-status-badge')).toBeInTheDocument();
    });
  });
});

// ── Token budget section (MINCRM-458) ─────────────────────────────────────────

describe('AiSettings — token budget section', () => {
  it('renders the token budget section after data loads', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-token-budgets-section')).toBeInTheDocument();
    });
  });

  it('shows loading skeleton while budget data is fetching', async () => {
    server.use(
      http.get(
        '/api/v1/admin/ai/token-budgets',
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );
    renderWithProviders(<AiSettings />);
    // The page-level AI config fetch must complete before TokenBudgetSection renders.
    // Wait for the page to exit its top-level loading gate, then check the section skeleton.
    await waitFor(() => {
      expect(screen.queryByTestId('ai-settings-loading')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-token-budgets-loading')).toBeInTheDocument();
  });

  it('shows error state when budget fetch fails', async () => {
    server.use(
      http.get('/api/v1/admin/ai/token-budgets', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-token-budgets-error')).toBeInTheDocument();
    });
  });

  it('shows the org limit input and save button', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-org-monthly-limit-input')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-org-limit-save-button')).toBeInTheDocument();
  });

  it('renders per-user table when users are returned', async () => {
    server.use(
      http.get('/api/v1/admin/ai/token-budgets', () =>
        HttpResponse.json({
          org_monthly_limit: 100_000,
          org_used_this_month: 15_000,
          users: [
            {
              user_id: 'uid-1',
              user_name: 'Alice Admin',
              user_email: 'alice@example.com',
              user_role: 'admin',
              limit: null,
              used: 5000,
              percentage: null,
              status: 'ok',
            },
            {
              user_id: 'uid-2',
              user_name: 'Bob Rep',
              user_email: 'bob@example.com',
              user_role: 'rep',
              limit: 100_000,
              used: 10_000,
              percentage: 10,
              status: 'ok',
            },
          ],
        }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-budget-users-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('budget-row-uid-1')).toBeInTheDocument();
    expect(screen.getByTestId('budget-row-uid-2')).toBeInTheDocument();
  });

  it('shows success message after saving org limit', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-org-monthly-limit-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('ai-org-monthly-limit-input'), {
      target: { value: '500000' },
    });
    fireEvent.click(screen.getByTestId('ai-org-limit-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-org-limit-save-success')).toBeInTheDocument();
    });
  });
});

// ── Retention stats + manual purge (MINCRM-462) ───────────────────────────────

describe('AiSettings — retention stats and manual purge', () => {
  it('shows loading skeleton while stats are fetching', async () => {
    server.use(
      http.get(
        '/api/v1/admin/ai/retention-stats',
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.queryByTestId('ai-settings-loading')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-retention-stats-loading')).toBeInTheDocument();
  });

  it('shows error state when stats fetch fails', async () => {
    server.use(
      http.get('/api/v1/admin/ai/retention-stats', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-retention-stats-error')).toBeInTheDocument();
    });
  });

  it('renders session/message counts once loaded', async () => {
    server.use(
      http.get('/api/v1/admin/ai/retention-stats', () =>
        HttpResponse.json({ session_count: 12, message_count: 84 }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-retention-stats')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-retention-stats')).toHaveTextContent('12');
    expect(screen.getByTestId('ai-retention-stats')).toHaveTextContent('84');
  });

  it('shows the purge confirmation dialog when "Purge now" is clicked', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-purge-now-button'));
    fireEvent.click(screen.getByTestId('ai-purge-now-button'));
    expect(screen.getByTestId('ai-purge-confirm-dialog')).toBeInTheDocument();
  });

  it('cancels the purge dialog without calling the purge endpoint', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-purge-now-button'));
    fireEvent.click(screen.getByTestId('ai-purge-now-button'));
    fireEvent.click(screen.getByTestId('ai-purge-cancel-button'));
    expect(screen.queryByTestId('ai-purge-confirm-dialog')).not.toBeInTheDocument();
  });

  it('shows an accepted message after confirming the purge', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-purge-now-button'));
    fireEvent.click(screen.getByTestId('ai-purge-now-button'));
    fireEvent.click(screen.getByTestId('ai-purge-confirm-button'));
    await waitFor(() => {
      expect(screen.getByTestId('ai-purge-accepted')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ai-purge-confirm-dialog')).not.toBeInTheDocument();
  });

  it('shows an error message when the purge request fails', async () => {
    server.use(
      http.post('/api/v1/admin/ai/retention/purge', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => screen.getByTestId('ai-purge-now-button'));
    fireEvent.click(screen.getByTestId('ai-purge-now-button'));
    fireEvent.click(screen.getByTestId('ai-purge-confirm-button'));
    await waitFor(() => {
      expect(screen.getByTestId('ai-purge-error')).toBeInTheDocument();
    });
  });
});

// ── Data minimization section (MINCRM-461) ────────────────────────────────────

describe('AiSettings — data minimization section', () => {
  it('shows loading skeleton while field exclusions are fetching', async () => {
    server.use(
      http.get(
        '/api/v1/admin/ai/field-exclusions',
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.queryByTestId('ai-settings-loading')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-field-exclusions-loading')).toBeInTheDocument();
  });

  it('shows error state when field exclusions fetch fails', async () => {
    server.use(
      http.get('/api/v1/admin/ai/field-exclusions', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-field-exclusions-error')).toBeInTheDocument();
    });
  });

  it('renders always-excluded fields as locked entries', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-always-excluded-fields')).toBeInTheDocument();
    });
    expect(screen.getByTestId('always-excluded-field-password_hash')).toBeInTheDocument();
    expect(screen.getByTestId('always-excluded-field-ssn')).toBeInTheDocument();
  });

  it('renders standard fields with toggles', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-standard-fields-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('field-exclusion-toggle-contact-department')).toBeInTheDocument();
  });

  it('toggles a standard field exclusion on click', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.patch('/api/v1/admin/ai/field-exclusions', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(capturedBody);
      }),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('field-exclusion-toggle-contact-department')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('field-exclusion-toggle-contact-department'));

    await waitFor(() => {
      expect(capturedBody).toMatchObject({
        entity_type: 'contact',
        field_name: 'department',
        excluded: true,
      });
    });
  });

  it('shows a save error message when toggling fails', async () => {
    server.use(
      http.patch(
        '/api/v1/admin/ai/field-exclusions',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('field-exclusion-toggle-contact-department')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('field-exclusion-toggle-contact-department'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-field-exclusions-save-error')).toBeInTheDocument();
    });
  });

  it('shows the empty state when no custom fields are excluded', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-custom-fields-excluded-empty')).toBeInTheDocument();
    });
  });

  it('lists excluded custom fields when present', async () => {
    server.use(
      http.get('/api/v1/admin/ai/field-exclusions', () =>
        HttpResponse.json({
          always_excluded: ['password_hash'],
          standard_fields: [],
          custom_fields: [
            { entity_type: 'deal', field_name: 'InternalRiskScore', excluded: true },
            { entity_type: 'contact', field_name: 'Notes', excluded: false },
          ],
        }),
      ),
    );
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-custom-fields-excluded-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-custom-fields-excluded-list')).toHaveTextContent(
      'InternalRiskScore',
    );
    expect(screen.getByTestId('ai-custom-fields-excluded-list')).not.toHaveTextContent('Notes');
  });

  it('links to the custom fields admin page', async () => {
    renderWithProviders(<AiSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-manage-custom-fields-link')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-manage-custom-fields-link')).toHaveAttribute(
      'href',
      '/admin/settings?tab=pipelines',
    );
  });
});
