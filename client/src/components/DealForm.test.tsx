/**
 * Tests for the DealForm component (MINCRM-179).
 * Covers probability field: clear button conditional render, validation error,
 * and hint text branches.
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import DealForm from './DealForm.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';

const noop = () => {};

/** Existing deal fixture with a probability override (MINCRM-179) */
const DEAL_WITH_OVERRIDE: Partial<DealResponse> = {
  id: '00000000-0000-0000-0000-000000000401',
  name: 'Override Deal',
  stage: 'Prospecting',
  value: '50000.00',
  close_date: null,
  effective_probability: 75,
  probability_is_overridden: true,
};

describe('DealForm — probability clear button (MINCRM-179)', () => {
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

describe('DealForm — probability validation (MINCRM-179)', () => {
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
