/**
 * Unit tests for ContextProposalChip.
 *
 * Covers:
 *  - Renders key, value, reason
 *  - Accept: calls API, invalidates cache, shows "accepted" then calls onDismiss
 *  - Dismiss: calls onDismiss immediately without API
 *  - Error state when API fails
 */

import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { server } from '../../test/setup.js';
import ContextProposalChip from './ContextProposalChip.js';
import type { AiContextProposal } from '@shared/schemas/aiContextSchema.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

const PROPOSAL: AiContextProposal = {
  key: 'a while',
  value: '30+ days without activity',
  reason: 'I used this interpretation for your query.',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ContextProposalChip', () => {
  it('renders key, value, and reason', () => {
    renderWithProviders(
      <ContextProposalChip messageId="msg-1" proposal={PROPOSAL} onDismiss={vi.fn()} />,
    );
    expect(screen.getByTestId('ai-context-proposal-chip-msg-1')).toBeInTheDocument();
    expect(screen.getByText('a while')).toBeInTheDocument();
    expect(screen.getByText('30+ days without activity')).toBeInTheDocument();
    expect(screen.getByText('I used this interpretation for your query.')).toBeInTheDocument();
  });

  it('renders accept and dismiss buttons', () => {
    renderWithProviders(
      <ContextProposalChip messageId="msg-1" proposal={PROPOSAL} onDismiss={vi.fn()} />,
    );
    expect(screen.getByTestId('ai-context-proposal-accept-button-msg-1')).toBeInTheDocument();
    expect(screen.getByTestId('ai-context-proposal-dismiss-button-msg-1')).toBeInTheDocument();
  });

  it('calls onDismiss immediately when dismiss is clicked', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderWithProviders(
      <ContextProposalChip messageId="msg-1" proposal={PROPOSAL} onDismiss={onDismiss} />,
    );
    await user.click(screen.getByTestId('ai-context-proposal-dismiss-button-msg-1'));
    expect(onDismiss).toHaveBeenCalledWith('msg-1');
  });

  it('shows accepted confirmation text after successful API call then calls onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderWithProviders(
      <ContextProposalChip messageId="msg-2" proposal={PROPOSAL} onDismiss={onDismiss} />,
    );

    await user.click(screen.getByTestId('ai-context-proposal-accept-button-msg-2'));

    // After the API resolves, the "Saved" confirmation appears
    await waitFor(() =>
      expect(screen.getByTestId('ai-context-proposal-accepted-msg-2')).toBeInTheDocument(),
    );

    // After 1200ms setTimeout, onDismiss is called — wait up to 3s to account for real timers
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('msg-2'), { timeout: 3000 });
  }, 10000);

  it('shows limit-reached message when API returns CONTEXT_ENTRY_LIMIT_REACHED', async () => {
    server.use(
      http.post('/api/v1/ai/context', () =>
        HttpResponse.json(
          { error: { code: 'CONTEXT_ENTRY_LIMIT_REACHED', message: 'Limit reached' } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ContextProposalChip messageId="msg-3" proposal={PROPOSAL} onDismiss={vi.fn()} />,
    );
    await user.click(screen.getByTestId('ai-context-proposal-accept-button-msg-3'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByRole('alert').textContent).not.toBe('');
  }, 10000);

  it('shows key-duplicate message when API returns CONTEXT_KEY_DUPLICATE', async () => {
    server.use(
      http.post('/api/v1/ai/context', () =>
        HttpResponse.json(
          { error: { code: 'CONTEXT_KEY_DUPLICATE', message: 'Duplicate key' } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ContextProposalChip messageId="msg-4" proposal={PROPOSAL} onDismiss={vi.fn()} />,
    );
    await user.click(screen.getByTestId('ai-context-proposal-accept-button-msg-4'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByRole('alert').textContent).not.toBe('');
  }, 10000);

  it('shows generic error message (not keyDuplicate text) when API returns a 500', async () => {
    server.use(
      http.post('/api/v1/ai/context', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ContextProposalChip messageId="msg-5" proposal={PROPOSAL} onDismiss={vi.fn()} />,
    );
    await user.click(screen.getByTestId('ai-context-proposal-accept-button-msg-5'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 5000 });
    // Must not show the misleading duplicate-key message for a 500
    expect(screen.getByRole('alert').textContent).not.toContain('already exists');
  }, 10000);
});
