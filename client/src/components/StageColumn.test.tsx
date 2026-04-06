/**
 * Tests for StageColumn component (MINCRM-116).
 */

import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import StageColumn from './StageColumn.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';

const noop = () => {};

const DEAL_FIXTURE: DealResponse = {
  id: '00000000-0000-0000-0000-000000000301',
  name: 'Acme Enterprise Deal',
  stage: 'Prospecting',
  value: '50000',
  close_date: null,
  loss_reason: null,
  account_id: '00000000-0000-0000-0000-000000000101',
  owner_id: '00000000-0000-0000-0000-000000000001',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
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
      'No deals in this stage',
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
});
