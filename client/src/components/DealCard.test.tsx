/**
 * Tests for the DealCard component (MINCRM-179, MINCRM-300).
 * Covers probability badge display and drag-and-drop source behavior.
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import DealCard from './DealCard.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';

const noop = () => {};

/** Deal fixture where probability is inherited from stage default */
const DEAL_DEFAULT_PROB: DealResponse = {
  id: '00000000-0000-0000-0000-000000000401',
  name: 'Stage Default Deal',
  stage: 'Prospecting',
  value: '50000.00',
  currency: 'USD',
  close_date: null,
  loss_reason: null,
  account_id: null,
  owner_id: '00000000-0000-0000-0000-000000000001',
  effective_probability: 10,
  probability_is_overridden: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  version: 1,
};

/** Deal fixture where probability is manually overridden */
const DEAL_OVERRIDDEN_PROB: DealResponse = {
  ...DEAL_DEFAULT_PROB,
  id: '00000000-0000-0000-0000-000000000402',
  name: 'Overridden Probability Deal',
  effective_probability: 75,
  probability_is_overridden: true,
};

// ── Drag-and-drop source (MINCRM-300) ─────────────────────────────────────────

describe('DealCard — drag-and-drop source (MINCRM-300)', () => {
  it('renders the card as draggable', () => {
    renderWithProviders(
      <DealCard
        deal={DEAL_DEFAULT_PROB}
        accountName="—"
        onStageChange={noop}
        onCloseRequested={noop}
        isUpdating={false}
      />,
    );
    const card = screen.getByTestId(`deal-card-${DEAL_DEFAULT_PROB.id}`);
    expect(card).toHaveAttribute('draggable', 'true');
  });

  it('sets the deal ID in dataTransfer on dragStart', () => {
    renderWithProviders(
      <DealCard
        deal={DEAL_DEFAULT_PROB}
        accountName="—"
        onStageChange={noop}
        onCloseRequested={noop}
        isUpdating={false}
      />,
    );
    const card = screen.getByTestId(`deal-card-${DEAL_DEFAULT_PROB.id}`);

    const setDataSpy = vi.fn();
    fireEvent.dragStart(card, {
      dataTransfer: { setData: setDataSpy, effectAllowed: '' },
    });

    expect(setDataSpy).toHaveBeenCalledWith('text/plain', DEAL_DEFAULT_PROB.id);
  });
});

// ── Probability display (MINCRM-179) ──────────────────────────────────────────

describe('DealCard — probability display (MINCRM-179)', () => {
  it('renders the probability badge with stage default value', () => {
    renderWithProviders(
      <DealCard
        deal={DEAL_DEFAULT_PROB}
        accountName="—"
        onStageChange={noop}
        onCloseRequested={noop}
        isUpdating={false}
      />,
    );
    const badge = screen.getByTestId(`deal-card-probability-${DEAL_DEFAULT_PROB.id}`);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('10');
  });

  it('applies italic/gray styling for stage-default probability', () => {
    renderWithProviders(
      <DealCard
        deal={DEAL_DEFAULT_PROB}
        accountName="—"
        onStageChange={noop}
        onCloseRequested={noop}
        isUpdating={false}
      />,
    );
    const badge = screen.getByTestId(`deal-card-probability-${DEAL_DEFAULT_PROB.id}`);
    // Stage-default badge uses gray italic classes
    expect(badge.className).toContain('text-gray-600');
    expect(badge.className).toContain('italic');
  });

  it('renders the overridden probability value', () => {
    renderWithProviders(
      <DealCard
        deal={DEAL_OVERRIDDEN_PROB}
        accountName="—"
        onStageChange={noop}
        onCloseRequested={noop}
        isUpdating={false}
      />,
    );
    const badge = screen.getByTestId(`deal-card-probability-${DEAL_OVERRIDDEN_PROB.id}`);
    expect(badge).toHaveTextContent('75');
  });

  it('applies distinct indigo styling for an overridden probability', () => {
    renderWithProviders(
      <DealCard
        deal={DEAL_OVERRIDDEN_PROB}
        accountName="—"
        onStageChange={noop}
        onCloseRequested={noop}
        isUpdating={false}
      />,
    );
    const badge = screen.getByTestId(`deal-card-probability-${DEAL_OVERRIDDEN_PROB.id}`);
    // Overridden badge uses indigo classes to visually distinguish it
    expect(badge.className).toContain('text-indigo-700');
    expect(badge.className).not.toContain('italic');
  });
});
