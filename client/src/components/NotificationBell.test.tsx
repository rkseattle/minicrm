/**
 * Tests for the NotificationBell component. (MINCRM-469)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import NotificationBell from './NotificationBell.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('NotificationBell', () => {
  it('shows no unread badge when there are no notifications', async () => {
    renderWithProviders(<NotificationBell />);
    await waitFor(() => {
      expect(screen.getByTestId('notification-bell-button')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('notification-unread-badge')).not.toBeInTheDocument();
  });

  it('shows the unread count badge', async () => {
    server.use(
      http.get('/api/v1/notifications', () =>
        HttpResponse.json({
          notifications: [
            {
              id: 'n1',
              type: 'churn_risk_detected',
              title: 'Churn risk: Acme Corp',
              body: 'No activity in 45 days',
              link_path: '/accounts/acme',
              read_at: null,
              created_at: '2026-07-01T00:00:00.000Z',
            },
          ],
          unread_count: 1,
        }),
      ),
    );
    renderWithProviders(<NotificationBell />);
    await waitFor(() => {
      expect(screen.getByTestId('notification-unread-badge')).toHaveTextContent('1');
    });
  });

  it('shows the empty state in the dropdown when opened with no notifications', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />);
    await waitFor(() => {
      expect(screen.getByTestId('notification-bell-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('notification-bell-button'));
    expect(screen.getByTestId('notification-empty')).toBeInTheDocument();
  });

  it('shows notification items in the dropdown when opened', async () => {
    server.use(
      http.get('/api/v1/notifications', () =>
        HttpResponse.json({
          notifications: [
            {
              id: 'n1',
              type: 'churn_risk_detected',
              title: 'Churn risk: Acme Corp',
              body: 'No activity in 45 days',
              link_path: '/accounts/acme',
              read_at: null,
              created_at: '2026-07-01T00:00:00.000Z',
            },
          ],
          unread_count: 1,
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />);
    await waitFor(() => {
      expect(screen.getByTestId('notification-unread-badge')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('notification-bell-button'));
    expect(screen.getByTestId('notification-item-n1')).toHaveTextContent('Churn risk: Acme Corp');
  });

  it('calls mark-all-read when the button is clicked', async () => {
    server.use(
      http.get('/api/v1/notifications', () =>
        HttpResponse.json({
          notifications: [
            {
              id: 'n1',
              type: 'churn_risk_detected',
              title: 'Churn risk: Acme Corp',
              body: null,
              link_path: null,
              read_at: null,
              created_at: '2026-07-01T00:00:00.000Z',
            },
          ],
          unread_count: 1,
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />);
    await waitFor(() => {
      expect(screen.getByTestId('notification-unread-badge')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('notification-bell-button'));
    await user.click(screen.getByTestId('notification-mark-all-read'));

    await waitFor(() => {
      expect(screen.queryByTestId('notification-unread-badge')).not.toBeInTheDocument();
    });
  });
});
