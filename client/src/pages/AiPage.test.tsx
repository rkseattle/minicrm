/**
 * Tests for the AI page's retention window notice (MINCRM-462) and the
 * message-send handshake (MINCRM-602).
 *
 * Retention window notice coverage:
 *  - Notice renders with the configured retention window once loaded
 *  - Notice is absent while the retention window request is pending
 *  - Notice is absent when the retention window request fails
 *
 * Send handshake coverage (MINCRM-602):
 *  - Successful send commits the assistant reply via the POST response alone —
 *    no second GET round-trip is required for the bubble to appear.
 *  - A rejected send surfaces sendError and clears optimistic state.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import AiPage from './AiPage.js';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

function mockEmptySessions() {
  server.use(
    http.get('/api/v1/ai/sessions', () => HttpResponse.json({ sessions: [] })),
    http.get('/api/v1/ai/context', () => HttpResponse.json({ entries: [] })),
  );
}

function mockSingleSession() {
  server.use(
    http.get('/api/v1/ai/sessions', () =>
      HttpResponse.json({
        sessions: [
          {
            id: SESSION_ID,
            user_id: 'user-1',
            name: 'Test session',
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    ),
    http.get('/api/v1/ai/context', () => HttpResponse.json({ entries: [] })),
    http.get(`/api/v1/ai/sessions/${SESSION_ID}`, () =>
      HttpResponse.json({
        id: SESSION_ID,
        user_id: 'user-1',
        name: 'Test session',
        created_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
        messages: [],
      }),
    ),
  );
}

describe('AiPage — retention window notice', () => {
  it('shows the retention window once loaded', async () => {
    mockEmptySessions();
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
    );
    renderWithProviders(<AiPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-retention-window-notice')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-retention-window-notice')).toHaveTextContent('90');
  });

  it('does not show the notice while the retention window is still loading', async () => {
    mockEmptySessions();
    server.use(
      http.get(
        '/api/v1/ai/retention-window',
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );
    renderWithProviders(<AiPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-conversation-panel')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ai-retention-window-notice')).not.toBeInTheDocument();
  });

  it('does not show the notice when the retention window request fails', async () => {
    mockEmptySessions();
    server.use(
      http.get('/api/v1/ai/retention-window', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<AiPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-conversation-panel')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ai-retention-window-notice')).not.toBeInTheDocument();
  });
});

describe('AiPage — send message handshake (MINCRM-602)', () => {
  it('shows the assistant reply from the POST response alone, without a follow-up GET', async () => {
    mockSingleSession();
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
    );

    // Spy on the session-with-messages GET so we can assert it is never called
    // again after the initial mount fetch — the assistant bubble must come from
    // the POST response committed via setQueryData, not a second round-trip.
    let getSessionCallCount = 0;
    server.use(
      http.get(`/api/v1/ai/sessions/${SESSION_ID}`, () => {
        getSessionCallCount += 1;
        return HttpResponse.json({
          id: SESSION_ID,
          user_id: 'user-1',
          name: 'Test session',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
          messages: [],
        });
      }),
      http.post(`/api/v1/ai/sessions/${SESSION_ID}/messages`, () =>
        HttpResponse.json({
          id: 'assistant-msg-1',
          session_id: SESSION_ID,
          role: 'assistant',
          content: 'Stub assistant reply',
          tool_results: null,
          pending_action: null,
          context_proposal: null,
          created_at: '2026-07-01T00:01:00.000Z',
        }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    const input = await screen.findByTestId('ai-message-input');
    await waitFor(() => expect(getSessionCallCount).toBe(1));

    await user.type(input, 'Hello assistant');
    await user.click(screen.getByTestId('ai-send-button'));

    await waitFor(() => {
      expect(screen.getByText('Stub assistant reply')).toBeInTheDocument();
    });
    expect(screen.getByText('Hello assistant')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-send-error')).not.toBeInTheDocument();

    // The GET for this session must still have been called exactly once (the
    // initial mount fetch) — no second round-trip was triggered by the send.
    expect(getSessionCallCount).toBe(1);
  });

  it('surfaces sendError and clears optimistic state when the send request rejects', async () => {
    mockSingleSession();
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
      http.post(`/api/v1/ai/sessions/${SESSION_ID}/messages`, () =>
        HttpResponse.json(
          { error: { code: 'AI_SEND_FAILED', message: 'stub failure' } },
          { status: 500 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    const input = await screen.findByTestId('ai-message-input');
    await user.type(input, 'This will fail');
    await user.click(screen.getByTestId('ai-send-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-send-error')).toBeInTheDocument();
    });

    // Optimistic user bubble must be cleared once the error is surfaced —
    // no stale optimistic state left behind after a rejected send.
    expect(screen.queryByText('This will fail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument();
  });
});

describe('AiPage — send handshake cache correctness (MINCRM-602)', () => {
  it('appends both the user and assistant messages into the session query cache', async () => {
    mockSingleSession();
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
      http.post(`/api/v1/ai/sessions/${SESSION_ID}/messages`, () =>
        HttpResponse.json({
          id: 'assistant-msg-2',
          session_id: SESSION_ID,
          role: 'assistant',
          content: 'Cache-check reply',
          tool_results: null,
          pending_action: null,
          context_proposal: null,
          created_at: '2026-07-01T00:02:00.000Z',
        }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    const input = await screen.findByTestId('ai-message-input');
    await user.type(input, 'Cache check message');
    await user.click(screen.getByTestId('ai-send-button'));

    await waitFor(() => {
      expect(screen.getByText('Cache-check reply')).toBeInTheDocument();
    });
    // Both messages must be present simultaneously in the rendered thread —
    // confirming they came from a single cache write, not a partial refetch.
    expect(screen.getByText('Cache check message')).toBeInTheDocument();
    expect(screen.getByText('Cache-check reply')).toBeInTheDocument();
  });
});
