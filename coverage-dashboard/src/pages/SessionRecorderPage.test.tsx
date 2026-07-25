/**
 * Tests for SessionRecorderPage. (MINCRM-609..612, MINCRM-663)
 *
 * Rewritten for the server-as-source-of-truth redesign (found via Greptile PR
 * review — "Navigation orphans active sessions"): there is no local
 * "recording session" component state anymore, so these tests exercise the
 * active-sessions list returned by GET /admin/coverage/sessions directly,
 * each with its own copy-link/check-out actions.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import SessionRecorderPage from './SessionRecorderPage.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';

function renderPage() {
  return renderWithProviders(<SessionRecorderPage />, { initialEntries: ['/sessions'] });
}

const ACTIVE_SESSION = {
  id: 'session-1',
  label: 'Exploring the deals pipeline',
  source: 'manual' as const,
  status: 'active' as const,
  correlationId: 'corr-1',
  buildSha: 'abc123',
  environment: 'test',
  issueKey: 'MINCRM-611',
  startedById: 'user-1',
  startedAt: '2026-07-20T00:00:00.000Z',
  endedAt: null,
  version: 1,
};

const OTHER_ACTIVE_SESSION = {
  ...ACTIVE_SESSION,
  id: 'session-2',
  label: 'Checking the reports tab',
  correlationId: 'corr-2',
  issueKey: null,
};

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('SessionRecorderPage', () => {
  it('shows a loading state while the sessions query is in flight, then the empty state', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-heading')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-empty')).toBeInTheDocument();
    });
  });

  it('shows an error message when the sessions request fails', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () => new HttpResponse(null, { status: 500 })),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-load-error')).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no active sessions', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-empty')).toBeInTheDocument();
    });
  });

  it('lists every active session from the control API, each with its own actions', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({
          data: [ACTIVE_SESSION, OTHER_ACTIVE_SESSION],
          total: 2,
          page: 1,
          limit: 25,
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`coverage-session-${ACTIVE_SESSION.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`coverage-session-${OTHER_ACTIVE_SESSION.id}`)).toBeInTheDocument();
    expect(screen.getByText('Exploring the deals pipeline')).toBeInTheDocument();
    expect(screen.getByText('Checking the reports tab')).toBeInTheDocument();
    expect(
      screen.getByTestId(`coverage-session-copy-link-${ACTIVE_SESSION.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`coverage-session-copy-link-${OTHER_ACTIVE_SESSION.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`coverage-session-check-out-${ACTIVE_SESSION.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`coverage-session-check-out-${OTHER_ACTIVE_SESSION.id}`),
    ).toBeInTheDocument();
  });

  it('fetches every page of active sessions, not just the first', async () => {
    // 101 sessions — one more than a single PAGINATION_MAX_LIMIT (100) page —
    // so listAllActiveCoverageSessions must fetch page 2 to see the last one.
    const manySessions = Array.from({ length: 101 }, (_, i) => ({
      ...ACTIVE_SESSION,
      id: `session-${i}`,
      label: `Session ${i}`,
      correlationId: `corr-${i}`,
    }));
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page') ?? '1');
        const limit = Number(url.searchParams.get('limit') ?? '25');
        const start = (page - 1) * limit;
        return HttpResponse.json({
          data: manySessions.slice(start, start + limit),
          total: manySessions.length,
          page,
          limit,
        });
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-session-0')).toBeInTheDocument();
    });
    // The 101st session only exists on page 2 — asserting it's present
    // proves the second page was actually fetched, not just the first.
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-session-100')).toBeInTheDocument();
    });
  });

  it('disables the check-in button until a label is entered', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-check-in-button')).toBeInTheDocument();
    });
    expect(screen.getByTestId('coverage-session-check-in-button')).toBeDisabled();

    await userEvent.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    expect(screen.getByTestId('coverage-session-check-in-button')).toBeEnabled();
  });

  it('checks in and adds the new session to the active-sessions list', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
      http.post('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [ACTIVE_SESSION], total: 1, page: 1, limit: 25 }),
      ),
    );

    await userEvent.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await userEvent.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId(`coverage-session-${ACTIVE_SESSION.id}`)).toBeInTheDocument();
    });
    // the form clears after a successful check-in
    expect(screen.getByTestId('coverage-session-label-input')).toHaveValue('');
  });

  it('shows an error when check-in fails', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
      http.post('*/api/v1/admin/coverage/sessions', () => new HttpResponse(null, { status: 409 })),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await userEvent.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-action-error')).toBeInTheDocument();
    });
  });

  it('copies the CRM correlation link for a specific session to the clipboard', async () => {
    const writeText = mockClipboard();
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [ACTIVE_SESSION], total: 1, page: 1, limit: 25 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByTestId(`coverage-session-copy-link-${ACTIVE_SESSION.id}`),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId(`coverage-session-copy-link-${ACTIVE_SESSION.id}`));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining(`coverageCorrelationId=${ACTIVE_SESSION.correlationId}`),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByTestId(`coverage-session-copy-link-${ACTIVE_SESSION.id}`),
      ).toHaveTextContent('Copied!');
    });
  });

  it('ends a specific session on check-out and removes it from the active-sessions list', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({
          data: [ACTIVE_SESSION, OTHER_ACTIVE_SESSION],
          total: 2,
          page: 1,
          limit: 25,
        }),
      ),
      http.post('*/api/v1/admin/coverage/sessions/:sessionId/end', ({ params }) =>
        HttpResponse.json({
          session: {
            ...(params['sessionId'] === ACTIVE_SESSION.id ? ACTIVE_SESSION : OTHER_ACTIVE_SESSION),
            status: 'ended',
            version: 2,
          },
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`coverage-session-${ACTIVE_SESSION.id}`)).toBeInTheDocument();
    });

    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [OTHER_ACTIVE_SESSION], total: 1, page: 1, limit: 25 }),
      ),
    );

    await userEvent.click(screen.getByTestId(`coverage-session-check-out-${ACTIVE_SESSION.id}`));

    await waitFor(() => {
      expect(screen.queryByTestId(`coverage-session-${ACTIVE_SESSION.id}`)).not.toBeInTheDocument();
    });
    expect(screen.getByTestId(`coverage-session-${OTHER_ACTIVE_SESSION.id}`)).toBeInTheDocument();
  });

  it('shows an error when check-out fails, and the session stays in the active-sessions list', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [ACTIVE_SESSION], total: 1, page: 1, limit: 25 }),
      ),
      http.post(
        '*/api/v1/admin/coverage/sessions/:sessionId/end',
        () => new HttpResponse(null, { status: 409 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByTestId(`coverage-session-check-out-${ACTIVE_SESSION.id}`),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId(`coverage-session-check-out-${ACTIVE_SESSION.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-action-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId(`coverage-session-${ACTIVE_SESSION.id}`)).toBeInTheDocument();
  });
});
