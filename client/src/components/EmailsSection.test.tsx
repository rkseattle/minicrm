import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ConnectedAccountResponse } from '@shared/schemas/connectedAccountSchema.js';
import type { EmailMessage, EmailThread } from '@shared/schemas/emailMessageSchema.js';
import { MY_FEATURE_FLAGS_QUERY_KEY } from '@/api/featureFlags.js';
import { EMAIL_MESSAGES_QUERY_KEY } from '@/api/emailMessages.js';
import { AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { allFlagsEnabled, authMeBody, VIEWER_USER } from '@/test/msw/handlers.js';
import EmailsSection, { threadDomId } from './EmailsSection.js';

const RECORD_ID = '00000000-0000-4000-8000-000000000a01';
const MAILBOX_ID = '00000000-0000-4000-8000-000000000a02';
const OTHER_MAILBOX_ID = '00000000-0000-4000-8000-000000000a03';

function message(overrides: Partial<EmailMessage>): EmailMessage {
  return {
    id: '00000000-0000-4000-8000-000000000b00',
    connected_account_id: MAILBOX_ID,
    thread_id: 't-1',
    direction: 'inbound',
    from_address: 'ada@client.test',
    to_addresses: ['rep@example.com'],
    cc_addresses: [],
    subject: 'Hello',
    snippet: 'snippet',
    has_attachments: false,
    sent_at: '2026-10-01T10:00:00Z',
    is_private: false,
    ...overrides,
  };
}

const FIRST = message({
  id: '00000000-0000-4000-8000-000000000b01',
  subject: 'Pricing question',
  snippet: 'What does it cost?',
  sent_at: '2026-10-01T10:00:00Z',
});
const SECOND = message({
  id: '00000000-0000-4000-8000-000000000b02',
  direction: 'outbound',
  from_address: 'rep@example.com',
  to_addresses: ['ada@client.test'],
  cc_addresses: ['boss@client.test', 'cfo@client.test'],
  subject: 'Re: Pricing question',
  snippet: 'It costs less than you think.',
  sent_at: '2026-10-02T10:00:00Z',
});
const OTHER = message({
  id: '00000000-0000-4000-8000-000000000b03',
  connected_account_id: OTHER_MAILBOX_ID,
  thread_id: 't-2',
  subject: 'Old thread',
  sent_at: '2026-09-01T10:00:00Z',
});

const THREADS: EmailThread[] = [
  // Delivered out of order within the thread: the section must order it.
  { thread_id: 't-1', connected_account_id: MAILBOX_ID, messages: [SECOND, FIRST] },
  { thread_id: 't-2', connected_account_id: OTHER_MAILBOX_ID, messages: [OTHER] },
];

// Safe: THREADS is a two-element literal above.
const T1 = threadDomId(THREADS[0]!);
// Safe: as above.
const T2 = threadDomId(THREADS[1]!);

function mailbox(overrides: Partial<ConnectedAccountResponse> = {}): ConnectedAccountResponse {
  return {
    id: MAILBOX_ID,
    provider: 'google',
    email_address: 'rep@example.com',
    granted_scopes: [],
    can_send: true,
    status: 'active',
    status_detail: null,
    last_sync_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Turns email sync on and serves the given threads, mailboxes, and bodies. */
function serve(
  options: {
    threads?: EmailThread[];
    total?: number;
    accounts?: ConnectedAccountResponse[];
    pages?: number[];
    bodies?: string[];
  } = {},
): void {
  const threads = options.threads ?? THREADS;
  server.use(
    http.get('/api/v1/feature-flags/me', () =>
      HttpResponse.json({ flags: { ...allFlagsEnabled(), email_sync: true } }),
    ),
    http.get('/api/v1/connected-accounts', () =>
      HttpResponse.json({ accounts: options.accounts ?? [mailbox()] }),
    ),
    http.get('/api/v1/email-messages', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page'));
      options.pages?.push(page);
      return HttpResponse.json({
        data: threads,
        total: options.total ?? threads.length,
        page,
        limit: 10,
      });
    }),
    http.get('/api/v1/email-messages/:id', ({ params }) => {
      // Safe: the route's one path parameter is always a string.
      options.bodies?.push(params['id'] as string);
      return HttpResponse.json({
        message: {
          ...FIRST,
          id: params['id'],
          body_text: 'Plain fallback',
          body_html:
            params['id'] === OTHER.id
              ? null
              : '<p>Html body</p><script>bad()</script><img src="https://t.test/p.png">',
        },
      });
    }),
  );
}

function renderSection(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  renderWithProviders(
    <EmailsSection recordType="contact" recordId={RECORD_ID} defaultRecipient="ada@client.test" />,
    { queryClient },
  );
  return queryClient;
}

/** Waits until every query under `key` has answered, so an absence is a decision, not a delay. */
async function settled(queryClient: QueryClient, key: QueryKey): Promise<void> {
  await waitFor(() => {
    const states = queryClient.getQueryCache().findAll({ queryKey: key });
    expect(states.length).toBeGreaterThan(0);
    for (const query of states) expect(query.state.status).not.toBe('pending');
  });
}

describe('EmailsSection — when it shows', () => {
  it('is hidden, and reads nothing, while email sync is off', async () => {
    let listRequests = 0;
    server.use(
      http.get('/api/v1/email-messages', () => {
        listRequests += 1;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10 });
      }),
    );
    const queryClient = renderSection();

    await settled(queryClient, MY_FEATURE_FLAGS_QUERY_KEY);
    expect(screen.queryByTestId('emails-section')).not.toBeInTheDocument();
    expect(listRequests).toBe(0);
  });

  it('is hidden from a user who cannot manage mailboxes', async () => {
    serve();
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json(authMeBody(VIEWER_USER))));
    const queryClient = renderSection();

    await settled(queryClient, MY_FEATURE_FLAGS_QUERY_KEY);
    await settled(queryClient, AUTH_QUERY_KEY);
    expect(screen.queryByTestId('emails-section')).not.toBeInTheDocument();
  });

  it('hides itself when the record refuses the reader', async () => {
    serve();
    server.use(
      http.get('/api/v1/email-messages', () =>
        HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 }),
      ),
    );
    const queryClient = renderSection();

    await settled(queryClient, EMAIL_MESSAGES_QUERY_KEY);
    expect(screen.queryByTestId('emails-section')).not.toBeInTheDocument();
  });
});

describe('EmailsSection — states', () => {
  it('shows loading, then the threads', async () => {
    serve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/v1/email-messages', async () => {
        await gate;
        return HttpResponse.json({ data: THREADS, total: THREADS.length, page: 1, limit: 10 });
      }),
    );
    renderSection();

    expect(await screen.findByTestId('emails-loading')).toBeInTheDocument();
    release();
    expect(await screen.findByTestId(`email-thread-${T1}`)).toBeInTheDocument();
  });

  it('says when the list could not be loaded', async () => {
    serve();
    server.use(
      http.get('/api/v1/email-messages', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 }),
      ),
    );
    renderSection();

    expect(await screen.findByTestId('emails-error')).toBeInTheDocument();
  });

  it('says when no mail is linked', async () => {
    serve({ threads: [] });
    renderSection();

    expect(await screen.findByTestId('emails-empty')).toBeInTheDocument();
  });
});

describe('EmailsSection — threads', () => {
  it('lists threads in the order the server gives, latest first', async () => {
    serve();
    renderSection();

    const list = await screen.findByTestId('emails-thread-list');
    const rows = within(list).getAllByRole('button', { expanded: false });
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      `email-thread-row-${T1}`,
      `email-thread-row-${T2}`,
    ]);
  });

  it('shows a collapsed row as participants, the latest subject, snippet, date and direction', async () => {
    serve();
    renderSection();

    const row = await screen.findByTestId(`email-thread-row-${T1}`);
    expect(within(row).getByTestId('email-thread-participants')).toHaveTextContent(
      'ada@client.test, rep@example.com, boss@client.test +1 more',
    );
    expect(within(row).getByTestId('email-thread-subject')).toHaveTextContent(
      'Re: Pricing question',
    );
    expect(within(row).getByTestId('email-thread-snippet')).toHaveTextContent('It costs less');
    expect(within(row).getByTestId('email-thread-date')).toHaveTextContent('2026');
    expect(within(row).getByTestId('email-direction-outbound')).toBeInTheDocument();
  });

  it('opens a thread on its latest message, the older ones collapsed and unread', async () => {
    const bodies: string[] = [];
    serve({ bodies });
    renderSection();

    const row = await screen.findByTestId(`email-thread-row-${T1}`);
    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    const articles = screen.getAllByTestId(/^email-message-[0-9a-f-]{36}$/);
    expect(articles.map((article) => article.getAttribute('data-testid'))).toEqual([
      `email-message-${FIRST.id}`,
      `email-message-${SECOND.id}`,
    ]);
    // Safe: the order assertion above proved two articles.
    expect(within(articles[0]!).getByTestId('email-direction-inbound')).toBeInTheDocument();
    expect(screen.getByTestId(`email-message-toggle-${FIRST.id}`)).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByTestId(`email-message-snippet-${FIRST.id}`)).toHaveTextContent(
      'What does it cost?',
    );
    expect(screen.getByTestId(`email-message-toggle-${SECOND.id}`)).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const frame = await screen.findByTestId('email-body-frame');
    expect(frame.getAttribute('srcdoc')).toContain('Html body');
    expect(frame.getAttribute('srcdoc')).not.toContain('bad()');
    expect(frame.getAttribute('srcdoc')).not.toContain('t.test');
    expect(bodies).toEqual([SECOND.id]);
  });

  it('reads an older message only when the reader opens it, and closes the latest on request', async () => {
    const bodies: string[] = [];
    serve({ bodies });
    renderSection();
    fireEvent.click(await screen.findByTestId(`email-thread-row-${T1}`));
    await screen.findByTestId('email-body-frame');

    fireEvent.click(screen.getByTestId(`email-message-toggle-${FIRST.id}`));
    await waitFor(() => expect(screen.getAllByTestId('email-body-frame')).toHaveLength(2));
    fireEvent.click(screen.getByTestId(`email-message-toggle-${SECOND.id}`));

    expect(screen.getByTestId(`email-message-toggle-${SECOND.id}`)).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getAllByTestId('email-body-frame')).toHaveLength(1);
    expect(bodies).toEqual([SECOND.id, FIRST.id]);
  });

  it('collapses again on a second press', async () => {
    serve();
    renderSection();
    const row = await screen.findByTestId(`email-thread-row-${T1}`);

    fireEvent.click(row);
    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId(`email-message-${FIRST.id}`)).not.toBeInTheDocument();
  });

  it('shows plain text for a message with no HTML body', async () => {
    serve();
    renderSection();

    fireEvent.click(await screen.findByTestId(`email-thread-row-${T2}`));

    expect(await screen.findByTestId(`email-body-text-${OTHER.id}`)).toHaveTextContent(
      'Plain fallback',
    );
  });

  it('says when a body could not be loaded', async () => {
    serve();
    server.use(
      http.get('/api/v1/email-messages/:id', () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 }),
      ),
    );
    renderSection();

    fireEvent.click(await screen.findByTestId(`email-thread-row-${T2}`));

    expect(await screen.findByTestId(`email-body-error-${OTHER.id}`)).toBeInTheDocument();
  });

  it('shows a body loading, then the body', async () => {
    serve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/v1/email-messages/:id', async ({ params }) => {
        await gate;
        return HttpResponse.json({
          message: { ...OTHER, id: params['id'], body_text: 'Plain fallback', body_html: null },
        });
      }),
    );
    renderSection();
    fireEvent.click(await screen.findByTestId(`email-thread-row-${T2}`));

    expect(await screen.findByTestId(`email-body-loading-${OTHER.id}`)).toBeInTheDocument();
    release();
    expect(await screen.findByTestId(`email-body-text-${OTHER.id}`)).toHaveTextContent(
      'Plain fallback',
    );
  });

  it('falls back to the snippet, then to nothing, for a message with no stored body', async () => {
    serve({
      threads: [
        {
          thread_id: 't-2',
          connected_account_id: OTHER_MAILBOX_ID,
          messages: [{ ...OTHER, snippet: null }],
        },
      ],
    });
    server.use(
      http.get('/api/v1/email-messages/:id', ({ params }) =>
        HttpResponse.json({
          message: { ...OTHER, id: params['id'], snippet: null, body_text: null, body_html: null },
        }),
      ),
    );
    renderSection();
    fireEvent.click(await screen.findByTestId(`email-thread-row-${T2}`));

    expect(await screen.findByTestId(`email-body-text-${OTHER.id}`)).toBeEmptyDOMElement();
  });

  it('shows images for one thread only when the reader asks', async () => {
    serve();
    renderSection();
    fireEvent.click(await screen.findByTestId(`email-thread-row-${T1}`));
    const [frame] = await screen.findAllByTestId('email-body-frame');
    // Safe: findAll resolves only with at least one match.
    expect(frame!.getAttribute('srcdoc')).toContain("img-src 'none'");

    fireEvent.click(screen.getByTestId(`email-thread-show-images-${T1}`));

    // Safe: the frames were found above and remain rendered.
    await waitFor(() =>
      expect(screen.getAllByTestId('email-body-frame')[0]!.getAttribute('srcdoc')).toContain(
        'img-src https:',
      ),
    );
    // Safe: as above.
    expect(screen.getAllByTestId('email-body-frame')[0]!.getAttribute('srcdoc')).toContain(
      'https://t.test/p.png',
    );
  });

  it('moves between rows with the arrow, Home and End keys', async () => {
    serve();
    renderSection();
    const first = await screen.findByTestId(`email-thread-row-${T1}`);
    const second = screen.getByTestId(`email-thread-row-${T2}`);
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'Home' });
    expect(first).toHaveFocus();
  });

  it('pages through threads', async () => {
    const pages: number[] = [];
    serve({ total: 25, pages });
    renderSection();
    await screen.findByTestId(`email-thread-${T1}`);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => expect(pages).toContain(2));
  });
});

describe('EmailsSection — compose and reply', () => {
  it('disables Compose and Reply, saying why, when no mailbox can send', async () => {
    serve({ accounts: [mailbox({ can_send: false })] });
    renderSection();

    const compose = await screen.findByTestId('emails-compose');
    await waitFor(() => expect(compose).toBeDisabled());
    expect(compose.parentElement).toHaveAttribute(
      'title',
      expect.stringMatching(/connect a mailbox/i),
    );
    fireEvent.click(screen.getByTestId(`email-thread-row-${T1}`));
    expect(screen.getByTestId(`email-reply-${SECOND.id}`)).toBeDisabled();
  });

  it('disables Reply only where the conversation’s mailbox cannot send', async () => {
    serve();
    renderSection();

    fireEvent.click(await screen.findByTestId(`email-thread-row-${T2}`));
    fireEvent.click(screen.getByTestId(`email-thread-row-${T1}`));

    await waitFor(() => expect(screen.getByTestId(`email-reply-${SECOND.id}`)).not.toBeDisabled());
    expect(screen.getByTestId(`email-reply-${OTHER.id}`)).toBeDisabled();
  });

  it('composes a new message to the record, filed on it', async () => {
    serve();
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/v1/email-messages/send', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ message: SECOND, unresolved_merge_tags: [] }, { status: 201 });
      }),
    );
    renderSection();
    const compose = await screen.findByTestId('emails-compose');
    await waitFor(() => expect(compose).not.toBeDisabled());

    fireEvent.click(compose);
    expect(screen.getByTestId('email-composer-to')).toHaveValue('ada@client.test');
    fireEvent.change(screen.getByTestId('email-composer-subject'), { target: { value: 'Hi' } });
    fireEvent.change(screen.getByTestId('email-composer-body'), { target: { value: 'Body' } });
    fireEvent.click(screen.getByTestId('email-composer-send'));

    expect(await screen.findByTestId('email-composer-success')).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        connected_account_id: MAILBOX_ID,
        to: ['ada@client.test'],
        cc: [],
        subject: 'Hi',
        body_html: '<p>Body</p>',
        record_type: 'contact',
        record_id: RECORD_ID,
      },
    ]);
  });

  it('refreshes the thread list after a send without reading any body again', async () => {
    const pages: number[] = [];
    const bodies: string[] = [];
    serve({ pages, bodies });
    server.use(
      http.post('/api/v1/email-messages/send', () =>
        HttpResponse.json({ message: SECOND, unresolved_merge_tags: [] }, { status: 201 }),
      ),
    );
    renderSection();
    fireEvent.click(await screen.findByTestId(`email-thread-row-${T1}`));
    await screen.findByTestId('email-body-frame');
    const compose = screen.getByTestId('emails-compose');
    await waitFor(() => expect(compose).not.toBeDisabled());

    fireEvent.click(compose);
    fireEvent.change(screen.getByTestId('email-composer-subject'), { target: { value: 'Hi' } });
    fireEvent.change(screen.getByTestId('email-composer-body'), { target: { value: 'Body' } });
    fireEvent.click(screen.getByTestId('email-composer-send'));
    await screen.findByTestId('email-composer-success');

    await waitFor(() => expect(pages).toHaveLength(2));
    expect(bodies).toEqual([SECOND.id]);
  });

  it('replies to the sender, in the conversation, from its mailbox', async () => {
    serve();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post('/api/v1/email-messages/send', async ({ request }) => {
        // Safe: the composer always posts a JSON object.
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ message: SECOND, unresolved_merge_tags: [] }, { status: 201 });
      }),
    );
    renderSection();
    fireEvent.click(await screen.findByTestId(`email-thread-row-${T1}`));
    fireEvent.click(screen.getByTestId(`email-message-toggle-${FIRST.id}`));
    const reply = screen.getByTestId(`email-reply-${FIRST.id}`);
    await waitFor(() => expect(reply).not.toBeDisabled());

    fireEvent.click(reply);
    expect(screen.getByTestId('email-composer-to')).toHaveValue('ada@client.test');
    expect(screen.getByTestId('email-composer-subject')).toHaveValue('Re: Pricing question');
    expect(screen.getByTestId('email-composer-from')).toBeDisabled();
    fireEvent.change(screen.getByTestId('email-composer-body'), { target: { value: 'Thanks' } });
    fireEvent.click(screen.getByTestId('email-composer-send'));

    await screen.findByTestId('email-composer-success');
    expect(bodies[0]).toMatchObject({
      connected_account_id: MAILBOX_ID,
      to: ['ada@client.test'],
      in_reply_to_message_id: FIRST.id,
      record_type: 'contact',
      record_id: RECORD_ID,
    });
  });

  it('says the mailboxes failed to load, without claiming the user has none', async () => {
    serve();
    server.use(
      http.get('/api/v1/connected-accounts', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 }),
      ),
    );
    renderSection();

    expect(await screen.findByTestId('emails-accounts-error')).toBeInTheDocument();
    const compose = screen.getByTestId('emails-compose');
    expect(compose).toBeDisabled();
    expect(compose.parentElement).not.toHaveAttribute('title');
    expect(compose).not.toHaveAttribute('aria-describedby');
  });

  it('claims nothing about mailboxes while they are still loading', async () => {
    serve();
    server.use(http.get('/api/v1/connected-accounts', () => new Promise<never>(() => {})));
    renderSection();

    const compose = await screen.findByTestId('emails-compose');
    expect(compose.parentElement).not.toHaveAttribute('title');
    expect(compose).not.toHaveAttribute('aria-describedby');
  });
});

describe('EmailsSection — identity and paging edges', () => {
  it('keeps two mailboxes\u2019 copies of one conversation apart', async () => {
    const shared: EmailThread[] = [
      { thread_id: 'same-root@x', connected_account_id: MAILBOX_ID, messages: [FIRST] },
      {
        thread_id: 'same-root@x',
        connected_account_id: OTHER_MAILBOX_ID,
        messages: [{ ...OTHER, thread_id: 'same-root@x' }],
      },
    ];
    serve({ threads: shared });
    renderSection();

    // Safe: the literal above has two threads.
    const first = await screen.findByTestId(`email-thread-row-${threadDomId(shared[0]!)}`);
    // Safe: as above.
    const second = screen.getByTestId(`email-thread-row-${threadDomId(shared[1]!)}`);
    expect(first).not.toBe(second);
    fireEvent.click(first);
    fireEvent.click(second);
    expect(first.getAttribute('aria-controls')).toBeTruthy();
    expect(first.getAttribute('aria-controls')).not.toBe(second.getAttribute('aria-controls'));
  });

  it('offers the way back from a page that has emptied', async () => {
    serve();
    server.use(
      http.get('/api/v1/email-messages', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        return HttpResponse.json({
          data: page === 1 ? THREADS : [],
          total: 25,
          page,
          limit: 10,
        });
      }),
    );
    renderSection();
    await screen.findByTestId(`email-thread-${T1}`);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(await screen.findByRole('button', { name: /previous/i })).not.toBeDisabled();
    expect(screen.queryByTestId('emails-empty')).not.toBeInTheDocument();
  });
});
