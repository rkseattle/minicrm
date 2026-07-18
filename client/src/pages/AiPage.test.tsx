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
 *    the assistant bubble does not require a second, awaited GET round-trip
 *    to appear (a background invalidation still fires to reconcile the
 *    fabricated user-message id with the server's real one; it does not
 *    block the visible state from settling).
 *  - A rejected send surfaces sendError and clears optimistic state.
 *  - The fabricated user-message id is unique per send, so sending twice in
 *    the same session never collides on message keys.
 *  - Sending on the new-session-on-demand path (no cache entry yet when
 *    onSuccess fires) does not lose the exchange — the background
 *    invalidation populates the cache once the session GET completes.
 *  - Sending on the new-session-on-demand path when the initial session GET
 *    resolves empty before the send POST commits does not lose the exchange —
 *    createMutation seeds the cache up front so there is no in-flight GET for
 *    invalidateQueries to be defeated by.
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

/**
 * Stateful single-session mock: the session GET reflects an in-memory
 * message store that the message POST appends both turns into — mirroring
 * the real server, which persists the user message and the assistant reply
 * in the same synchronous request (see docs/dev/ai-chat.md). Needed for
 * MINCRM-602's send tests: onSuccess fires a background invalidateQueries
 * after the optimistic cache write, which triggers a real refetch of this
 * GET — a static `messages: []` handler would make that refetch clobber the
 * just-written cache with stale empty data, which a real server never would.
 */
function mockStatefulSession() {
  const messages: Array<{
    id: string;
    session_id: string;
    role: 'user' | 'assistant';
    content: string;
    tool_results: null;
    pending_action: null;
    context_proposal: null;
    created_at: string;
  }> = [];
  let nextMessageId = 1;

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
        messages,
      }),
    ),
    http.post(`/api/v1/ai/sessions/${SESSION_ID}/messages`, async ({ request }) => {
      const body = (await request.json()) as { content: string };
      const userMessage = {
        id: `real-user-${nextMessageId}`,
        session_id: SESSION_ID,
        role: 'user' as const,
        content: body.content,
        tool_results: null,
        pending_action: null,
        context_proposal: null,
        created_at: new Date(2026, 6, 1, 0, nextMessageId).toISOString(),
      };
      const assistantMessage = {
        id: `real-assistant-${nextMessageId}`,
        session_id: SESSION_ID,
        role: 'assistant' as const,
        content: `Reply to: ${body.content}`,
        tool_results: null,
        pending_action: null,
        context_proposal: null,
        created_at: new Date(2026, 6, 1, 0, nextMessageId).toISOString(),
      };
      nextMessageId += 1;
      messages.push(userMessage, assistantMessage);
      return HttpResponse.json(assistantMessage);
    }),
  );
}

describe('AiPage — markdown rendering (MINCRM-657)', () => {
  it('renders markdown formatting in assistant replies', async () => {
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
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
      http.get(`/api/v1/ai/sessions/${SESSION_ID}`, () =>
        HttpResponse.json({
          id: SESSION_ID,
          user_id: 'user-1',
          name: 'Test session',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
          messages: [
            {
              id: 'assistant-md-1',
              session_id: SESSION_ID,
              role: 'assistant',
              content: '**Bold point** and a list:\n\n- First item\n- Second item',
              tool_results: null,
              pending_action: null,
              context_proposal: null,
              created_at: '2026-07-01T00:01:00.000Z',
            },
          ],
        }),
      ),
    );

    renderWithProviders(<AiPage />);

    const bubble = await screen.findByTestId('ai-message-assistant');

    // Markdown syntax markers must not appear literally in the rendered text.
    expect(bubble.textContent).not.toContain('**');
    expect(bubble.textContent).not.toContain('- First item');

    // Bold text renders as a real <strong> element.
    const bold = screen.getByText('Bold point');
    expect(bold.tagName).toBe('STRONG');

    // Bullet items render as real list items.
    expect(screen.getByText('First item').closest('li')).not.toBeNull();
    expect(screen.getByText('Second item').closest('li')).not.toBeNull();
  });

  it('renders user messages as plain text without markdown parsing', async () => {
    mockStatefulSession();
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    const input = await screen.findByTestId('ai-message-input');
    await user.type(input, '**not bold** for me');
    await user.click(screen.getByTestId('ai-send-button'));

    const userBubble = await screen.findByTestId('ai-message-user');
    expect(userBubble.textContent).toContain('**not bold** for me');
    expect(userBubble.querySelector('strong')).toBeNull();
  });
});

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
  it('shows the assistant reply from the POST response before any follow-up GET resolves', async () => {
    mockSingleSession();
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
    );

    // The background reconciliation invalidation (fired un-awaited after the
    // cache write) does trigger a second GET — but the assistant bubble must
    // already be visible from the synchronous setQueryData call, without
    // waiting on that GET. Hold it open to prove the UI doesn't depend on it.
    let getSessionCallCount = 0;
    let resolveSecondGet: (() => void) | undefined;
    server.use(
      http.get(`/api/v1/ai/sessions/${SESSION_ID}`, async () => {
        getSessionCallCount += 1;
        if (getSessionCallCount > 1) {
          await new Promise<void>((resolve) => {
            resolveSecondGet = resolve;
          });
        }
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

    // Assistant bubble appears even while the reconciliation GET is still hanging.
    await waitFor(() => {
      expect(screen.getByText('Stub assistant reply')).toBeInTheDocument();
    });
    expect(screen.getByText('Hello assistant')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-send-error')).not.toBeInTheDocument();
    expect(getSessionCallCount).toBe(2);

    resolveSecondGet?.();
  });

  it('uses a unique fabricated user-message id per send, so a second send in the same session never collides', async () => {
    mockStatefulSession();
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    const input = await screen.findByTestId('ai-message-input');

    await user.type(input, 'First message');
    await user.click(screen.getByTestId('ai-send-button'));
    await waitFor(() => {
      expect(screen.getByText('Reply to: First message')).toBeInTheDocument();
    });

    await user.type(input, 'Second message');
    await user.click(screen.getByTestId('ai-send-button'));
    await waitFor(() => {
      expect(screen.getByText('Reply to: Second message')).toBeInTheDocument();
    });

    // Both user turns and both replies must be simultaneously present — a
    // fixed/reused fabricated id would produce a duplicate React key and risk
    // one of the two user bubbles never rendering or rendering stale content.
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
    expect(screen.getByText('Reply to: First message')).toBeInTheDocument();
    expect(screen.getByText('Reply to: Second message')).toBeInTheDocument();
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

  it('surfaces the plain-language FORBIDDEN message for a 403 send response (MINCRM-435)', async () => {
    mockSingleSession();
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
      http.post(`/api/v1/ai/sessions/${SESSION_ID}/messages`, () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: "Tool 'deleteAccount' requires admin role" } },
          { status: 403 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    const input = await screen.findByTestId('ai-message-input');
    await user.type(input, 'Delete all accounts');
    await user.click(screen.getByTestId('ai-send-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-send-error')).toHaveTextContent(
        "You don't have permission to perform this action.",
      );
    });
  });
});

describe('AiPage — send handshake cache correctness (MINCRM-602)', () => {
  it('appends both the user and assistant messages into the session query cache', async () => {
    mockStatefulSession();
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    const input = await screen.findByTestId('ai-message-input');
    await user.type(input, 'Cache check message');
    await user.click(screen.getByTestId('ai-send-button'));

    await waitFor(() => {
      expect(screen.getByText('Reply to: Cache check message')).toBeInTheDocument();
    });
    // Both messages must be present simultaneously in the rendered thread —
    // confirming they came from a single cache write, not a partial refetch.
    expect(screen.getByText('Cache check message')).toBeInTheDocument();
    expect(screen.getByText('Reply to: Cache check message')).toBeInTheDocument();
  });

  it('does not lose the exchange on the new-session-on-demand path when the cache entry does not exist yet at onSuccess', async () => {
    const NEW_SESSION_ID = '22222222-2222-2222-2222-222222222222';
    mockEmptySessions();

    // Server-side message store, populated by the POST handler — mirrors a
    // real server, which persists both turns synchronously in one request
    // (see docs/dev/ai-chat.md). The initial session GET is held open until
    // after the POST resolves, deterministically forcing onSuccess's
    // setQueryData to see no cache entry yet (old === undefined) — the exact
    // race this test targets, rather than leaving it to chance.
    let messages: Array<{
      id: string;
      session_id: string;
      role: 'user' | 'assistant';
      content: string;
      tool_results: null;
      pending_action: null;
      context_proposal: null;
      created_at: string;
    }> = [];
    let releaseInitialGet: (() => void) | undefined;
    const initialGetHeld = new Promise<void>((resolve) => {
      releaseInitialGet = resolve;
    });

    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
      http.post('/api/v1/ai/sessions', () =>
        HttpResponse.json({
          id: NEW_SESSION_ID,
          user_id: 'user-1',
          name: null,
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
        }),
      ),
      http.get(`/api/v1/ai/sessions/${NEW_SESSION_ID}`, async () => {
        await initialGetHeld;
        return HttpResponse.json({
          id: NEW_SESSION_ID,
          user_id: 'user-1',
          name: 'New session',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
          messages,
        });
      }),
      http.post(`/api/v1/ai/sessions/${NEW_SESSION_ID}/messages`, async ({ request }) => {
        const body = (await request.json()) as { content: string };
        const userMessage = {
          id: 'real-user-msg-1',
          session_id: NEW_SESSION_ID,
          role: 'user' as const,
          content: body.content,
          tool_results: null,
          pending_action: null,
          context_proposal: null,
          created_at: '2026-07-01T00:00:30.000Z',
        };
        const assistantMessage = {
          id: 'assistant-msg-3',
          session_id: NEW_SESSION_ID,
          role: 'assistant' as const,
          content: 'New session reply',
          tool_results: null,
          pending_action: null,
          context_proposal: null,
          created_at: '2026-07-01T00:01:00.000Z',
        };
        messages = [userMessage, assistantMessage];
        // Release the held GET only after the POST (and thus onSuccess) has
        // run — guarantees old === undefined was observed at the moment
        // setQueryData's updater ran, then the background invalidation's
        // refetch picks up the now-populated store.
        releaseInitialGet?.();
        return HttpResponse.json(assistantMessage);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    // No existing session — sending triggers createAiSession on-demand
    // (handleSend) before the message POST fires.
    const input = await screen.findByTestId('ai-message-input');
    await user.type(input, 'First message in new session');
    await user.click(screen.getByTestId('ai-send-button'));

    // Even though the cache entry didn't exist at the moment onSuccess ran,
    // the background invalidation must still surface both messages once the
    // session GET resolves — nothing is permanently lost.
    await waitFor(() => {
      expect(screen.getByText('New session reply')).toBeInTheDocument();
    });
    expect(screen.getByText('First message in new session')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-send-error')).not.toBeInTheDocument();
  });

  it('shows the assistant reply on the new-session-on-demand path even when the initial session GET reaches the server before the send POST commits and only resolves afterwards', async () => {
    // Targets the actual production bug (found investigating an intermittent
    // CI failure on F-AI6): the messages query fires its own GET the moment
    // it mounts for a session created via the on-demand path — regardless of
    // any data already seeded in its cache (React Query always fetches once
    // on a query key's genuinely first mount). If that GET reached the
    // server before the send POST's transaction committed, it resolves with
    // an empty message list — a real GET response, not a broken mock — and
    // since a query's own fetch result always replaces cached data wholesale
    // rather than merging with it, applying that response after the POST's
    // cache write silently clobbers the just-written exchange back to empty.
    // No error, no rejected promise — the messages are just gone. The fix is
    // to suppress this GET outright for a session created via the on-demand
    // path (see skipInitialMessagesFetchRef in AiPage.tsx) rather than trying
    // to win or detect the race after the fact.
    //
    // This is a deterministic repro of that ordering: the GET is held open
    // (so it is provably still in flight, i.e. not yet suppressed or
    // resolved, at the moment the send POST resolves) and always returns the
    // pre-commit empty state, mirroring a request that reached the server
    // first. Mirrors the sibling test above, which covers the same held-open
    // ordering but with the GET returning post-commit data — already safe
    // even before this fix, since a returned exchange for the same turn is
    // reconciled rather than duplicated. This test covers the case that
    // was NOT safe: the GET winning the race with stale data.
    const NEW_SESSION_ID = '33333333-3333-3333-3333-333333333333';
    mockEmptySessions();

    let releaseInitialGet: (() => void) | undefined;
    const initialGetHeld = new Promise<void>((resolve) => {
      releaseInitialGet = resolve;
    });

    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
      http.post('/api/v1/ai/sessions', () =>
        HttpResponse.json({
          id: NEW_SESSION_ID,
          user_id: 'user-1',
          name: null,
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
        }),
      ),
      // Held open until after the send POST resolves, then returns the
      // pre-commit (empty) state — simulating a GET that reached the server
      // before the POST's transaction committed, but whose response only
      // arrives at the client afterwards.
      http.get(`/api/v1/ai/sessions/${NEW_SESSION_ID}`, async () => {
        await initialGetHeld;
        return HttpResponse.json({
          id: NEW_SESSION_ID,
          user_id: 'user-1',
          name: null,
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
          messages: [],
        });
      }),
      http.post(`/api/v1/ai/sessions/${NEW_SESSION_ID}/messages`, () => {
        const response = HttpResponse.json({
          id: 'assistant-msg-race',
          session_id: NEW_SESSION_ID,
          role: 'assistant' as const,
          content: 'Reply after empty GET race',
          tool_results: null,
          pending_action: null,
          context_proposal: null,
          created_at: '2026-07-01T00:01:00.000Z',
        });
        // Release the held GET only after the POST has resolved and its
        // onSuccess has run — guarantees the GET is still in flight (not
        // suppressed or already settled) at that moment, then lets it apply
        // its stale empty result afterwards, exactly the ordering the fix
        // must prevent from mattering.
        releaseInitialGet?.();
        return response;
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    const input = await screen.findByTestId('ai-message-input');
    await user.type(input, 'Message racing an empty GET');
    await user.click(screen.getByTestId('ai-send-button'));

    await waitFor(() => {
      expect(screen.getByText('Reply after empty GET race')).toBeInTheDocument();
    });
    expect(screen.getByText('Message racing an empty GET')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-send-error')).not.toBeInTheDocument();

    // The stale GET must not be allowed to land later and wipe the exchange
    // back out — give it a chance to resolve (it already has, having been
    // released above) and confirm the reply is still present.
    await waitFor(() => {
      expect(screen.getByText('Reply after empty GET race')).toBeInTheDocument();
    });
  });

  it('does not show a duplicate user bubble when a partial refetch lands with only the user message reconciled', async () => {
    // Targets a real bug caught in PR review (Greptile): the server persists
    // the user message and assistant reply within the same request, but a
    // session refetch racing the POST could in principle observe an
    // intermediate cache state containing only the real user message (not
    // yet the assistant one). Checking only assistantMessage.id in the
    // dedup guard would miss this and append a second, fabricated user
    // bubble alongside the real one. Simulated here by seeding the cache
    // (via a completed initial GET) with only the real user message before
    // the send's onSuccess runs.
    mockSingleSession();
    // Call-counted GET: the first call (initial mount fetch) returns the
    // "partial" state — the real user message already present, as if an
    // earlier refetch landed after the server persisted it, but before the
    // assistant reply. Any later call (the reconciliation invalidation this
    // send triggers) returns the complete state, exactly as a real server
    // would once the exchange has fully settled — a real GET issued after
    // the POST resolves always reflects the request's synchronous, complete
    // persistence (see docs/dev/ai-chat.md), never a partial one.
    let getSessionCallCount = 0;
    server.use(
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
      http.get(`/api/v1/ai/sessions/${SESSION_ID}`, () => {
        getSessionCallCount += 1;
        const messages =
          getSessionCallCount === 1
            ? [
                {
                  id: 'real-user-msg-partial',
                  session_id: SESSION_ID,
                  role: 'user' as const,
                  content: 'Partial refetch message',
                  tool_results: null,
                  pending_action: null,
                  context_proposal: null,
                  created_at: '2026-07-01T00:00:30.000Z',
                },
              ]
            : [
                {
                  id: 'real-user-msg-partial',
                  session_id: SESSION_ID,
                  role: 'user' as const,
                  content: 'Partial refetch message',
                  tool_results: null,
                  pending_action: null,
                  context_proposal: null,
                  created_at: '2026-07-01T00:00:30.000Z',
                },
                {
                  id: 'assistant-msg-partial',
                  session_id: SESSION_ID,
                  role: 'assistant' as const,
                  content: 'Partial refetch reply',
                  tool_results: null,
                  pending_action: null,
                  context_proposal: null,
                  created_at: '2026-07-01T00:01:00.000Z',
                },
              ];
        return HttpResponse.json({
          id: SESSION_ID,
          user_id: 'user-1',
          name: 'Test session',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
          messages,
        });
      }),
      http.post(`/api/v1/ai/sessions/${SESSION_ID}/messages`, () =>
        HttpResponse.json({
          id: 'assistant-msg-partial',
          session_id: SESSION_ID,
          role: 'assistant',
          content: 'Partial refetch reply',
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
    // Wait for the initial mount GET to resolve, seeding the cache with the
    // partial state, before sending — otherwise onSuccess's setQueryData
    // could instead see old === undefined (a different code path).
    await waitFor(() => expect(screen.getByText('Partial refetch message')).toBeInTheDocument());
    await waitFor(() => expect(getSessionCallCount).toBe(1));

    await user.type(input, 'Partial refetch message');
    await user.click(screen.getByTestId('ai-send-button'));

    await waitFor(() => {
      expect(screen.getByText('Partial refetch reply')).toBeInTheDocument();
    });
    // Exactly one bubble with this content — not two.
    expect(screen.getAllByText('Partial refetch message')).toHaveLength(1);
  });
});

describe('AiPage — optimistic state is scoped per session (MINCRM-602 PR review)', () => {
  it('does not clear a different session’s in-flight optimistic bubble when switching sessions', async () => {
    const SESSION_B_ID = '33333333-3333-3333-3333-333333333333';
    server.use(
      http.get('/api/v1/ai/sessions', () =>
        HttpResponse.json({
          sessions: [
            {
              id: SESSION_ID,
              user_id: 'user-1',
              name: 'Session A',
              created_at: '2026-07-01T00:00:00.000Z',
              updated_at: '2026-07-01T00:00:00.000Z',
            },
            {
              id: SESSION_B_ID,
              user_id: 'user-1',
              name: 'Session B',
              created_at: '2026-07-01T00:00:00.000Z',
              updated_at: '2026-07-01T00:00:00.000Z',
            },
          ],
        }),
      ),
      http.get('/api/v1/ai/context', () => HttpResponse.json({ entries: [] })),
      http.get('/api/v1/ai/retention-window', () =>
        HttpResponse.json({ ai_session_retention_days: 90 }),
      ),
      http.get(`/api/v1/ai/sessions/${SESSION_ID}`, () =>
        HttpResponse.json({
          id: SESSION_ID,
          user_id: 'user-1',
          name: 'Session A',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
          messages: [],
        }),
      ),
      http.get(`/api/v1/ai/sessions/${SESSION_B_ID}`, () =>
        HttpResponse.json({
          id: SESSION_B_ID,
          user_id: 'user-1',
          name: 'Session B',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
          messages: [],
        }),
      ),
      // Session A's send hangs indefinitely — simulates the user switching
      // away to session B before A's POST has settled.
      http.post(
        `/api/v1/ai/sessions/${SESSION_ID}/messages`,
        () =>
          new Promise(() => {
            /* never resolves within this test */
          }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<AiPage />);

    // Send from session A (the first/active session) — this bubble should
    // remain associated with A only, even though the request never settles.
    const input = await screen.findByTestId('ai-message-input');
    await user.type(input, 'Message from session A');
    await user.click(screen.getByTestId('ai-send-button'));
    await waitFor(() => {
      expect(screen.getByText('Message from session A')).toBeInTheDocument();
    });

    // Switch to session B while A's send is still in flight.
    await user.click(screen.getByTestId(`ai-session-item-${SESSION_B_ID}`));

    // Session B's empty state should show — session A's optimistic bubble
    // must not bleed into session B's view.
    await waitFor(() => {
      expect(screen.queryByText('Message from session A')).not.toBeInTheDocument();
    });

    // Switch back to session A — its in-flight optimistic bubble must still
    // be there (not wiped out by having switched away and back).
    await user.click(screen.getByTestId(`ai-session-item-${SESSION_ID}`));
    await waitFor(() => {
      expect(screen.getByText('Message from session A')).toBeInTheDocument();
    });
  });
});
