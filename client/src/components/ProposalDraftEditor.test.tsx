/**
 * Tests for the ProposalDraftEditor component. (MINCRM-473)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import ProposalDraftEditor from './ProposalDraftEditor.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import type { ProposalDraft } from '@shared/schemas/proposalDraftSchema.js';

const SAMPLE_DRAFT: ProposalDraft = {
  executive_summary: 'Executive summary text.',
  problem_statement: 'Problem statement text.',
  proposed_solution: 'Proposed solution text.',
  pricing_line_items: [{ description: 'Core package', amount: 10000 }],
  pricing_currency: 'USD',
  next_steps: 'Next steps text.',
  prepared_for: 'Jane Doe, VP Sales',
  prepared_by: 'Test Rep',
};

describe('ProposalDraftEditor', () => {
  it('renders as a full-screen dialog with the deal name in the title', async () => {
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-editor')).toBeInTheDocument();
    });
    expect(screen.getByTestId('proposal-draft-editor')).toHaveTextContent('Acme Deal');
  });

  it('renders prepared-for and prepared-by fields with initial values', async () => {
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-prepared-for-input')).toHaveValue(
        'Jane Doe, VP Sales',
      );
    });
    expect(screen.getByTestId('proposal-draft-prepared-by-input')).toHaveValue('Test Rep');
  });

  it('renders pricing line items and allows adding a new one', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-pricing-description-0')).toHaveValue(
        'Core package',
      );
    });

    await user.click(screen.getByTestId('proposal-draft-add-line-item'));

    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-pricing-description-1')).toBeInTheDocument();
    });
  });

  it('removes a pricing line item when the remove button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-pricing-remove-0')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('proposal-draft-pricing-remove-0'));

    await waitFor(() => {
      expect(screen.queryByTestId('proposal-draft-pricing-description-0')).not.toBeInTheDocument();
    });
  });

  it('copies the draft to the clipboard as markdown', async () => {
    const user = userEvent.setup();
    // Must override navigator.clipboard AFTER userEvent.setup() — v14 installs its own
    // getter-only clipboard stub during setup(), so this needs defineProperty, not assign.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-copy-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('proposal-draft-copy-button'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# Proposal: Acme Deal'));
    });
    expect(screen.getByTestId('proposal-draft-copy-button')).toHaveTextContent('Copied');
  });

  it('shows the regenerate form when the regenerate button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-regenerate-toggle')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('proposal-draft-regenerate-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-focus-notes-input')).toBeInTheDocument();
    });
  });

  it('regenerates the draft with focus notes and updates the editor', async () => {
    server.use(
      http.post('/api/v1/deals/:id/proposal-draft', () =>
        HttpResponse.json({
          draft: { ...SAMPLE_DRAFT, executive_summary: 'Regenerated summary focused on ROI.' },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('proposal-draft-regenerate-toggle'));
    await user.type(screen.getByTestId('proposal-draft-focus-notes-input'), 'Focus on ROI');
    await user.click(screen.getByTestId('proposal-draft-regenerate-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-executive-summary-content')).toHaveTextContent(
        'Regenerated summary focused on ROI.',
      );
    });
  });

  it('shows a regenerate error when the request fails', async () => {
    server.use(
      http.post('/api/v1/deals/:id/proposal-draft', () =>
        HttpResponse.json(
          { error: { code: 'AI_BUDGET_EXCEEDED', message: 'Budget exceeded' } },
          { status: 429 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('proposal-draft-regenerate-toggle'));
    await user.type(screen.getByTestId('proposal-draft-focus-notes-input'), 'Focus on ROI');
    await user.click(screen.getByTestId('proposal-draft-regenerate-submit'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('calls onDismiss when the close button is clicked', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={onDismiss}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-dismiss-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('proposal-draft-dismiss-button'));

    expect(onDismiss).toHaveBeenCalled();
  });

  it('downloads a DOCX file when the download button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProposalDraftEditor
        dealId="d1"
        dealName="Acme Deal"
        initialDraft={SAMPLE_DRAFT}
        onDismiss={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('proposal-draft-download-docx-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('proposal-draft-download-docx-button'));

    // Default waitFor timeout (1000ms) has intermittently been too tight under CI
    // runner load for this mutation to settle — bumped rather than changed the
    // assertion, since the underlying MSW handler resolves synchronously locally.
    await waitFor(
      () => {
        expect(screen.getByTestId('proposal-draft-download-docx-button')).not.toBeDisabled();
      },
      { timeout: 5000 },
    );
  });
});
