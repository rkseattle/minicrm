/**
 * Tests for SessionRecorderPage. (MINCRM-609..612, MINCRM-663)
 * Adapted from minicrm-client's deleted CoverageSessionRecorderPage.test.tsx
 * — the feature-flag-disabled test is dropped (this app has no client-side
 * feature-flag gate; access control is ProtectedRoute's admin-role check,
 * already covered by ProtectedRoute.test.tsx), everything else is preserved.
 */

import { describe, it, expect } from 'vitest';
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

  it('renders active sessions from the control API', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [ACTIVE_SESSION], total: 1, page: 1, limit: 25 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`coverage-session-${ACTIVE_SESSION.id}`)).toBeInTheDocument();
    });
    expect(screen.getByText('Exploring the deals pipeline')).toBeInTheDocument();
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

  it('checks in and shows the recording panel', async () => {
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

    await userEvent.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await userEvent.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recording-panel')).toBeInTheDocument();
    });
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

  it('checks out: no window.__coverage__ present, so no dump is submitted, but the session still ends', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
      http.post('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
      http.post('*/api/v1/admin/coverage/dump', () => {
        throw new Error('dump must not be submitted when window.__coverage__ is absent');
      }),
      http.post('*/api/v1/admin/coverage/sessions/:sessionId/end', () =>
        HttpResponse.json({ session: { ...ACTIVE_SESSION, status: 'ended', version: 2 } }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await userEvent.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-check-out-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('coverage-session-check-out-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-recording-panel')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('coverage-session-label-input')).toHaveValue('');
  });

  it('checks out: submits window.__coverage__ as a browser-source dump when present', async () => {
    const coverageMap = { 'src/App.tsx': { path: 'src/App.tsx', s: { '0': 1 } } };
    (window as unknown as { __coverage__?: unknown }).__coverage__ = coverageMap;

    let capturedBody: unknown;
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
      http.post('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
      http.post('*/api/v1/admin/coverage/dump', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ dump: { dumpId: 'dump-1' } }, { status: 201 });
      }),
      http.post('*/api/v1/admin/coverage/sessions/:sessionId/end', () =>
        HttpResponse.json({ session: { ...ACTIVE_SESSION, status: 'ended', version: 2 } }),
      ),
    );

    try {
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
      });

      await userEvent.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
      await userEvent.click(screen.getByTestId('coverage-session-check-in-button'));

      await waitFor(() => {
        expect(screen.getByTestId('coverage-session-check-out-button')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByTestId('coverage-session-check-out-button'));

      await waitFor(() => {
        expect(screen.queryByTestId('coverage-session-recording-panel')).not.toBeInTheDocument();
      });

      expect(capturedBody).toMatchObject({ source: 'browser', payload: coverageMap });
    } finally {
      delete (window as unknown as { __coverage__?: unknown }).__coverage__;
    }
  });

  it('clears the correlation header on unmount even without an explicit check-out', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
      http.post('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
    );

    const { unmount } = renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await userEvent.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recording-panel')).toBeInTheDocument();
    });

    const { default: apiClient } = await import('@/api/axiosInstance.js');
    expect(apiClient.defaults.headers.common['x-coverage-correlation-id']).toBe(
      ACTIVE_SESSION.correlationId,
    );

    unmount();

    expect(apiClient.defaults.headers.common['x-coverage-correlation-id']).toBeUndefined();
  });

  it('still ends the session on check-out even when the dump request fails', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
      http.post('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
      http.post('*/api/v1/admin/coverage/dump', () => new HttpResponse(null, { status: 409 })),
      http.post('*/api/v1/admin/coverage/sessions/:sessionId/end', () =>
        HttpResponse.json({ session: { ...ACTIVE_SESSION, status: 'ended', version: 2 } }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await userEvent.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-check-out-button')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('coverage-session-check-out-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('coverage-session-recording-panel')).not.toBeInTheDocument();
    });
  });

  it('shows an error when check-out fails to end the session, keeps the recording panel visible, and keeps the correlation header set', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
      http.post('*/api/v1/admin/coverage/sessions', () =>
        HttpResponse.json({ session: ACTIVE_SESSION }, { status: 201 }),
      ),
      http.post('*/api/v1/admin/coverage/dump', () =>
        HttpResponse.json({ dump: { dumpId: 'dump-1' } }, { status: 201 }),
      ),
      http.post(
        '*/api/v1/admin/coverage/sessions/:sessionId/end',
        () => new HttpResponse(null, { status: 409 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-label-input')).toBeInTheDocument();
    });

    await userEvent.type(screen.getByTestId('coverage-session-label-input'), 'Exploratory pass');
    await userEvent.click(screen.getByTestId('coverage-session-check-in-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-check-out-button')).toBeInTheDocument();
    });

    const { default: apiClient } = await import('@/api/axiosInstance.js');
    expect(apiClient.defaults.headers.common['x-coverage-correlation-id']).toBe(
      ACTIVE_SESSION.correlationId,
    );

    await userEvent.click(screen.getByTestId('coverage-session-check-out-button'));

    await waitFor(() => {
      expect(screen.getByTestId('coverage-session-recorder-action-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('coverage-session-recording-panel')).toBeInTheDocument();
    expect(apiClient.defaults.headers.common['x-coverage-correlation-id']).toBe(
      ACTIVE_SESSION.correlationId,
    );

    delete apiClient.defaults.headers.common['x-coverage-correlation-id'];
  });
});
