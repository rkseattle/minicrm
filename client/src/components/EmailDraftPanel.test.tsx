/**
 * Tests for the EmailDraftPanel component. (MINCRM-437)
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import EmailDraftPanel from './EmailDraftPanel.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import type { EmailDraftResponse } from '@shared/schemas/emailDraftSchema.js';

const SAMPLE_DRAFT: EmailDraftResponse = {
  subject: 'Following up on our conversation',
  body: 'Hi Jane, following up on our last call.',
  tone: 'Professional',
  generated_at: '2026-07-04T00:00:00.000Z',
};

describe('EmailDraftPanel', () => {
  it('renders subject and body prefilled from the initial draft', async () => {
    renderWithProviders(
      <EmailDraftPanel contactId="c1" initialDraft={SAMPLE_DRAFT} onDismiss={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('email-draft-subject')).toHaveValue(
        'Following up on our conversation',
      );
    });
    expect(screen.getByTestId('email-draft-body')).toHaveValue(
      'Hi Jane, following up on our last call.',
    );
    expect(screen.getByTestId('email-draft-tone-select')).toHaveValue('Professional');
  });

  it('allows editing subject and body inline', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EmailDraftPanel contactId="c1" initialDraft={SAMPLE_DRAFT} onDismiss={vi.fn()} />,
    );

    const subjectInput = await screen.findByTestId('email-draft-subject');
    await user.clear(subjectInput);
    await user.type(subjectInput, 'Edited subject');

    expect(subjectInput).toHaveValue('Edited subject');
  });

  it('regenerates the draft when the tone selector changes', async () => {
    server.use(
      http.post('/api/v1/contacts/:id/email-draft', () =>
        HttpResponse.json({
          subject: 'Quick follow-up!',
          body: 'Hey Jane, quick follow-up!',
          tone: 'Friendly',
          generated_at: '2026-07-04T00:00:00.000Z',
        }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <EmailDraftPanel contactId="c1" initialDraft={SAMPLE_DRAFT} onDismiss={vi.fn()} />,
    );

    await screen.findByTestId('email-draft-tone-select');
    await user.selectOptions(screen.getByTestId('email-draft-tone-select'), 'Friendly');

    await waitFor(() => {
      expect(screen.getByTestId('email-draft-subject')).toHaveValue('Quick follow-up!');
    });
    expect(screen.getByTestId('email-draft-body')).toHaveValue('Hey Jane, quick follow-up!');
  });

  it('shows an error when regeneration fails', async () => {
    server.use(
      http.post('/api/v1/contacts/:id/email-draft', () =>
        HttpResponse.json(
          { error: { code: 'AI_PROVIDER_ERROR', message: 'AI provider error' } },
          { status: 502 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <EmailDraftPanel contactId="c1" initialDraft={SAMPLE_DRAFT} onDismiss={vi.fn()} />,
    );

    await screen.findByTestId('email-draft-tone-select');
    await user.selectOptions(screen.getByTestId('email-draft-tone-select'), 'Concise');

    await waitFor(() => {
      expect(screen.getByTestId('email-draft-error')).toBeInTheDocument();
    });

    // Tone selector must not desync from the still-displayed subject/body on failure
    // (MINCRM-437 code review finding) — it should reflect the last successful draft.
    expect(screen.getByTestId('email-draft-tone-select')).toHaveValue('Professional');
    expect(screen.getByTestId('email-draft-subject')).toHaveValue(
      'Following up on our conversation',
    );
    expect(screen.getByTestId('email-draft-body')).toHaveValue(
      'Hi Jane, following up on our last call.',
    );
  });

  it('copies the subject and body to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithProviders(
      <EmailDraftPanel contactId="c1" initialDraft={SAMPLE_DRAFT} onDismiss={vi.fn()} />,
    );

    await user.click(screen.getByTestId('email-draft-copy-button'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('Subject: Following up on our conversation'),
      );
    });
    expect(screen.getByTestId('email-draft-copy-button')).toHaveTextContent('Copied');
  });

  it('calls onDismiss when the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    const handleDismiss = vi.fn();
    renderWithProviders(
      <EmailDraftPanel contactId="c1" initialDraft={SAMPLE_DRAFT} onDismiss={handleDismiss} />,
    );

    await user.click(screen.getByTestId('email-draft-dismiss'));
    expect(handleDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss on Escape key', async () => {
    const handleDismiss = vi.fn();
    renderWithProviders(
      <EmailDraftPanel contactId="c1" initialDraft={SAMPLE_DRAFT} onDismiss={handleDismiss} />,
    );

    const panel = await screen.findByTestId('email-draft-panel');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(handleDismiss).toHaveBeenCalledOnce();
  });
});
