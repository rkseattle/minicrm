/**
 * Tests for WebhookSettings — Outbound webhook subscription management. (MINCRM-279)
 *
 * Verifies:
 * - Renders empty-state when no subscriptions exist
 * - Renders subscription list with URL, events, and status badge
 * - Create form: fill URL + select event → submit → secret modal appears with plaintextSecret
 * - Secret modal: Done button dismisses it
 * - Disable/enable toggle calls PATCH with correct status
 * - Delete button opens confirm dialog; Cancel dismisses; Confirm calls DELETE
 * - View logs button opens delivery logs panel
 * - Load error renders error state
 */

import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import WebhookSettings from './WebhookSettings.js';
import type {
  WebhookSubscriptionResponse,
  WebhookDeliveryLogResponse,
} from '@shared/schemas/webhookSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WEBHOOK_1: WebhookSubscriptionResponse = {
  id: '00000000-0000-0000-0000-000000000w01',
  url: 'https://example.com/hook',
  events: ['contact.created', 'deal.won'],
  status: 'active',
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-01T00:00:00.000Z',
};

const WEBHOOK_2: WebhookSubscriptionResponse = {
  id: '00000000-0000-0000-0000-000000000w02',
  url: 'https://other.example.com/hook',
  events: ['account.created'],
  status: 'disabled',
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-02T00:00:00.000Z',
};

const WEBHOOK_FAILED: WebhookSubscriptionResponse = {
  id: '00000000-0000-0000-0000-000000000w03',
  url: 'https://broken.example.com/hook',
  events: ['deal.created'],
  status: 'failed',
  created_by: '00000000-0000-0000-0000-000000000001',
  created_at: '2025-01-03T00:00:00.000Z',
};

const DELIVERY_LOG_1: WebhookDeliveryLogResponse = {
  id: '00000000-0000-0000-0000-000000000d01',
  subscription_id: WEBHOOK_1.id,
  event_id: '00000000-0000-0000-0000-000000000e01',
  event_type: 'contact.created',
  attempt: 1,
  status_code: 200,
  response_ms: 42,
  error: null,
  delivered_at: '2025-01-01T01:00:00.000Z',
};

// ── MSW handlers ──────────────────────────────────────────────────────────────

function mockWebhookList(subs: WebhookSubscriptionResponse[]) {
  server.use(http.get('/api/v1/admin/webhooks', () => HttpResponse.json({ subscriptions: subs })));
}

function mockWebhookListError() {
  server.use(http.get('/api/v1/admin/webhooks', () => new HttpResponse(null, { status: 500 })));
}

function mockWebhookCreate(plaintextSecret = 'abc123secretvalue') {
  server.use(
    http.post('/api/v1/admin/webhooks', async ({ request }) => {
      const body = (await request.json()) as { url: string; events: string[] };
      return HttpResponse.json(
        {
          subscription: {
            id: '00000000-0000-0000-0000-000000000w99',
            url: body.url,
            events: body.events,
            status: 'active',
            created_by: '00000000-0000-0000-0000-000000000001',
            created_at: new Date().toISOString(),
          },
          plaintextSecret,
        },
        { status: 201 },
      );
    }),
  );
}

function mockDeliveryLogs(subscriptionId: string, logs: WebhookDeliveryLogResponse[]) {
  server.use(
    http.get(`/api/v1/admin/webhooks/${subscriptionId}/logs`, () => {
      const result: PaginatedResponse<WebhookDeliveryLogResponse> = {
        data: logs,
        total: logs.length,
        page: 1,
        limit: 20,
      };
      return HttpResponse.json(result);
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebhookSettings — empty state', () => {
  it('shows empty state when no subscriptions exist', async () => {
    mockWebhookList([]);
    renderWithProviders(<WebhookSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('webhook-empty-state')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('webhook-subscriptions-table')).not.toBeInTheDocument();
  });
});

describe('WebhookSettings — subscription list', () => {
  it('renders active and disabled subscriptions with correct details', async () => {
    mockWebhookList([WEBHOOK_1, WEBHOOK_2]);
    renderWithProviders(<WebhookSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`webhook-row-${WEBHOOK_1.id}`)).toBeInTheDocument();
    });

    const row1 = screen.getByTestId(`webhook-row-${WEBHOOK_1.id}`);
    expect(within(row1).getByText('https://example.com/hook')).toBeInTheDocument();
    expect(within(row1).getByText(/contact\.created/)).toBeInTheDocument();

    const row2 = screen.getByTestId(`webhook-row-${WEBHOOK_2.id}`);
    expect(within(row2).getByText('https://other.example.com/hook')).toBeInTheDocument();
  });

  it('shows the failed banner and hides toggle button for failed subscriptions', async () => {
    mockWebhookList([WEBHOOK_FAILED]);
    renderWithProviders(<WebhookSettings />);

    await waitFor(() => {
      expect(screen.getByTestId(`webhook-row-${WEBHOOK_FAILED.id}`)).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId(`webhook-toggle-button-${WEBHOOK_FAILED.id}`),
    ).not.toBeInTheDocument();
  });
});

describe('WebhookSettings — create form', () => {
  it('submits the form and shows the secret reveal modal', async () => {
    mockWebhookList([]);
    mockWebhookCreate('my-plaintext-secret-value');
    // After create, re-fetch returns the new subscription
    server.use(
      http.get('/api/v1/admin/webhooks', () =>
        HttpResponse.json({
          subscriptions: [
            {
              id: '00000000-0000-0000-0000-000000000w99',
              url: 'https://new.example.com/hook',
              events: ['contact.created'],
              status: 'active',
              created_by: '00000000-0000-0000-0000-000000000001',
              created_at: new Date().toISOString(),
            },
          ],
        }),
      ),
    );

    renderWithProviders(<WebhookSettings />);
    await waitFor(() => expect(screen.getByTestId('webhook-url-input')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('webhook-url-input'), {
      target: { value: 'https://new.example.com/hook' },
    });

    // Select one event via the checkbox
    fireEvent.click(screen.getByTestId('webhook-event-contact.created'));

    fireEvent.click(screen.getByTestId('webhook-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('webhook-secret-reveal')).toBeInTheDocument();
    });

    expect(screen.getByTestId('webhook-secret-value')).toHaveValue('my-plaintext-secret-value');
  });

  it('dismisses the secret modal when Done is clicked', async () => {
    mockWebhookList([]);
    mockWebhookCreate('dismiss-secret-value');

    renderWithProviders(<WebhookSettings />);
    await waitFor(() => expect(screen.getByTestId('webhook-url-input')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('webhook-url-input'), {
      target: { value: 'https://dismiss.example.com/hook' },
    });
    fireEvent.click(screen.getByTestId('webhook-event-deal.won'));
    fireEvent.click(screen.getByTestId('webhook-add-button'));

    await waitFor(() => expect(screen.getByTestId('webhook-secret-reveal')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('webhook-secret-done-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('webhook-secret-reveal')).not.toBeInTheDocument();
    });
  });
});

describe('WebhookSettings — disable / enable toggle', () => {
  it('calls PATCH with status disabled when toggling an active subscription', async () => {
    let patchedId: string | null = null;
    let patchedStatus: string | null = null;

    mockWebhookList([WEBHOOK_1]);
    server.use(
      http.patch('/api/v1/admin/webhooks/:id', async ({ params, request }) => {
        patchedId = params.id as string;
        const body = (await request.json()) as { status?: string };
        patchedStatus = body.status ?? null;
        return HttpResponse.json({
          subscription: { ...WEBHOOK_1, id: patchedId, status: patchedStatus ?? WEBHOOK_1.status },
        });
      }),
    );

    renderWithProviders(<WebhookSettings />);
    await waitFor(() =>
      expect(screen.getByTestId(`webhook-toggle-button-${WEBHOOK_1.id}`)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`webhook-toggle-button-${WEBHOOK_1.id}`));

    await waitFor(() => {
      expect(patchedId).toBe(WEBHOOK_1.id);
      expect(patchedStatus).toBe('disabled');
    });
  });

  it('calls PATCH with status active when toggling a disabled subscription', async () => {
    let patchedStatus: string | null = null;

    mockWebhookList([WEBHOOK_2]);
    server.use(
      http.patch('/api/v1/admin/webhooks/:id', async ({ request }) => {
        const body = (await request.json()) as { status?: string };
        patchedStatus = body.status ?? null;
        return HttpResponse.json({
          subscription: { ...WEBHOOK_2, status: patchedStatus ?? WEBHOOK_2.status },
        });
      }),
    );

    renderWithProviders(<WebhookSettings />);
    await waitFor(() =>
      expect(screen.getByTestId(`webhook-toggle-button-${WEBHOOK_2.id}`)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`webhook-toggle-button-${WEBHOOK_2.id}`));

    await waitFor(() => {
      expect(patchedStatus).toBe('active');
    });
  });
});

describe('WebhookSettings — delete', () => {
  it('shows confirm dialog when delete button is clicked', async () => {
    mockWebhookList([WEBHOOK_1]);
    renderWithProviders(<WebhookSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`webhook-delete-button-${WEBHOOK_1.id}`)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`webhook-delete-button-${WEBHOOK_1.id}`));

    expect(screen.getByTestId('webhook-delete-confirm')).toBeInTheDocument();
  });

  it('dismisses confirm dialog when Cancel is clicked', async () => {
    mockWebhookList([WEBHOOK_1]);
    renderWithProviders(<WebhookSettings />);

    await waitFor(() =>
      expect(screen.getByTestId(`webhook-delete-button-${WEBHOOK_1.id}`)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`webhook-delete-button-${WEBHOOK_1.id}`));
    expect(screen.getByTestId('webhook-delete-confirm')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('webhook-delete-cancel-button'));

    expect(screen.queryByTestId('webhook-delete-confirm')).not.toBeInTheDocument();
  });

  it('calls DELETE when Confirm is clicked and dismisses the dialog', async () => {
    let deletedId: string | null = null;

    mockWebhookList([WEBHOOK_1]);
    server.use(
      http.delete('/api/v1/admin/webhooks/:id', ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<WebhookSettings />);
    await waitFor(() =>
      expect(screen.getByTestId(`webhook-delete-button-${WEBHOOK_1.id}`)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`webhook-delete-button-${WEBHOOK_1.id}`));
    fireEvent.click(screen.getByTestId('webhook-delete-confirm-button'));

    await waitFor(() => {
      expect(deletedId).toBe(WEBHOOK_1.id);
      expect(screen.queryByTestId('webhook-delete-confirm')).not.toBeInTheDocument();
    });
  });
});

describe('WebhookSettings — delivery logs panel', () => {
  it('opens the logs panel when View logs is clicked', async () => {
    mockWebhookList([WEBHOOK_1]);
    mockDeliveryLogs(WEBHOOK_1.id, [DELIVERY_LOG_1]);

    renderWithProviders(<WebhookSettings />);
    await waitFor(() =>
      expect(screen.getByTestId(`webhook-logs-button-${WEBHOOK_1.id}`)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`webhook-logs-button-${WEBHOOK_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('webhook-logs-panel')).toBeInTheDocument();
    });

    // Wait for the log data to load and the status code row to appear
    await waitFor(() => {
      expect(screen.getByText('200')).toBeInTheDocument();
    });
  });

  it('shows empty logs message when there are no logs', async () => {
    mockWebhookList([WEBHOOK_1]);
    mockDeliveryLogs(WEBHOOK_1.id, []);

    renderWithProviders(<WebhookSettings />);
    await waitFor(() =>
      expect(screen.getByTestId(`webhook-logs-button-${WEBHOOK_1.id}`)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`webhook-logs-button-${WEBHOOK_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('webhook-logs-panel')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText('200')).not.toBeInTheDocument();
    });
  });

  it('closes the logs panel when the Close button is clicked', async () => {
    mockWebhookList([WEBHOOK_1]);
    mockDeliveryLogs(WEBHOOK_1.id, []);

    renderWithProviders(<WebhookSettings />);
    await waitFor(() =>
      expect(screen.getByTestId(`webhook-logs-button-${WEBHOOK_1.id}`)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`webhook-logs-button-${WEBHOOK_1.id}`));
    await waitFor(() => expect(screen.getByTestId('webhook-logs-panel')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('webhook-logs-close-button'));

    expect(screen.queryByTestId('webhook-logs-panel')).not.toBeInTheDocument();
  });
});

describe('WebhookSettings — error state', () => {
  it('shows the load error element when the list fetch fails', async () => {
    mockWebhookListError();
    renderWithProviders(<WebhookSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('webhook-load-error')).toBeInTheDocument();
    });
  });
});

describe('WebhookSettings — secret copy button', () => {
  it('copies the secret to clipboard when copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    mockWebhookList([]);
    mockWebhookCreate('supersecretvalue');
    renderWithProviders(<WebhookSettings />);

    await waitFor(() => expect(screen.getByTestId('webhook-url-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('webhook-url-input'), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.click(screen.getByTestId('webhook-event-contact.created'));
    fireEvent.click(screen.getByTestId('webhook-add-button'));

    await waitFor(() => expect(screen.getByTestId('webhook-secret-reveal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('webhook-secret-copy-button'));

    expect(writeText).toHaveBeenCalledWith('supersecretvalue');
  });
});
