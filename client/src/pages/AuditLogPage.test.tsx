/**
 * Tests for AuditLogPage.
 * (MINCRM-172, MINCRM-377)
 *
 * The page fetches audit data via ConnectRPC (auditClient), not REST.
 * Tests mock the auditClient module directly so no HTTP interception is needed.
 */

import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import AuditLogPage from './AuditLogPage.js';
// Note: MSW server from setup.ts is still active for other API calls (actors endpoint).

// ── Mock auditClient ─────────────────────────────────────────────────────────

const mockListAuditEvents = vi.fn();
const mockStreamAuditEvents = vi.fn();

vi.mock('@/grpc/auditClient.js', () => ({
  auditClient: {
    listAuditEvents: (...args: unknown[]) => mockListAuditEvents(...args),
    streamAuditEvents: (...args: unknown[]) => mockStreamAuditEvents(...args),
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A minimal proto-shaped AuditEvent for use in listAuditEvents responses. */
function makeProtoEvent(
  overrides: Partial<{
    id: string;
    recordType: string;
    recordId: string;
    action: string;
    fieldName: string;
    oldValue: string;
    newValue: string;
    changedBy: string;
    changedAt: string;
  }> = {},
) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    recordType: 'contact',
    recordId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    action: 'created',
    fieldName: '',
    oldValue: '',
    newValue: '',
    changedBy: 'Test Admin',
    changedAt: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

/** Returns a resolved AuditResponse wrapping the given events. */
function makeListResponse(events: ReturnType<typeof makeProtoEvent>[], total = events.length) {
  return Promise.resolve({ events, total, page: 1, limit: 50 });
}

/** Returns an async generator that yields nothing (idle stream). */
async function* idleStream() {
  // Never yields — simulates a quiet live stream.
  await new Promise(() => {});
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty list, idle stream.
  mockListAuditEvents.mockReturnValue(makeListResponse([]));
  mockStreamAuditEvents.mockReturnValue(idleStream());
});

// ── Tests ─────────────────────────────────────────────────────────────────────

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
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId('audit-log-empty-state')).toBeInTheDocument();
    });
  });

  it('renders entries from the API', async () => {
    const event = makeProtoEvent();
    mockListAuditEvents.mockReturnValue(makeListResponse([event]));

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-row-${event.id}`)).toBeInTheDocument();
    });
  });

  it('renders actor, event type, and record type columns', async () => {
    const event = makeProtoEvent();
    mockListAuditEvents.mockReturnValue(makeListResponse([event]));

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-actor-${event.id}`)).toHaveTextContent('Test Admin');
      expect(screen.getByTestId(`audit-log-record-type-${event.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`audit-log-event-${event.id}`)).toBeInTheDocument();
    });
  });

  it('shows error state when the gRPC call fails', async () => {
    mockListAuditEvents.mockRejectedValue(new Error('gRPC unavailable'));

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId('audit-log-error')).toBeInTheDocument();
    });
  });

  it('renders the filter toggle button', () => {
    renderWithProviders(<AuditLogPage />);
    expect(screen.getByTestId('filters-toggle')).toBeInTheDocument();
  });

  it('renders filter inputs after opening the filter panel', async () => {
    // BreakpointProvider initialises isDesktop=false; click once to open the panel.
    renderWithProviders(<AuditLogPage />);
    fireEvent.click(screen.getByTestId('filters-toggle'));
    expect(screen.getByTestId('filter-from')).toBeInTheDocument();
    expect(screen.getByTestId('filter-to')).toBeInTheDocument();
    expect(screen.getByTestId('filter-user')).toBeInTheDocument();
    expect(screen.getByTestId('filter-record-type')).toBeInTheDocument();
    expect(screen.getByTestId('filter-event-type')).toBeInTheDocument();
    expect(screen.getByTestId('apply-filters-button')).toBeInTheDocument();
    expect(screen.getByTestId('clear-filters-button')).toBeInTheDocument();
  });

  it('includes "Lead" as a selectable option in the record-type filter (MINCRM-363)', async () => {
    renderWithProviders(<AuditLogPage />);
    fireEvent.click(screen.getByTestId('filters-toggle'));
    const select = screen.getByTestId('filter-record-type') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('lead');
  });

  it('filters by lead record type when "Lead" is selected (MINCRM-363)', async () => {
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId('audit-log-empty-state'));
    fireEvent.click(screen.getByTestId('filters-toggle'));

    fireEvent.change(screen.getByTestId('filter-record-type'), { target: { value: 'lead' } });
    fireEvent.click(screen.getByTestId('apply-filters-button'));

    await waitFor(() => {
      const call = mockListAuditEvents.mock.calls.at(-1)?.[0] as
        | { recordType?: string }
        | undefined;
      expect(call?.recordType).toBe('lead');
    });
  });

  it('applies filters when the Apply button is clicked', async () => {
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId('audit-log-empty-state'));
    fireEvent.click(screen.getByTestId('filters-toggle'));

    fireEvent.change(screen.getByTestId('filter-record-type'), { target: { value: 'contact' } });
    fireEvent.click(screen.getByTestId('apply-filters-button'));

    await waitFor(() => {
      const call = mockListAuditEvents.mock.calls.at(-1)?.[0] as
        | { recordType?: string }
        | undefined;
      expect(call?.recordType).toBe('contact');
    });
  });

  it('passes eventType to the gRPC call when an event type is selected', async () => {
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId('audit-log-empty-state'));
    fireEvent.click(screen.getByTestId('filters-toggle'));

    fireEvent.change(screen.getByTestId('filter-event-type'), { target: { value: 'created' } });
    fireEvent.click(screen.getByTestId('apply-filters-button'));

    await waitFor(() => {
      const call = mockListAuditEvents.mock.calls.at(-1)?.[0] as { eventType?: string } | undefined;
      expect(call?.eventType).toBe('created');
    });
  });

  it('clears filters when the Clear button is clicked', async () => {
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId('audit-log-empty-state'));
    fireEvent.click(screen.getByTestId('filters-toggle'));

    fireEvent.change(screen.getByTestId('filter-record-type'), { target: { value: 'contact' } });
    fireEvent.click(screen.getByTestId('clear-filters-button'));

    expect((screen.getByTestId('filter-record-type') as HTMLSelectElement).value).toBe('');
  });

  it('shows pagination controls with next enabled when there are multiple pages (MINCRM-345)', async () => {
    const events = [
      makeProtoEvent({ id: '00000000-0000-0000-0000-000000000001' }),
      makeProtoEvent({ id: '00000000-0000-0000-0000-000000000002' }),
    ];
    mockListAuditEvents.mockReturnValue(
      Promise.resolve({ events, total: 100, page: 1, limit: 50 }),
    );

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId('pagination')).toBeInTheDocument();
      expect(screen.getByTestId('pagination-prev')).toBeDisabled();
      expect(screen.getByTestId('pagination-next')).not.toBeDisabled();
    });
  });

  it('shows pagination controls even when all entries fit on one page (MINCRM-345)', async () => {
    const event = makeProtoEvent();
    mockListAuditEvents.mockReturnValue(makeListResponse([event], 1));

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId(`audit-log-row-${event.id}`));
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
    expect(screen.getByTestId('pagination-prev')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
  });

  it('expands a row with field detail when the row button is clicked', async () => {
    const event = makeProtoEvent({
      action: 'updated',
      fieldName: 'email',
      oldValue: 'old@example.com',
      newValue: 'new@example.com',
    });
    mockListAuditEvents.mockReturnValue(makeListResponse([event]));

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-row-${event.id}`)).toBeInTheDocument();
    });

    expect(screen.queryByTestId(`audit-log-detail-${event.id}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`audit-log-row-button-${event.id}`));

    expect(screen.getByTestId(`audit-log-detail-${event.id}`)).toBeInTheDocument();
  });

  it('collapses an expanded row when clicked again', async () => {
    const event = makeProtoEvent({
      action: 'updated',
      fieldName: 'email',
      oldValue: 'old@example.com',
      newValue: 'new@example.com',
    });
    mockListAuditEvents.mockReturnValue(makeListResponse([event]));

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => screen.getByTestId(`audit-log-row-${event.id}`));

    const btn = screen.getByTestId(`audit-log-row-button-${event.id}`);
    fireEvent.click(btn);
    expect(screen.getByTestId(`audit-log-detail-${event.id}`)).toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.queryByTestId(`audit-log-detail-${event.id}`)).not.toBeInTheDocument();
  });

  it('renders the timestamp column', async () => {
    const event = makeProtoEvent();
    mockListAuditEvents.mockReturnValue(makeListResponse([event]));

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-time-${event.id}`)).toBeInTheDocument();
    });
  });

  it('prepends live events from the stream to the top of the first unfiltered page', async () => {
    const existing = makeProtoEvent({
      id: '00000000-0000-0000-0000-aaaaaaaaaaaa',
      changedBy: 'Existing',
    });
    const live = makeProtoEvent({
      id: '00000000-0000-0000-0000-bbbbbbbbbbbb',
      changedBy: 'Live Event',
    });

    mockListAuditEvents.mockReturnValue(makeListResponse([existing]));

    async function* streamWithEvent() {
      yield live;
      await new Promise(() => {});
    }
    mockStreamAuditEvents.mockReturnValue(streamWithEvent());

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-row-${live.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`audit-log-row-${existing.id}`)).toBeInTheDocument();
    });
  });

  it('reconnects the stream after a transient error and delivers subsequent events', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const eventAfterReconnect = makeProtoEvent({ id: '00000000-0000-0000-0000-cccccccccccc' });

      // First call: throws immediately (simulates proxy timeout / network error).
      // Second call: yields an event then hangs (simulates successful reconnect).
      async function* failThenSucceed() {
        throw new Error('simulated network error');
      }
      async function* streamAfterReconnect() {
        yield eventAfterReconnect;
        await new Promise(() => {});
      }
      mockStreamAuditEvents
        .mockReturnValueOnce(failThenSucceed())
        .mockReturnValue(streamAfterReconnect());

      renderWithProviders(<AuditLogPage />);

      // Advance past the initial 1 s backoff delay.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });

      await waitFor(() => {
        expect(screen.getByTestId(`audit-log-row-${eventAfterReconnect.id}`)).toBeInTheDocument();
      });
      expect(mockStreamAuditEvents).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears live events when a filter is applied', async () => {
    const live = makeProtoEvent({ id: '00000000-0000-0000-0000-bbbbbbbbbbbb' });

    async function* streamWithEvent() {
      yield live;
      await new Promise(() => {});
    }
    mockStreamAuditEvents.mockReturnValue(streamWithEvent());

    renderWithProviders(<AuditLogPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`audit-log-row-${live.id}`)).toBeInTheDocument();
    });

    // Open the filter panel, select a record type, then apply.
    fireEvent.click(screen.getByTestId('filters-toggle'));
    await waitFor(() => screen.getByTestId('filter-record-type'));
    fireEvent.change(screen.getByTestId('filter-record-type'), { target: { value: 'contact' } });
    fireEvent.click(screen.getByTestId('apply-filters-button'));

    // Live events are cleared when filters change.
    await waitFor(() => {
      expect(screen.queryByTestId(`audit-log-row-${live.id}`)).not.toBeInTheDocument();
    });
  });
});
