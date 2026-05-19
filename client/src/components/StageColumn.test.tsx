/**
 * Tests for StageColumn component (MINCRM-116, MINCRM-300).
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import StageColumn from './StageColumn.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';

const noop = () => {};

const DEAL_FIXTURE: DealResponse = {
  id: '00000000-0000-0000-0000-000000000301',
  name: 'Acme Enterprise Deal',
  stage: 'Prospecting',
  value: '50000',
  currency: 'USD',
  close_date: null,
  loss_reason: null,
  account_id: '00000000-0000-0000-0000-000000000101',
  owner_id: '00000000-0000-0000-0000-000000000001',
  effective_probability: 10,
  probability_is_overridden: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  version: 1,
};

const accountNames = new Map([['00000000-0000-0000-0000-000000000101', 'Acme Corp']]);

describe('StageColumn', () => {
  it('renders the stage name in the column header', () => {
    renderWithProviders(
      <StageColumn
        stage="Prospecting"
        deals={[DEAL_FIXTURE]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    expect(screen.getByTestId('stage-column-prospecting')).toBeInTheDocument();
  });

  it('renders deal cards when deals are present', () => {
    renderWithProviders(
      <StageColumn
        stage="Prospecting"
        deals={[DEAL_FIXTURE]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    expect(screen.getByTestId(`deal-card-${DEAL_FIXTURE.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('stage-column-empty-prospecting')).not.toBeInTheDocument();
  });

  it('renders the empty-state message when deals array is empty', () => {
    renderWithProviders(
      <StageColumn
        stage="Prospecting"
        deals={[]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    expect(screen.getByTestId('stage-column-empty-prospecting')).toBeInTheDocument();
    expect(screen.getByTestId('stage-column-empty-prospecting')).toHaveTextContent(
      'No deals in your pipeline',
    );
  });

  it('does not render deal cards when deals array is empty', () => {
    renderWithProviders(
      <StageColumn
        stage="Qualification"
        deals={[]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    expect(screen.queryByTestId(`deal-card-${DEAL_FIXTURE.id}`)).not.toBeInTheDocument();
  });

  it('uses testIdPrefix on the empty-state element', () => {
    renderWithProviders(
      <StageColumn
        stage="Prospecting"
        deals={[]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
        testIdPrefix="mobile-"
      />,
    );
    expect(screen.getByTestId('mobile-stage-column-empty-prospecting')).toBeInTheDocument();
  });

  it('renders deal count as 0 when deals array is empty', () => {
    renderWithProviders(
      <StageColumn
        stage="Proposal"
        deals={[]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    expect(screen.getByTestId('stage-column-count-proposal')).toHaveTextContent('0');
  });

  // ── Drag-and-drop drop zone (MINCRM-300) ──────────────────────────────────────

  it('calls onStageChange when a deal is dropped onto an open stage column', () => {
    const onStageChange = vi.fn();
    renderWithProviders(
      <StageColumn
        stage="Qualification"
        deals={[]}
        accountNames={accountNames}
        onStageChange={onStageChange}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    const column = screen.getByTestId('stage-column-qualification');
    fireEvent.drop(column, {
      dataTransfer: { getData: () => DEAL_FIXTURE.id },
    });
    expect(onStageChange).toHaveBeenCalledWith(DEAL_FIXTURE.id, 'Qualification');
  });

  it('calls onCloseRequested when a deal is dropped onto a terminal stage column', () => {
    const onCloseRequested = vi.fn();
    renderWithProviders(
      <StageColumn
        stage="Closed Won"
        deals={[]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={onCloseRequested}
        updatingDealIds={new Set()}
      />,
    );
    const column = screen.getByTestId('stage-column-closed-won');
    fireEvent.drop(column, {
      dataTransfer: { getData: () => DEAL_FIXTURE.id },
    });
    expect(onCloseRequested).toHaveBeenCalledWith(DEAL_FIXTURE.id, 'Closed Won');
  });

  it('does not call onStageChange when a deal is dropped onto its own column', () => {
    const onStageChange = vi.fn();
    renderWithProviders(
      <StageColumn
        stage="Prospecting"
        deals={[DEAL_FIXTURE]}
        accountNames={accountNames}
        onStageChange={onStageChange}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    const column = screen.getByTestId('stage-column-prospecting');
    // Drop the same deal back onto its own column — should be a no-op.
    fireEvent.drop(column, {
      dataTransfer: { getData: () => DEAL_FIXTURE.id },
    });
    expect(onStageChange).not.toHaveBeenCalled();
  });

  it('does not call any handler when dataTransfer carries no deal ID', () => {
    const onStageChange = vi.fn();
    const onCloseRequested = vi.fn();
    renderWithProviders(
      <StageColumn
        stage="Qualification"
        deals={[]}
        accountNames={accountNames}
        onStageChange={onStageChange}
        onCloseRequested={onCloseRequested}
        updatingDealIds={new Set()}
      />,
    );
    const column = screen.getByTestId('stage-column-qualification');
    fireEvent.drop(column, {
      dataTransfer: { getData: () => '' },
    });
    expect(onStageChange).not.toHaveBeenCalled();
    expect(onCloseRequested).not.toHaveBeenCalled();
  });

  // ── Weighted pipeline value (MINCRM-179) ──────────────────────────────────────

  it('renders the weighted value in the column header', () => {
    renderWithProviders(
      <StageColumn
        stage="Prospecting"
        deals={[DEAL_FIXTURE]} // value=$50k, effective_probability=10 → weighted=$5k
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    expect(screen.getByTestId('stage-column-weighted-prospecting')).toBeInTheDocument();
    // $50,000 × 10% = $5,000
    expect(screen.getByTestId('stage-column-weighted-prospecting')).toHaveTextContent('$5,000.00');
  });

  it('shows $0.00 weighted value when no deals are present', () => {
    renderWithProviders(
      <StageColumn
        stage="Prospecting"
        deals={[]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    expect(screen.getByTestId('stage-column-weighted-prospecting')).toHaveTextContent('$0.00');
  });
});

// ── Mixed currency (MINCRM-189) ───────────────────────────────────────────────

const DEAL_EUR: DealResponse = {
  ...DEAL_FIXTURE,
  id: '00000000-0000-0000-0000-000000000302',
  currency: 'EUR',
};

describe('StageColumn — mixed currency (MINCRM-189)', () => {
  it('shows the mixed-currency note instead of totals when deals have different currencies', () => {
    renderWithProviders(
      <StageColumn
        stage="Prospecting"
        deals={[DEAL_FIXTURE, DEAL_EUR]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    // total testid is present but shows mixed-currency text, weighted testid is absent
    expect(screen.getByTestId('stage-column-total-prospecting')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-column-weighted-prospecting')).not.toBeInTheDocument();
  });

  it('shows the normal total when all deals share the same currency', () => {
    renderWithProviders(
      <StageColumn
        stage="Prospecting"
        deals={[DEAL_FIXTURE]}
        accountNames={accountNames}
        onStageChange={noop}
        onCloseRequested={noop}
        updatingDealIds={new Set()}
      />,
    );
    expect(screen.getByTestId('stage-column-total-prospecting')).toBeInTheDocument();
    expect(screen.getByTestId('stage-column-weighted-prospecting')).toBeInTheDocument();
  });
});
