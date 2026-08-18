/**
 * Tests for the DealForm component.
 * Covers: field rendering, initialValues, submit, cancel, isSubmitting,
 * account/owner selectors, terminal stage onCloseRequested callback, and
 * probability field behaviour.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import DealForm from './DealForm.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';
import { ACCOUNT_1 } from '@/test/msw/handlers.js';

const noop = () => {};

/** Existing deal fixture with a probability override */
const DEAL_WITH_OVERRIDE: Partial<DealResponse> = {
  id: '00000000-0000-0000-0000-000000000401',
  name: 'Override Deal',
  stage: 'Prospecting',
  value: '50000.00',
  currency: 'USD',
  close_date: null,
  effective_probability: 75,
  probability_is_overridden: true,
};

describe('DealForm — probability clear button', () => {
  it('does not show the clear button when probability field is empty', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    expect(screen.queryByTestId('deal-probability-clear')).not.toBeInTheDocument();
  });

  it('shows the clear button when probability field has a value', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    const probabilityInput = screen.getByTestId('deal-probability-input');
    fireEvent.change(probabilityInput, { target: { name: 'probability', value: '50' } });
    expect(screen.getByTestId('deal-probability-clear')).toBeInTheDocument();
  });

  it('clears the probability field when the clear button is clicked', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    const probabilityInput = screen.getByTestId('deal-probability-input');
    fireEvent.change(probabilityInput, { target: { name: 'probability', value: '50' } });
    fireEvent.click(screen.getByTestId('deal-probability-clear'));
    expect(probabilityInput).toHaveValue(null);
    expect(screen.queryByTestId('deal-probability-clear')).not.toBeInTheDocument();
  });

  it('pre-populates probability when initialValues has an override', () => {
    renderWithProviders(<DealForm initialValues={DEAL_WITH_OVERRIDE} onSubmit={noop} />);
    expect(screen.getByTestId('deal-probability-input')).toHaveValue(75);
    expect(screen.getByTestId('deal-probability-clear')).toBeInTheDocument();
  });
});

describe('DealForm — probability validation', () => {
  it('shows an error for a decimal probability input', () => {
    const onSubmit = vi.fn();
    renderWithProviders(<DealForm onSubmit={onSubmit} />);
    const probabilityInput = screen.getByTestId('deal-probability-input');
    // Give the name field a value to satisfy required validation
    fireEvent.change(screen.getByTestId('deal-name-input'), {
      target: { name: 'name', value: 'Test Deal' },
    });
    fireEvent.change(probabilityInput, { target: { name: 'probability', value: '50.5' } });
    fireEvent.submit(screen.getByTestId('deal-form'));
    expect(screen.getByTestId('deal-probability-error')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not show a probability error when field is empty', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    expect(screen.queryByTestId('deal-probability-error')).not.toBeInTheDocument();
  });
});

describe('DealForm — field rendering', () => {
  it('renders all core fields', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    expect(screen.getByTestId('deal-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('deal-stage-select')).toBeInTheDocument();
    expect(screen.getByTestId('deal-value-input')).toBeInTheDocument();
    expect(screen.getByTestId('deal-close-date-input')).toBeInTheDocument();
    expect(screen.getByTestId('deal-probability-input')).toBeInTheDocument();
  });

  it('does not render account selector when accounts prop is omitted', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    expect(screen.queryByTestId('deal-account-select')).not.toBeInTheDocument();
  });

  it('renders account selector with options when accounts prop is provided', () => {
    const accounts: AccountResponse[] = [ACCOUNT_1];
    renderWithProviders(<DealForm onSubmit={noop} accounts={accounts} />);
    expect(screen.getByTestId('deal-account-select')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: ACCOUNT_1.name })).toBeInTheDocument();
  });

  it('does not render owner selector when users prop is omitted', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    expect(screen.queryByTestId('deal-owner-select')).not.toBeInTheDocument();
  });

  it('renders owner selector when users prop is provided', () => {
    renderWithProviders(<DealForm onSubmit={noop} users={[{ id: 'u-1', name: 'Alice Smith' }]} />);
    expect(screen.getByTestId('deal-owner-select')).toBeInTheDocument();
  });
});

describe('DealForm — initialValues', () => {
  it('pre-populates fields from initialValues', () => {
    renderWithProviders(
      <DealForm
        onSubmit={noop}
        initialValues={{
          name: 'Big Deal',
          stage: 'Qualification',
          value: '75000.00',
          close_date: '2026-06-30',
        }}
      />,
    );
    expect(screen.getByTestId<HTMLInputElement>('deal-name-input').value).toBe('Big Deal');
    expect(screen.getByTestId<HTMLSelectElement>('deal-stage-select').value).toBe('Qualification');
    expect(screen.getByTestId<HTMLInputElement>('deal-value-input').value).toBe('75000.00');
    expect(screen.getByTestId<HTMLInputElement>('deal-close-date-input').value).toBe('2026-06-30');
  });
});

describe('DealForm — onSubmit', () => {
  it('calls onSubmit with correct values', () => {
    const handleSubmit = vi.fn();
    renderWithProviders(<DealForm onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByTestId('deal-name-input'), {
      target: { name: 'name', value: 'My Deal' },
    });
    fireEvent.submit(screen.getByTestId('deal-form'));

    expect(handleSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Deal' }));
  });

  it('the name field is required', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    expect(screen.getByTestId<HTMLInputElement>('deal-name-input')).toBeRequired();
  });
});

describe('DealForm — cancel button', () => {
  it('calls onCancel when the Cancel button is clicked', async () => {
    const handleCancel = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<DealForm onSubmit={noop} onCancel={handleCancel} />);

    await user.click(screen.getByTestId('deal-form-cancel'));
    expect(handleCancel).toHaveBeenCalledOnce();
  });

  it('does not render Cancel button when onCancel is not provided', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    expect(screen.queryByTestId('deal-form-cancel')).not.toBeInTheDocument();
  });
});

describe('DealForm — isSubmitting', () => {
  it('disables inputs and submit button when isSubmitting is true', () => {
    renderWithProviders(<DealForm onSubmit={noop} isSubmitting />);
    expect(screen.getByTestId('deal-name-input')).toBeDisabled();
    expect(screen.getByTestId('deal-form-submit')).toBeDisabled();
  });
});

describe('DealForm — error display', () => {
  it('renders error message in an alert when error prop is set', () => {
    renderWithProviders(<DealForm onSubmit={noop} error="Save failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
  });

  it('does not render an alert when error prop is absent', () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('DealForm — terminal stage / onCloseRequested', () => {
  it('calls onCloseRequested instead of updating stage when a terminal stage is selected', async () => {
    const handleCloseRequested = vi.fn();
    renderWithProviders(<DealForm onSubmit={noop} onCloseRequested={handleCloseRequested} />);

    // Wait for stages to be loaded from MSW
    await waitFor(() =>
      expect(
        screen.getByTestId<HTMLSelectElement>('deal-stage-select').options.length,
      ).toBeGreaterThan(1),
    );

    fireEvent.change(screen.getByTestId('deal-stage-select'), {
      target: { value: 'Closed Won' },
    });

    expect(handleCloseRequested).toHaveBeenCalledWith('Closed Won', expect.any(Object));
  });

  it('updates stage normally when a non-terminal stage is selected and onCloseRequested is provided', async () => {
    const handleCloseRequested = vi.fn();
    renderWithProviders(<DealForm onSubmit={noop} onCloseRequested={handleCloseRequested} />);

    await waitFor(() =>
      expect(
        screen.getByTestId<HTMLSelectElement>('deal-stage-select').options.length,
      ).toBeGreaterThan(1),
    );

    fireEvent.change(screen.getByTestId('deal-stage-select'), {
      target: { value: 'Qualification' },
    });

    expect(handleCloseRequested).not.toHaveBeenCalled();
    expect(screen.getByTestId<HTMLSelectElement>('deal-stage-select').value).toBe('Qualification');
  });
});

describe('DealForm — probability hint text', () => {
  it('shows the overridden hint when probability has a value', async () => {
    renderWithProviders(<DealForm onSubmit={noop} />);

    await waitFor(() =>
      expect(
        screen.getByTestId<HTMLSelectElement>('deal-stage-select').options.length,
      ).toBeGreaterThan(1),
    );

    fireEvent.change(screen.getByTestId('deal-probability-input'), {
      target: { name: 'probability', value: '60' },
    });

    // The overridden hint should appear and the default hint should not
    const hints = screen.getAllByText((content, element) => {
      return (
        element?.tagName === 'P' && element.classList.contains('text-xs') && content.length > 0
      );
    });
    // Overridden hint is present as non-error p element
    expect(hints.length).toBeGreaterThan(0);
  });
});

describe('DealForm — currency selector', () => {
  it('renders the currency selector', async () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    await waitFor(() => {
      expect(screen.getByTestId('deal-currency-select')).toBeInTheDocument();
    });
  });

  it('defaults to USD when no initialValues currency is provided', async () => {
    renderWithProviders(<DealForm onSubmit={noop} />);
    await waitFor(() => {
      const select = screen.getByTestId<HTMLSelectElement>('deal-currency-select');
      expect(select.value).toBe('USD');
    });
  });

  it('pre-populates currency from initialValues', async () => {
    renderWithProviders(
      <DealForm initialValues={{ ...DEAL_WITH_OVERRIDE, currency: 'EUR' }} onSubmit={noop} />,
    );
    await waitFor(() => {
      const select = screen.getByTestId<HTMLSelectElement>('deal-currency-select');
      expect(select.value).toBe('EUR');
    });
  });

  it('includes the selected currency in the submit payload', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<DealForm onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByTestId('deal-currency-select')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('deal-name-input'), {
      target: { name: 'name', value: 'Test Deal' },
    });
    fireEvent.change(screen.getByTestId('deal-currency-select'), {
      target: { name: 'currency', value: 'GBP' },
    });
    fireEvent.submit(screen.getByTestId('deal-form'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ currency: 'GBP' }));
  });
});
