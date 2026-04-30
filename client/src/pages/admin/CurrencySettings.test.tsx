/**
 * Tests for CurrencySettings — Default currency and exchange rates.
 *
 * Verifies:
 * - Default currency section renders with current value selected
 * - Saving default currency calls PATCH and shows success message
 * - Save error shows error message
 * - Exchange rates section is visible to admin users
 * - Exchange rates section is hidden for rep users
 * - Home row is always shown in the rate table
 * - Add currency form appears on button click; confirm adds row to table
 * - Cancel on add currency form closes it without adding
 * - Remove button deletes a rate row
 * - Saving exchange rates shows success message
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import CurrencySettings from './CurrencySettings.js';

function mockRepUser() {
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({
        user: {
          id: 'user-rep',
          email: 'rep@example.com',
          name: 'Rep User',
          role: 'rep',
          status: 'active',
          must_change_password: false,
        },
      }),
    ),
  );
}

describe('CurrencySettings — default currency', () => {
  it('renders the currency section with select', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('default-currency-select')).toBeInTheDocument();
    });
    expect(screen.getByTestId('currency-section')).toBeInTheDocument();
  });

  it('shows USD as the selected currency from the handler default', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => {
      const select = screen.getByTestId('default-currency-select') as HTMLSelectElement;
      expect(select.value).toBe('USD');
    });
  });

  it('shows success message after saving currency', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => expect(screen.getByTestId('default-currency-select')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('default-currency-select'), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByTestId('currency-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('currency-save-success')).toBeInTheDocument();
    });
  });

  it('shows error message when save fails', async () => {
    server.use(
      http.patch(
        '/api/v1/settings/default-currency',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    renderWithProviders(<CurrencySettings />);

    await waitFor(() => expect(screen.getByTestId('default-currency-select')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('default-currency-select'), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByTestId('currency-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('currency-save-error')).toBeInTheDocument();
    });
  });
});

describe('CurrencySettings — exchange rates', () => {
  it('shows exchange rates section for admin users', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('exchange-rates-section')).toBeInTheDocument();
    });
  });

  it('hides exchange rates section for rep users', async () => {
    mockRepUser();
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('currency-section')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('exchange-rates-section')).not.toBeInTheDocument();
  });

  it('shows the home currency row in the rate table', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => {
      expect(screen.getByTestId('exchange-rate-row-USD')).toBeInTheDocument();
    });
  });

  it('opens add currency form when Add button is clicked', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => expect(screen.getByTestId('exchange-rate-add-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('exchange-rate-add-button'));

    expect(screen.getByTestId('add-currency-form')).toBeInTheDocument();
    expect(screen.getByTestId('add-currency-code-select')).toBeInTheDocument();
  });

  it('closes the add form on Cancel without adding a row', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => expect(screen.getByTestId('exchange-rate-add-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('exchange-rate-add-button'));

    expect(screen.getByTestId('add-currency-form')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-currency-cancel'));

    expect(screen.queryByTestId('add-currency-form')).not.toBeInTheDocument();
  });

  it('confirm button is disabled while no currency is selected', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => expect(screen.getByTestId('exchange-rate-add-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('exchange-rate-add-button'));

    expect(screen.getByTestId('add-currency-confirm')).toBeDisabled();
  });

  it('adds a currency row when a code is chosen and Confirm is clicked', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() => expect(screen.getByTestId('exchange-rate-add-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('exchange-rate-add-button'));

    fireEvent.change(screen.getByTestId('add-currency-code-select'), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByTestId('add-currency-confirm'));

    expect(screen.getByTestId('exchange-rate-row-EUR')).toBeInTheDocument();
    expect(screen.queryByTestId('add-currency-form')).not.toBeInTheDocument();
  });

  it('removes a rate row when Remove is clicked', async () => {
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
              updated_at: null,
            },
            {
              code: 'EUR',
              name: 'Euro',
              symbol: '€',
              rate_to_home: 0.92,
              is_home: false,
              updated_at: null,
            },
          ],
        }),
      ),
    );

    renderWithProviders(<CurrencySettings />);

    await waitFor(() => expect(screen.getByTestId('exchange-rate-row-EUR')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('exchange-rate-remove-EUR'));

    expect(screen.queryByTestId('exchange-rate-row-EUR')).not.toBeInTheDocument();
  });

  it('shows success after saving exchange rates', async () => {
    renderWithProviders(<CurrencySettings />);

    await waitFor(() =>
      expect(screen.getByTestId('exchange-rate-save-button')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('exchange-rate-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('exchange-rate-save-success')).toBeInTheDocument();
    });
  });

  it('shows error when saving exchange rates fails', async () => {
    server.use(
      http.put('/api/v1/settings/currencies', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<CurrencySettings />);

    await waitFor(() =>
      expect(screen.getByTestId('exchange-rate-save-button')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('exchange-rate-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('exchange-rate-save-error')).toBeInTheDocument();
    });
  });
});
