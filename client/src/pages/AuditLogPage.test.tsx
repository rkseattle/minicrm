/**
 * Tests for AuditLogPage.
 * (MINCRM-172)
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import AuditLogPage from './AuditLogPage.js';
import type { AuditLogEntry } from '@shared/schemas/auditSchema.js';

/** A minimal audit entry fixture for the page tests */
function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    record_type: 'contact',
    record_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    record_name: 'Alice Smith',
    event_type: 'created',
    field_name: null,
    old_value: null,
    new_value: null,
    changed_by_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    changed_by_name: 'Test Admin',
    created_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('AuditLogPage', () => {
  it('renders the page heading', async () => {
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId('audit-log-heading')).toBeInTheDocument();
    });
  });

  it('shows the loading state initially', () => {
    renderWithProviders(<AuditLogPage />);
    expect(screen.getByTestId('audit-log-loading')).toBeInTheDocument();
  });

  it('shows empty state when there are no entries', async () => {
    // default handler returns { data: [], total: 0, page: 1, limit: 50 }
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId('audit-log-empty')).toBeInTheDocument();
    });
  });

  it('renders entries from the API', async () => {
    const entry = makeEntry();
    server.use(
      http.get('/api/audit-log', () =>
        HttpResponse.json({ data: [entry], total: 1, page: 1, limit: 50 }),
      ),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-row-${entry.id}`)).toBeInTheDocument();
    });
  });

  it('renders actor, event type, and record type columns', async () => {
    const entry = makeEntry();
    server.use(
      http.get('/api/audit-log', () =>
        HttpResponse.json({ data: [entry], total: 1, page: 1, limit: 50 }),
      ),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-actor-${entry.id}`)).toHaveTextContent('Test Admin');
      expect(screen.getByTestId(`audit-log-record-type-${entry.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`audit-log-event-${entry.id}`)).toBeInTheDocument();
    });
  });

  it('shows error state when the API call fails', async () => {
    server.use(
      http.get('/api/audit-log', () =>
        HttpResponse.json({ error: 'Server error' }, { status: 500 }),
      ),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId('audit-log-error')).toBeInTheDocument();
    });
  });

  it('renders the filter bar with all inputs', async () => {
    renderWithProviders(<AuditLogPage />);
    expect(screen.getByTestId('filter-from')).toBeInTheDocument();
    expect(screen.getByTestId('filter-to')).toBeInTheDocument();
    expect(screen.getByTestId('filter-user')).toBeInTheDocument();
    expect(screen.getByTestId('filter-record-type')).toBeInTheDocument();
    expect(screen.getByTestId('filter-event-type')).toBeInTheDocument();
    expect(screen.getByTestId('apply-filters-button')).toBeInTheDocument();
    expect(screen.getByTestId('clear-filters-button')).toBeInTheDocument();
  });

  it('applies filters when the Apply button is clicked', async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.get('/api/audit-log', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 });
      }),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId('audit-log-empty'));

    fireEvent.change(screen.getByTestId('filter-record-type'), { target: { value: 'contact' } });
    fireEvent.click(screen.getByTestId('apply-filters-button'));

    await waitFor(() => {
      expect(capturedUrl).toContain('recordType=contact');
    });
  });

  it('clears filters when the Clear button is clicked', async () => {
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId('audit-log-empty'));

    fireEvent.change(screen.getByTestId('filter-record-type'), { target: { value: 'contact' } });
    fireEvent.click(screen.getByTestId('clear-filters-button'));

    expect((screen.getByTestId('filter-record-type') as HTMLSelectElement).value).toBe('');
  });

  it('shows pagination when there are multiple pages', async () => {
    const entries = Array.from({ length: 2 }, (_, i) =>
      makeEntry({ id: `00000000-0000-0000-0000-0000000000${String(i + 1).padStart(2, '0')}` }),
    );
    server.use(
      http.get('/api/audit-log', () =>
        HttpResponse.json({ data: entries, total: 100, page: 1, limit: 50 }),
      ),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId('audit-log-prev')).toBeInTheDocument();
      expect(screen.getByTestId('audit-log-next')).toBeInTheDocument();
      expect(screen.getByTestId('audit-log-page-label')).toBeInTheDocument();
    });
  });

  it('does not show pagination when all entries fit on one page', async () => {
    const entry = makeEntry();
    server.use(
      http.get('/api/audit-log', () =>
        HttpResponse.json({ data: [entry], total: 1, page: 1, limit: 50 }),
      ),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId(`audit-log-row-${entry.id}`));
    expect(screen.queryByTestId('audit-log-prev')).not.toBeInTheDocument();
  });

  it('expands a row with field detail when the row button is clicked', async () => {
    const entry = makeEntry({
      event_type: 'updated',
      field_name: 'email',
      old_value: 'old@example.com',
      new_value: 'new@example.com',
    });
    server.use(
      http.get('/api/audit-log', () =>
        HttpResponse.json({ data: [entry], total: 1, page: 1, limit: 50 }),
      ),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-row-${entry.id}`)).toBeInTheDocument();
    });

    expect(screen.queryByTestId(`audit-log-detail-${entry.id}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`audit-log-row-button-${entry.id}`));

    expect(screen.getByTestId(`audit-log-detail-${entry.id}`)).toBeInTheDocument();
  });

  it('collapses an expanded row when clicked again', async () => {
    const entry = makeEntry({
      event_type: 'updated',
      field_name: 'email',
      old_value: 'old@example.com',
      new_value: 'new@example.com',
    });
    server.use(
      http.get('/api/audit-log', () =>
        HttpResponse.json({ data: [entry], total: 1, page: 1, limit: 50 }),
      ),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId(`audit-log-row-${entry.id}`));

    const btn = screen.getByTestId(`audit-log-row-button-${entry.id}`);
    fireEvent.click(btn);
    expect(screen.getByTestId(`audit-log-detail-${entry.id}`)).toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.queryByTestId(`audit-log-detail-${entry.id}`)).not.toBeInTheDocument();
  });

  it('renders the timestamp column', async () => {
    const entry = makeEntry();
    server.use(
      http.get('/api/audit-log', () =>
        HttpResponse.json({ data: [entry], total: 1, page: 1, limit: 50 }),
      ),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-time-${entry.id}`)).toBeInTheDocument();
    });
  });
});
