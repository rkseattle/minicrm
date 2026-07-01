/**
 * Tests for the AI page's retention window notice. (MINCRM-462)
 *
 * Covers:
 *  - Notice renders with the configured retention window once loaded
 *  - Notice is absent while the retention window request is pending
 *  - Notice is absent when the retention window request fails
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import AiPage from './AiPage.js';

function mockEmptySessions() {
  server.use(
    http.get('/api/v1/ai/sessions', () => HttpResponse.json({ sessions: [] })),
    http.get('/api/v1/ai/context', () => HttpResponse.json({ entries: [] })),
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
