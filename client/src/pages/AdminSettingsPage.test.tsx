/**
 * Tests for the AdminSettingsPage component.
 * Covers: loading state, load error state, default language display, save action,
 * validation rejection (400), success/error feedback, demo data section,
 * MFA enforcement toggle, 10-tab structure, and AI tab
 * visibility gated on the ai_features feature flag.
 */

import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import i18n from 'i18next';
import AdminSettingsPage from './AdminSettingsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

// Per-flag override map: tests can control individual flag states.
const flagOverrides: Record<string, boolean> = {};

// Resolve feature flags synchronously so flag-gated sections render without waitFor.
vi.mock('@/hooks/useFeatureFlag.js', () => ({
  useFeatureFlag: (key: string) => ({
    enabled: key in flagOverrides ? flagOverrides[key] : true,
    isLoading: false,
  }),
  useFeatureFlags: () => ({ flags: {}, isLoading: false }),
}));

function renderOnTab(tab: string) {
  return renderWithProviders(<AdminSettingsPage />, {
    initialEntries: [`/?tab=${tab}`],
  });
}

describe('AdminSettingsPage', () => {
  describe('loading state', () => {
    it('shows loading text while fetching the current setting', () => {
      server.use(http.get('/api/v1/settings/default-language', () => new Promise(() => {})));
      renderWithProviders(<AdminSettingsPage />);
      expect(screen.getByTestId('settings-loading')).toBeInTheDocument();
    });
  });

  describe('load error state', () => {
    it('shows an error alert when the settings API fails on load', async () => {
      server.use(
        http.get('/api/v1/settings/default-language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('settings-load-error')).toBeInTheDocument();
      });
    });

    it('does not render the form when the settings API fails on load', async () => {
      server.use(
        http.get('/api/v1/settings/default-language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('settings-load-error')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('settings-save')).not.toBeInTheDocument();
    });
  });

  describe('page render', () => {
    it('renders the page heading', async () => {
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('settings-heading')).toBeInTheDocument();
      });
    });

    it('renders the language select with the current default selected', async () => {
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        const select = screen.getByTestId('default-language-select') as HTMLSelectElement;
        expect(select).toBeInTheDocument();
        expect(select.value).toBe('en');
      });
    });

    it('renders the save button', async () => {
      renderWithProviders(<AdminSettingsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('settings-save')).toBeInTheDocument();
      });
    });
  });

  describe('save action', () => {
    it('shows success message after a successful save', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('default-language-select'), 'fr');
      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-success')).toBeInTheDocument();
      });
    });

    it('does not show an error message after a successful save', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('default-language-select'), 'de');
      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-success')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('settings-error')).not.toBeInTheDocument();
    });

    it('shows an error message when the save request fails', async () => {
      server.use(
        http.patch('/api/v1/settings/default-language', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-error')).toBeInTheDocument();
      });
    });

    it('shows an error message when the server rejects the language value (400)', async () => {
      server.use(
        http.patch('/api/v1/settings/default-language', () =>
          HttpResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Invalid request' } },
            { status: 400 },
          ),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-error')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('settings-success')).not.toBeInTheDocument();
    });

    it('success message re-translates when the active language changes', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('default-language-select'), 'fr');
      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-success')).toBeInTheDocument();
      });

      // Verify the message is in English before switching
      expect(screen.getByTestId('settings-success')).toHaveTextContent('Default language updated.');

      // Switch the active language to French
      await act(async () => {
        await i18n.changeLanguage('fr');
      });

      // The success message should now reflect the French translation
      expect(screen.getByTestId('settings-success')).toHaveTextContent(
        'Langue par défaut mise à jour.',
      );
    });

    afterEach(async () => {
      // Reset language to English after any test that may change it
      await i18n.changeLanguage('en');
    });

    it('disables the save button while the mutation is pending', async () => {
      server.use(http.patch('/api/v1/settings/default-language', () => new Promise(() => {})));

      const user = userEvent.setup();
      renderWithProviders(<AdminSettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('settings-save')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('settings-save'));

      await waitFor(() => {
        expect(screen.getByTestId('settings-save')).toBeDisabled();
      });
    });
  });

  // ── Demo data section ─────────────────────────────────────────

  describe('demo data section', () => {
    it('renders the demo section', async () => {
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-section')).toBeInTheDocument();
      });
    });

    it('shows "No demo data" status badge when demo is inactive', async () => {
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-status-badge')).toHaveTextContent('No demo data');
      });
    });

    it('shows "Demo data active" status badge when demo is active', async () => {
      server.use(http.get('/api/v1/admin/demo/status', () => HttpResponse.json({ active: true })));
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-status-badge')).toHaveTextContent('Demo data active');
      });
    });

    it('shows an error when demo status fails to load', async () => {
      server.use(
        http.get('/api/v1/admin/demo/status', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-status-error')).toBeInTheDocument();
      });
    });

    it('seed button is disabled when demo data is active', async () => {
      server.use(http.get('/api/v1/admin/demo/status', () => HttpResponse.json({ active: true })));
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeDisabled();
      });
    });

    it('remove button is disabled when no demo data is present', async () => {
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).toBeDisabled();
      });
    });

    it('remove button is enabled when demo data is active', async () => {
      server.use(http.get('/api/v1/admin/demo/status', () => HttpResponse.json({ active: true })));
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
      });
    });

    it('seed button opens confirmation dialog', async () => {
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-seed-button'));
      expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('demo-confirm-title')).toHaveTextContent('Seed demo data?');
    });

    it('reset button opens confirmation dialog', async () => {
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-reset-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-reset-button'));
      expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('demo-confirm-title')).toHaveTextContent('Reset demo data?');
    });

    it('remove button opens confirmation dialog when demo is active', async () => {
      server.use(http.get('/api/v1/admin/demo/status', () => HttpResponse.json({ active: true })));
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
      });
      await user.click(screen.getByTestId('demo-remove-button'));
      expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('demo-confirm-title')).toHaveTextContent('Remove demo data?');
    });

    it('cancel closes the confirmation dialog without acting', async () => {
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-seed-button'));
      expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
      await user.click(screen.getByTestId('demo-confirm-cancel'));
      expect(screen.queryByTestId('demo-confirm-dialog')).not.toBeInTheDocument();
      expect(screen.queryByTestId('demo-feedback')).not.toBeInTheDocument();
    });

    it('confirming seed shows success feedback', async () => {
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-seed-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Demo data seeded successfully.',
        );
      });
    });

    it('confirming reset shows success feedback', async () => {
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-reset-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-reset-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Demo data reset successfully.',
        );
      });
    });

    it('confirming remove shows success feedback', async () => {
      server.use(http.get('/api/v1/admin/demo/status', () => HttpResponse.json({ active: true })));
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
      });
      await user.click(screen.getByTestId('demo-remove-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Demo data removed successfully.',
        );
      });
    });

    it('shows error feedback when seed fails', async () => {
      server.use(
        http.post('/api/v1/admin/demo/seed', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-seed-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Failed to seed demo data. Please try again.',
        );
      });
    });

    it('shows error feedback when reset fails', async () => {
      server.use(
        http.post('/api/v1/admin/demo/reset', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-reset-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('demo-reset-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Failed to reset demo data. Please try again.',
        );
      });
    });
  });

  // ── Pipeline stage section ─────────────────────────────────────────────────

  describe('pipeline stage section', () => {
    it('renders the pipeline stages table with seed stage names', async () => {
      renderOnTab('pipelines');
      await waitFor(() => {
        // Wait for stages to load (requires both pipelines and stages queries to resolve)
        expect(screen.getByText('Prospecting')).toBeInTheDocument();
      });
      expect(screen.getByText('Closed Won')).toBeInTheDocument();
    });

    it('shows name conflict error when adding a duplicate stage name', async () => {
      server.use(
        http.post('/api/v1/settings/pipeline-stages', () =>
          HttpResponse.json(
            {
              error: {
                code: 'STAGE_NAME_CONFLICT',
                message: 'A stage named "Demo" already exists',
              },
            },
            { status: 409 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('pipelines');
      // Wait for stages to fully load (requires both pipelines and stages queries to resolve)
      await waitFor(() => {
        expect(screen.getByText('Prospecting')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('add-stage-button'));
      await user.type(screen.getByTestId('add-stage-name-input'), 'Demo');
      await user.click(screen.getByTestId('add-stage-submit'));
      await waitFor(() => {
        expect(screen.getByTestId('add-stage-error')).toBeInTheDocument();
      });
    });

    it('disables the name input for fixed stages', async () => {
      const user = userEvent.setup();
      renderOnTab('pipelines');
      await waitFor(() => {
        // Wait for stages to load (requires both pipelines and stages queries to resolve)
        expect(screen.getByTestId('pipeline-stage-edit-ps-5')).toBeInTheDocument();
      });
      // Click edit on Closed Won (is_fixed: true)
      await user.click(screen.getByTestId('pipeline-stage-edit-ps-5'));
      await waitFor(() => {
        const nameInput = screen.getByTestId('pipeline-stage-name-input-ps-5') as HTMLInputElement;
        expect(nameInput.disabled).toBe(true);
      });
    });

    it('shows blocked message with deal count when delete is blocked', async () => {
      server.use(
        http.delete('/api/v1/settings/pipeline-stages/:id', () =>
          HttpResponse.json(
            {
              error: {
                code: 'STAGE_HAS_OPEN_DEALS',
                message: 'Cannot delete — 3 open deal(s) must be moved first',
                dealCount: 3,
              },
            },
            { status: 409 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('pipelines');
      await waitFor(() => {
        expect(screen.getByTestId('pipeline-stage-delete-ps-1')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('pipeline-stage-delete-ps-1'));
      await user.click(screen.getByTestId('delete-stage-confirm'));
      await waitFor(() => {
        expect(screen.getByTestId('delete-stage-blocked-message')).toBeInTheDocument();
      });
    });

    it('shows success feedback after successfully adding a stage', async () => {
      const user = userEvent.setup();
      renderOnTab('pipelines');
      // Wait for stages to fully load (requires both pipelines and stages queries to resolve)
      await waitFor(() => {
        expect(screen.getByText('Prospecting')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('add-stage-button'));
      await user.type(screen.getByTestId('add-stage-name-input'), 'Discovery');
      await user.click(screen.getByTestId('add-stage-submit'));
      await waitFor(() => {
        expect(screen.getByTestId('pipeline-stages-feedback')).toBeInTheDocument();
      });
    });

    it('shows generic error when add stage request fails with a server error', async () => {
      server.use(
        http.post('/api/v1/settings/pipeline-stages', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('pipelines');
      // Wait for stages to fully load (requires both pipelines and stages queries to resolve)
      await waitFor(() => {
        expect(screen.getByText('Prospecting')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('add-stage-button'));
      await user.type(screen.getByTestId('add-stage-name-input'), 'Discovery');
      await user.click(screen.getByTestId('add-stage-submit'));
      await waitFor(() => {
        expect(screen.getByTestId('add-stage-error')).toBeInTheDocument();
      });
    });
  });

  // ── Default currency section ──────────────────────────────────

  describe('default currency section', () => {
    it('renders the currency section', async () => {
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('currency-section')).toBeInTheDocument();
      });
    });

    it('renders the currency select with USD pre-selected', async () => {
      renderOnTab('workspace');
      await waitFor(() => {
        const select = screen.getByTestId('default-currency-select') as HTMLSelectElement;
        expect(select).toBeInTheDocument();
        expect(select.value).toBe('USD');
      });
    });

    it('shows success message after a successful currency save', async () => {
      const user = userEvent.setup();
      renderOnTab('workspace');

      await waitFor(() => {
        expect(screen.getByTestId('default-currency-select')).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByTestId('default-currency-select'), 'EUR');
      await user.click(screen.getByTestId('currency-save-button'));

      await waitFor(() => {
        expect(screen.getByTestId('currency-save-success')).toBeInTheDocument();
      });
    });

    it('shows error message when the currency save request fails', async () => {
      server.use(
        http.patch('/api/v1/settings/default-currency', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );

      const user = userEvent.setup();
      renderOnTab('workspace');

      await waitFor(() => {
        expect(screen.getByTestId('default-currency-select')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('currency-save-button'));

      await waitFor(() => {
        expect(screen.getByTestId('currency-save-error')).toBeInTheDocument();
      });
    });
  });

  // ── Exchange Rates section ───────────────────────────────────

  describe('exchange rates section', () => {
    it('renders the exchange rates section for admin users', async () => {
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rates-section')).toBeInTheDocument();
      });
    });

    it('renders the home currency select with USD pre-selected', async () => {
      renderOnTab('workspace');
      await waitFor(() => {
        const select = screen.getByTestId('home-currency-select') as HTMLSelectElement;
        expect(select).toBeInTheDocument();
        expect(select.value).toBe('USD');
      });
    });

    it('renders the exchange rate table', async () => {
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-table')).toBeInTheDocument();
      });
    });

    it('shows the home currency row as read-only with rate 1.000000', async () => {
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-row-USD')).toBeInTheDocument();
      });
      const homeRow = screen.getByTestId('exchange-rate-row-USD');
      expect(homeRow).toHaveTextContent('1.000000');
      expect(screen.queryByTestId('exchange-rate-input-USD')).not.toBeInTheDocument();
    });

    it('shows the Add Currency button when no form is open', async () => {
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-add-button')).toBeInTheDocument();
      });
    });

    it('clicking Add Currency button shows the add currency form', async () => {
      const user = userEvent.setup();
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-add-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('exchange-rate-add-button'));
      expect(screen.getByTestId('add-currency-form')).toBeInTheDocument();
      expect(screen.getByTestId('add-currency-code-select')).toBeInTheDocument();
      expect(screen.getByTestId('add-currency-rate-input')).toBeInTheDocument();
    });

    it('clicking Add in the add form appends a new row to the table', async () => {
      const user = userEvent.setup();
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-add-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('exchange-rate-add-button'));
      await user.selectOptions(screen.getByTestId('add-currency-code-select'), 'EUR');
      await user.type(screen.getByTestId('add-currency-rate-input'), '1.1');
      await user.click(screen.getByTestId('add-currency-confirm'));
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-row-EUR')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('add-currency-form')).not.toBeInTheDocument();
    });

    it('clicking Cancel in the add form hides it without adding a row', async () => {
      const user = userEvent.setup();
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-add-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('exchange-rate-add-button'));
      expect(screen.getByTestId('add-currency-form')).toBeInTheDocument();
      await user.click(screen.getByTestId('add-currency-cancel'));
      expect(screen.queryByTestId('add-currency-form')).not.toBeInTheDocument();
    });

    it('clicking Remove removes the row from the table', async () => {
      server.use(
        http.get('/api/v1/settings/currencies', () =>
          HttpResponse.json({
            home_currency: 'USD',
            currencies: [
              {
                code: 'USD',
                name: 'US Dollar',
                symbol: '$',
                rate_to_home: 1,
                is_home: true,
                updated_at: new Date().toISOString(),
              },
              {
                code: 'EUR',
                name: 'Euro',
                symbol: '€',
                rate_to_home: 1.1,
                is_home: false,
                updated_at: new Date().toISOString(),
              },
            ],
          }),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-row-EUR')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('exchange-rate-remove-EUR'));
      expect(screen.queryByTestId('exchange-rate-row-EUR')).not.toBeInTheDocument();
    });

    it('changing home currency shows the recalculated banner', async () => {
      const user = userEvent.setup();
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('home-currency-select')).toBeInTheDocument();
      });
      await user.selectOptions(screen.getByTestId('home-currency-select'), 'EUR');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-recalculated-banner')).toBeInTheDocument();
      });
    });

    it('changing home currency removes the editable rate input for the new home', async () => {
      server.use(
        http.get('/api/v1/settings/currencies', () =>
          HttpResponse.json({
            home_currency: 'USD',
            currencies: [
              {
                code: 'USD',
                name: 'US Dollar',
                symbol: '$',
                rate_to_home: 1,
                is_home: true,
                updated_at: new Date().toISOString(),
              },
              {
                code: 'EUR',
                name: 'Euro',
                symbol: '€',
                rate_to_home: 1.1,
                is_home: false,
                updated_at: new Date().toISOString(),
              },
            ],
          }),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('workspace');
      await waitFor(() => {
        // EUR starts as a non-home row with an editable input
        expect(screen.getByTestId('exchange-rate-input-EUR')).toBeInTheDocument();
      });
      // Switch home currency to EUR — EUR editable input should disappear
      await user.selectOptions(screen.getByTestId('home-currency-select'), 'EUR');
      await waitFor(() => {
        expect(screen.queryByTestId('exchange-rate-input-EUR')).not.toBeInTheDocument();
      });
    });

    it('clicking Save calls PUT /api/v1/settings/currencies and shows success', async () => {
      const user = userEvent.setup();
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-save-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('exchange-rate-save-button'));
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-save-success')).toBeInTheDocument();
      });
    });

    it('shows error banner when the save request fails', async () => {
      server.use(
        http.put('/api/v1/settings/currencies', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('workspace');
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-save-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('exchange-rate-save-button'));
      await waitFor(() => {
        expect(screen.getByTestId('exchange-rate-save-error')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('exchange-rate-save-success')).not.toBeInTheDocument();
    });
  });

  describe('demo data section — remove failure', () => {
    it('shows error feedback when remove fails', async () => {
      server.use(
        http.get('/api/v1/admin/demo/status', () => HttpResponse.json({ active: true })),
        http.delete('/api/v1/admin/demo', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('platform');
      await waitFor(() => {
        expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
      });
      await user.click(screen.getByTestId('demo-remove-button'));
      await user.click(screen.getByTestId('demo-confirm-ok'));
      await waitFor(() => {
        expect(screen.getByTestId('demo-feedback')).toHaveTextContent(
          'Failed to remove demo data. Please try again.',
        );
      });
    });
  });

  // ── AI tab visibility — gated on ai_features flag ────────────

  describe('AI tab visibility', () => {
    afterEach(() => {
      delete flagOverrides['ai_features'];
    });

    it('shows the AI tab enabled when ai_features flag is on', () => {
      flagOverrides['ai_features'] = true;
      renderWithProviders(<AdminSettingsPage />);
      expect(screen.getByTestId('settings-tab-ai')).toBeInTheDocument();
      expect(screen.getByTestId('settings-tab-ai')).not.toBeDisabled();
    });

    it('shows the AI tab enabled (not disabled) when ai_features flag is off — panel shows disabled banner instead', async () => {
      flagOverrides['ai_features'] = false;
      renderWithProviders(<AdminSettingsPage />, { initialEntries: ['/?tab=ai'] });
      expect(screen.getByTestId('settings-tab-ai')).toBeInTheDocument();
      expect(screen.getByTestId('settings-tab-ai')).not.toBeDisabled();
      // The banner now renders inside AiSettings itself once its own
      // getAiConfig query resolves rather than in a
      // wrapper rendered before any data fetch — needs a waitFor.
      await waitFor(() => {
        expect(screen.getByTestId('ai-panel-disabled-banner')).toBeInTheDocument();
      });
    });

    it('navigates to the AI tab when ai_features is disabled and shows disabled banner', async () => {
      flagOverrides['ai_features'] = false;
      renderWithProviders(<AdminSettingsPage />, { initialEntries: ['/?tab=ai'] });
      expect(screen.getByTestId('settings-tab-ai')).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('ai-panel-disabled-banner')).toBeInTheDocument();
      });
    });

    it('keeps the master AI toggle interactive even when ai_features is off — it is the only way to turn AI back on, so it must never be locked inside the disabled panel', async () => {
      flagOverrides['ai_features'] = false;
      renderWithProviders(<AdminSettingsPage />, { initialEntries: ['/?tab=ai'] });
      await waitFor(() => {
        expect(screen.getByTestId('ai-panel-disabled-banner')).toBeInTheDocument();
      });
      expect(screen.getByTestId('ai-master-toggle')).not.toBeDisabled();
      // Every other control in the panel stays disabled.
      expect(screen.getByTestId('ai-provider-select')).toBeDisabled();
    });

    it('shows the Feature Flags tab last in the tab list', () => {
      renderWithProviders(<AdminSettingsPage />);
      const tabs = screen.getAllByRole('tab');
      expect(tabs[tabs.length - 1]).toHaveAttribute('data-testid', 'settings-tab-flags');
    });
  });

  // MFA enforcement tests live in MfaSettings.test.tsx and SecuritySettings.test.tsx
  // since the MFA section moved to the Security & Identity tab.
  describe('MFA enforcement — security tab', () => {
    it('renders the MFA required section on the security tab', async () => {
      renderOnTab('security');
      await waitFor(() => {
        expect(screen.getByTestId('mfa-required-section')).toBeInTheDocument();
      });
    });

    it('shows the MFA checkbox unchecked by default', async () => {
      renderOnTab('security');
      await waitFor(() => {
        expect(screen.getByTestId('mfa-required-checkbox')).not.toBeChecked();
      });
    });

    it('shows the MFA checkbox checked when mfa_required is true', async () => {
      server.use(
        http.get('/api/v1/settings/mfa-required', () => HttpResponse.json({ mfa_required: true })),
      );
      renderOnTab('security');
      await waitFor(() => {
        expect(screen.getByTestId('mfa-required-checkbox')).toBeChecked();
      });
    });

    it('shows success message after toggling the MFA checkbox', async () => {
      const user = userEvent.setup();
      renderOnTab('security');
      await waitFor(() => expect(screen.getByTestId('mfa-required-checkbox')).toBeInTheDocument());
      await user.click(screen.getByTestId('mfa-required-checkbox'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-required-success')).toBeInTheDocument();
      });
    });

    it('shows error message when the MFA toggle save fails', async () => {
      server.use(
        http.patch('/api/v1/settings/mfa-required', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      const user = userEvent.setup();
      renderOnTab('security');
      await waitFor(() => expect(screen.getByTestId('mfa-required-checkbox')).toBeInTheDocument());
      await user.click(screen.getByTestId('mfa-required-checkbox'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-required-error')).toBeInTheDocument();
      });
    });
  });
});
