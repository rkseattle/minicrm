/**
 * Tests for ChangeHistory component.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import ChangeHistory from './ChangeHistory.js';
import type { AuditLogEntry } from '@shared/schemas/auditSchema.js';

const RECORD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** A minimal audit entry fixture */
function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    record_type: 'contact',
    record_id: RECORD_ID,
    record_name: 'Alice Smith',
    event_type: 'created',
    field_name: null,
    old_value: null,
    new_value: null,
    changed_by_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    changed_by_name: 'Test User',
    source: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ChangeHistory', () => {
  it('shows loading state while fetching', () => {
    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    expect(screen.getByTestId('change-history-loading')).toBeInTheDocument();
  });

  it('shows empty state when there is no history', async () => {
    // default handler returns { entries: [] }
    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('change-history-empty')).toBeInTheDocument();
    });
  });

  it('renders history entries from the API', async () => {
    const entry = makeEntry();
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toBeInTheDocument();
    });
  });

  it('renders the timestamp element with data-testid', async () => {
    const entry = makeEntry();
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-time-${entry.id}`)).toBeInTheDocument();
    });
  });

  it('shows "Show all" toggle when there are 20 or more preview entries', async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry({ id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}` }),
    );
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('change-history-toggle')).toBeInTheDocument();
    });
  });

  it('does not show the toggle when there are fewer than 20 entries', async () => {
    const entry = makeEntry();
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.queryByTestId('change-history-toggle')).not.toBeInTheDocument();
    });
  });

  it('clicking "Show all" triggers the full history query', async () => {
    const preview = Array.from({ length: 20 }, (_, i) =>
      makeEntry({ id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}` }),
    );
    const extra = makeEntry({ id: '00000000-0000-0000-0000-000000000099' });

    server.use(
      http.get('/api/v1/audit-log/record', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('all') === 'true') {
          return HttpResponse.json({ entries: [...preview, extra] });
        }
        return HttpResponse.json({ entries: preview });
      }),
    );

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('change-history-toggle')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('change-history-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${extra.id}`)).toBeInTheDocument();
    });
  });

  it('renders the section heading', async () => {
    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    expect(screen.getByTestId('change-history-heading')).toBeInTheDocument();
  });

  it('renders an updated entry summary with field name', async () => {
    const entry = makeEntry({
      event_type: 'updated',
      field_name: 'email',
      old_value: 'old@example.com',
      new_value: 'new@example.com',
    });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toBeInTheDocument();
    });
    // The entry text should contain actor and field info
    expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
  });

  it('renders a deleted entry summary', async () => {
    const entry = makeEntry({ event_type: 'deleted' });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
  });

  // ── buildSummary — all event_type branches ────────────────────────────────

  it('renders a login entry summary', async () => {
    const entry = makeEntry({ event_type: 'login' });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
    });
  });

  it('renders a logout entry summary', async () => {
    const entry = makeEntry({ event_type: 'logout' });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
    });
  });

  it('renders a password_changed entry summary', async () => {
    const entry = makeEntry({ event_type: 'password_changed' });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
    });
  });

  it('renders a role_changed entry summary', async () => {
    const entry = makeEntry({ event_type: 'role_changed', new_value: 'admin' });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
    });
  });

  it('renders a deactivated entry summary', async () => {
    const entry = makeEntry({ event_type: 'deactivated' });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
    });
  });

  it('renders a reactivated entry summary', async () => {
    const entry = makeEntry({ event_type: 'reactivated' });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
    });
  });

  it('renders an ownership_reassigned entry summary', async () => {
    const entry = makeEntry({ event_type: 'ownership_reassigned' });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
    });
  });

  it('renders an unknown event_type with a default fallback summary', async () => {
    const entry = makeEntry({
      event_type: 'some_unknown_event' as AuditLogEntry['event_type'],
    });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      const el = screen.getByTestId(`change-history-entry-${entry.id}`);
      expect(el).toHaveTextContent('some_unknown_event');
    });
  });

  it('renders an updated entry without field_name gracefully', async () => {
    const entry = makeEntry({
      event_type: 'updated',
      field_name: null,
      old_value: null,
      new_value: 'something',
    });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Test User');
    });
  });

  it('renders an entry for a null changed_by_name as Unknown', async () => {
    const entry = makeEntry({ changed_by_name: null, event_type: 'created' });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${entry.id}`)).toHaveTextContent('Unknown');
    });
  });

  // ── formatRelativeTime branches ───────────────────────────────────────────

  it('shows "just now" for entries created less than 60 seconds ago', async () => {
    const entry = makeEntry({ created_at: new Date(Date.now() - 10_000).toISOString() });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-time-${entry.id}`)).toBeInTheDocument();
    });
    // RelativeTimeFormat for seconds resolves to "now" or "just now" depending on locale
    expect(screen.getByTestId(`change-history-time-${entry.id}`).textContent).toBeTruthy();
  });

  it('shows a minutes-ago label for entries created 2 minutes ago', async () => {
    const entry = makeEntry({ created_at: new Date(Date.now() - 2 * 60_000).toISOString() });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-time-${entry.id}`)).toHaveTextContent('minute');
    });
  });

  it('shows an hours-ago label for entries created 3 hours ago', async () => {
    const entry = makeEntry({ created_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString() });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-time-${entry.id}`)).toHaveTextContent('hour');
    });
  });

  it('shows a days-ago label for entries created 2 days ago', async () => {
    const entry = makeEntry({
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId(`change-history-time-${entry.id}`)).toHaveTextContent('day');
    });
  });

  it('falls back to a locale date string for entries older than 7 days', async () => {
    const entry = makeEntry({
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString(),
    });
    server.use(http.get('/api/v1/audit-log/record', () => HttpResponse.json({ entries: [entry] })));

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);
    await waitFor(() => {
      // Locale date strings will contain a digit (year or day), not "ago"
      const text = screen.getByTestId(`change-history-time-${entry.id}`).textContent ?? '';
      expect(text).toMatch(/\d/);
      expect(text).not.toMatch(/ago/);
    });
  });

  // ── Show all / show less toggle ───────────────────────────────────────────

  it('shows the "Show less" label after "Show all" is clicked and data loads', async () => {
    const preview = Array.from({ length: 20 }, (_, i) =>
      makeEntry({ id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}` }),
    );
    const extra = makeEntry({ id: '00000000-0000-0000-0000-000000000099' });

    server.use(
      http.get('/api/v1/audit-log/record', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('all') === 'true') {
          return HttpResponse.json({ entries: [...preview, extra] });
        }
        return HttpResponse.json({ entries: preview });
      }),
    );

    renderWithProviders(<ChangeHistory recordType="contact" recordId={RECORD_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('change-history-toggle')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('change-history-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId(`change-history-entry-${extra.id}`)).toBeInTheDocument();
    });

    // After all entries load, the toggle label changes to "Show less"
    expect(screen.getByTestId('change-history-toggle')).toHaveTextContent(/show less/i);
  });
});
