/**
 * Tests for ActivitiesPage.
 * Covers: page heading, loading state, error state, empty state, activity table rendering,
 * URL param filtering (type, date range, owner scoping for reps vs admins).
 *
 * Implements MINCRM-181, MINCRM-185.
 */

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { ACTIVITY_1, ACTIVITY_2, REP_USER } from '@/test/msw/handlers.js';
import ActivitiesPage from './ActivitiesPage.js';

describe('ActivitiesPage', () => {
  it('renders the page heading', async () => {
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('activities-page-heading')).toBeInTheDocument();
    });
    expect(screen.getByTestId('activities-page-heading')).toHaveTextContent('Activities');
  });

  it('shows the loading state while fetching', () => {
    server.use(
      http.get('/api/v1/activities', async () => {
        await new Promise(() => {}); // never resolves
      }),
    );
    renderWithProviders(<ActivitiesPage />);
    expect(screen.getByTestId('activities-page-loading')).toBeInTheDocument();
  });

  it('shows the error state when the fetch fails', async () => {
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({ error: { code: 'SERVER_ERROR', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('activities-page-error')).toBeInTheDocument();
    });
  });

  it('shows the empty state when no activities are returned', async () => {
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100 }),
      ),
    );
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('activities-page-empty')).toBeInTheDocument();
    });
  });

  it('renders a row for each activity returned', async () => {
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`activity-row-${ACTIVITY_1.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`activity-row-${ACTIVITY_2.id}`)).toBeInTheDocument();
    });
  });

  it('shows the subject for each activity', async () => {
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`activity-subject-${ACTIVITY_1.id}`)).toHaveTextContent(
        ACTIVITY_1.subject,
      );
      expect(screen.getByTestId(`activity-subject-${ACTIVITY_2.id}`)).toHaveTextContent(
        ACTIVITY_2.subject,
      );
    });
  });

  it('renders the type badge for each activity', async () => {
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`activity-type-${ACTIVITY_1.id}`)).toHaveTextContent(
        ACTIVITY_1.type,
      );
    });
  });

  it('renders a link to the deal record when activity has a deal_id', async () => {
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() => {
      const link = screen.getByTestId(`activity-record-${ACTIVITY_1.id}`);
      expect(link.closest('a') ?? link).toHaveAttribute('href', `/deals/${ACTIVITY_1.deal_id}`);
      expect(link).toHaveTextContent('Deal');
    });
  });

  it('renders a link to the contact record when activity has a contact_id', async () => {
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() => {
      const link = screen.getByTestId(`activity-record-${ACTIVITY_2.id}`);
      expect(link.closest('a') ?? link).toHaveAttribute(
        'href',
        `/contacts/${ACTIVITY_2.contact_id}`,
      );
      expect(link).toHaveTextContent('Contact');
    });
  });

  it('renders a dash when the activity has no linked record', async () => {
    const noRecord = {
      ...ACTIVITY_1,
      id: '00000000-0000-0000-0000-000000000499',
      contact_id: null,
      account_id: null,
      deal_id: null,
    };
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({ data: [noRecord], total: 1, page: 1, limit: 100 }),
      ),
    );
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`activity-record-${noRecord.id}`)).toHaveTextContent('—');
    });
  });

  it('filters by type client-side when ?type param is set', async () => {
    renderWithProviders(<ActivitiesPage />, { initialEntries: ['/activities?type=Task'] });
    await waitFor(() => {
      // ACTIVITY_1 is Task → shown; ACTIVITY_2 is Note → hidden
      expect(screen.getByTestId(`activity-row-${ACTIVITY_1.id}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`activity-row-${ACTIVITY_2.id}`)).not.toBeInTheDocument();
    });
  });

  it('shows a filter summary when type param is present', async () => {
    renderWithProviders(<ActivitiesPage />, { initialEntries: ['/activities?type=Task'] });
    await waitFor(() => {
      expect(screen.getByTestId('activities-page-filter-summary')).toHaveTextContent('Task');
    });
  });

  it('shows a filter summary with date range when start and end params are present', async () => {
    renderWithProviders(<ActivitiesPage />, {
      initialEntries: ['/activities?start=2025-01-01&end=2025-12-31'],
    });
    await waitFor(() => {
      expect(screen.getByTestId('activities-page-filter-summary')).toHaveTextContent(
        '2025-01-01 – 2025-12-31',
      );
    });
  });

  it('filters by date range client-side using updated_at', async () => {
    // ACTIVITY_1 updated_at: 2025-01-01; ACTIVITY_2 updated_at: 2025-01-02
    renderWithProviders(<ActivitiesPage />, {
      initialEntries: ['/activities?start=2025-01-02&end=2025-01-02'],
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`activity-row-${ACTIVITY_1.id}`)).not.toBeInTheDocument();
      expect(screen.getByTestId(`activity-row-${ACTIVITY_2.id}`)).toBeInTheDocument();
    });
  });

  it('scopes owner filter to "me" for reps regardless of URL param', async () => {
    let capturedOwner: string | null = null;
    server.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })),
      http.get('/api/v1/activities', ({ request }) => {
        const url = new URL(request.url);
        capturedOwner = url.searchParams.get('owner');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100 });
      }),
    );
    renderWithProviders(<ActivitiesPage />, {
      initialEntries: ['/activities?owner=00000000-0000-0000-0000-000000000001'],
    });
    await waitFor(() => {
      expect(capturedOwner).toBe('me');
    });
  });

  it('passes owner UUID to API when admin uses ?owner param', async () => {
    const adminUuid = '00000000-0000-0000-0000-000000000001';
    let capturedOwner: string | null = null;
    server.use(
      http.get('/api/v1/activities', ({ request }) => {
        const url = new URL(request.url);
        capturedOwner = url.searchParams.get('owner');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100 });
      }),
    );
    // Default /api/auth/me handler returns ADMIN_USER
    renderWithProviders(<ActivitiesPage />, {
      initialEntries: [`/activities?owner=${adminUuid}`],
    });
    await waitFor(() => {
      expect(capturedOwner).toBe(adminUuid);
    });
  });
});
