/**
 * Tests for the CoverageSessionRecorderPage component. (MINCRM-611)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import CoverageSessionRecorderPage from './CoverageSessionRecorderPage.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { server } from '../../test/setup.js';

function renderPage() {
  return renderWithProviders(<CoverageSessionRecorderPage />, {
    initialEntries: ['/admin/coverage-sessions'],
  });
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

describe('CoverageSessionRecorderPage', () => {
  it('shows a loading state while the sessions query is in flight, then the empty state', async () => {
    server.use(
      http.get('/api/v1/admin/coverage/sessions', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ sessions: [] });
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
      http.get('/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed' } },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-load-error')).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no active sessions', async () => {
    server.use(
      http.get('/api/v1/admin/coverage/sessions', () => HttpResponse.json({ sessions: [] })),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-empty')).toBeInTheDocument();
    });
  });

  it('renders active sessions from the control API', async () => {
    server.use(
      http.get('/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ sessions: [ACTIVE_SESSION] }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`coverage-session-${ACTIVE_SESSION.id}`)).toBeInTheDocument();
    });
    expect(screen.getByText('Exploring the deals pipeline')).toBeInTheDocument();
  });

  it('hides the page content when the feature flag is disabled', async () => {
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { coverage_session_management: false } }),
      ),
      // useFeatureFlag treats the flag as enabled while its own query is loading
      // (avoids a flash-of-disabled-content), so the sessions query briefly
      // fires with enabled: true before the flags settle to false.
      http.get('/api/v1/admin/coverage/sessions', () => HttpResponse.json({ sessions: [] })),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-recorder-heading')).not.toBeInTheDocument();
    });
  });

  it('disables the check-in button until a label is entered', async () => {
    server.use(
      http.get('/api/v1/admin/coverage/sessions', () => HttpResponse.json({ sessions: [] })),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-check-in-button')).toBeInTheDocument();
    });
    expect(screen.getByTestId('coverage-session-check-in-button')).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    expect(screen.getByTestId('coverage-session-check-in-button')).toBeEnabled();
  });

  it('checks in and shows the recording panel', async () => {
    server.use(
      http.get('/api/v1/admin/coverage/sessions', () => HttpResponse.json({ sessions: [] })),
      http.post('/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await user.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recording-panel')).toBeInTheDocument();
    });
  });

  it('shows an error when check-in fails', async () => {
    server.use(
      http.get('/api/v1/admin/coverage/sessions', () => HttpResponse.json({ sessions: [] })),
      http.post('/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json(
          { error: { code: 'COVERAGE_NOT_ENABLED', message: 'Failed' } },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await user.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-action-error')).toBeInTheDocument();
    });
  });

  it('checks out: dumps (attribution is automatic server-side) and ends the session', async () => {
    server.use(
      http.get('/api/v1/admin/coverage/sessions', () => HttpResponse.json({ sessions: [] })),
      http.post('/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
      http.post('/api/v1/admin/coverage/dump', () =>
        HttpResponse.json({ dump: { dumpId: 'dump-1' } }, { status: 201 }),
      ),
      http.post('/api/v1/admin/coverage/sessions/:sessionId/end', () =>
        HttpResponse.json({ session: { ...ACTIVE_SESSION, status: 'ended', version: 2 } }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await user.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-check-out-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('coverage-session-check-out-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-recording-panel')).not.toBeInTheDocument();
    });
    // Back to the check-in form after checking out.
    expect(screen.getByTestId('coverage-session-label-input')).toHaveValue('');
  });

  it("still ends the session on check-out even when the dump request fails (coverage_instrumentation may be off independently of this page's own flag)", async () => {
    server.use(
      http.get('/api/v1/admin/coverage/sessions', () => HttpResponse.json({ sessions: [] })),
      http.post('/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
      http.post('/api/v1/admin/coverage/dump', () =>
        HttpResponse.json(
          { error: { code: 'COVERAGE_NOT_ENABLED', message: 'Failed' } },
          { status: 409 },
        ),
      ),
      http.post('/api/v1/admin/coverage/sessions/:sessionId/end', () =>
        HttpResponse.json({ session: { ...ACTIVE_SESSION, status: 'ended', version: 2 } }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await user.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-check-out-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('coverage-session-check-out-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-recording-panel')).not.toBeInTheDocument();
    });
  });

  it('shows an error when check-out fails to end the session', async () => {
    server.use(
      http.get('/api/v1/admin/coverage/sessions', () => HttpResponse.json({ sessions: [] })),
      http.post('/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
      http.post('/api/v1/admin/coverage/dump', () =>
        HttpResponse.json({ dump: { dumpId: 'dump-1' } }, { status: 201 }),
      ),
      http.post('/api/v1/admin/coverage/sessions/:sessionId/end', () =>
        HttpResponse.json(
          { error: { code: 'COVERAGE_SESSION_CONFLICT', message: 'Failed' } },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await user.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-check-out-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('coverage-session-check-out-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-action-error')).toBeInTheDocument();
    });
  });
});
