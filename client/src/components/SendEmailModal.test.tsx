/**
 * Tests for SendEmailModal.
 */

import { useState } from 'react';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { allFlagsEnabled, authMeBody, VIEWER_USER } from '@/test/msw/handlers.js';
import type { ConnectedAccountResponse } from '@shared/schemas/connectedAccountSchema.js';
import { CLOSE_AFTER_SENT_MS } from '@/hooks/useMailboxSend.js';
import SendEmailModal from './SendEmailModal.js';

const CONTACT_ID = '00000000-0000-0000-0000-000000000c01';
const CONTACT_EMAIL = 'jane@example.com';
const CONTACT_NAME = 'Jane Smith';

const noop = () => {};

describe('SendEmailModal', () => {
  it('does not render when isOpen is false', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={false}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    expect(screen.queryByTestId('send-email-modal')).not.toBeInTheDocument();
  });

  it('renders To, Subject, and Body fields when open', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    expect(screen.getByTestId('send-email-modal')).toBeInTheDocument();
    expect(screen.getByTestId('send-email-to')).toHaveValue(CONTACT_EMAIL);
    expect(screen.getByTestId('send-email-subject')).toBeInTheDocument();
    expect(screen.getByTestId('send-email-body')).toBeInTheDocument();
  });

  it('To field is read-only', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    expect(screen.getByTestId('send-email-to')).toHaveAttribute('readonly');
  });

  it('Send button is disabled when subject and body are empty', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    expect(screen.getByTestId('send-email-submit')).toBeDisabled();
  });

  it('Send button is enabled when subject and body are filled', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('send-email-subject'), {
      target: { value: 'Hello' },
    });
    fireEvent.change(screen.getByTestId('send-email-body'), {
      target: { value: 'Body text' },
    });
    expect(screen.getByTestId('send-email-submit')).not.toBeDisabled();
  });

  it('shows "Email logged (SMTP not configured)" success message when delivered is false', async () => {
    const onSent = vi.fn();
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={onSent}
      />,
    );
    fireEvent.change(screen.getByTestId('send-email-subject'), {
      target: { value: 'Test subject' },
    });
    fireEvent.change(screen.getByTestId('send-email-body'), {
      target: { value: 'Test body' },
    });
    fireEvent.click(screen.getByTestId('send-email-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('send-email-success')).toBeInTheDocument();
    });
    expect(screen.getByTestId('send-email-success')).toHaveTextContent(
      'Email logged (SMTP not configured)',
    );
    expect(onSent).toHaveBeenCalledOnce();
  });

  it('locks the form once sent, so an edit and a second click cannot send again', async () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('send-email-subject'), { target: { value: 'S' } });
    fireEvent.change(screen.getByTestId('send-email-body'), { target: { value: 'B' } });
    fireEvent.click(screen.getByTestId('send-email-submit'));

    await screen.findByTestId('send-email-success');

    expect(screen.getByTestId('send-email-body')).toBeDisabled();
    expect(screen.getByTestId('send-email-submit')).toBeDisabled();
  });

  it('never lets a sent compose\u2019s close timer close the next one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const closes = vi.fn();
    function Harness() {
      const [isOpen, setIsOpen] = useState(true);
      return (
        <>
          <button type="button" data-testid="reopen" onClick={() => setIsOpen(true)} />
          <SendEmailModal
            isOpen={isOpen}
            contactId={CONTACT_ID}
            contactEmail={CONTACT_EMAIL}
            contactName={CONTACT_NAME}
            onClose={() => {
              closes();
              setIsOpen(false);
            }}
            onSent={noop}
          />
        </>
      );
    }
    try {
      renderWithProviders(<Harness />);
      fireEvent.change(screen.getByTestId('send-email-subject'), { target: { value: 'S' } });
      fireEvent.change(screen.getByTestId('send-email-body'), { target: { value: 'B' } });
      fireEvent.click(screen.getByTestId('send-email-submit'));
      await screen.findByTestId('send-email-success');

      fireEvent.click(screen.getByTestId('send-email-cancel'));
      fireEvent.click(screen.getByTestId('reopen'));
      act(() => {
        vi.advanceTimersByTime(CLOSE_AFTER_SENT_MS * 2);
      });

      expect(closes).toHaveBeenCalledOnce();
      expect(screen.getByTestId('send-email-modal')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows "Email sent to [name]" success message when delivered is true', async () => {
    server.use(
      http.post('/api/v1/contacts/:id/send-email', () => {
        return HttpResponse.json({
          delivered: true,
          activityId: '00000000-0000-0000-0000-000000000e02',
        });
      }),
    );

    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('send-email-subject'), {
      target: { value: 'Hi' },
    });
    fireEvent.change(screen.getByTestId('send-email-body'), {
      target: { value: 'Hey there' },
    });
    fireEvent.click(screen.getByTestId('send-email-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('send-email-success')).toBeInTheDocument();
    });
    expect(screen.getByTestId('send-email-success')).toHaveTextContent(
      `Email sent to ${CONTACT_NAME}`,
    );
  });

  it('shows an error message when the API returns an error', async () => {
    server.use(
      http.post('/api/v1/contacts/:id/send-email', () => {
        return HttpResponse.json(
          { error: { code: 'SMTP_ERROR', message: 'SMTP connection refused' } },
          { status: 500 },
        );
      }),
    );

    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('send-email-subject'), {
      target: { value: 'Test subject' },
    });
    fireEvent.change(screen.getByTestId('send-email-body'), {
      target: { value: 'Test body' },
    });
    fireEvent.click(screen.getByTestId('send-email-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('send-email-error')).toBeInTheDocument();
    });
    // Must show the i18n translation, not the raw English server message
    expect(screen.getByTestId('send-email-error')).not.toHaveTextContent('SMTP connection refused');
    expect(screen.getByTestId('send-email-error')).toHaveTextContent(
      'Failed to send email. Please check your SMTP settings.',
    );
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={onClose}
        onSent={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('send-email-cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Tab inside the dialog', () => {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
    );
    const cancel = screen.getByTestId('send-email-cancel');
    cancel.focus();

    fireEvent.keyDown(cancel, { key: 'Tab' });

    expect(screen.getByTestId('send-email-to')).toHaveFocus();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={onClose}
        onSent={noop}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('send-email-modal'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={onClose}
        onSent={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('send-email-modal'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('SendEmailModal — sending through a connected mailbox', () => {
  const MAILBOX_ID = '00000000-0000-4000-8000-0000000000f1';
  const TEMPLATE_ID = '00000000-0000-4000-8000-0000000000f2';

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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  /** Turns email_sync on and serves these mailboxes and one template. */
  function serve(accounts: ConnectedAccountResponse[]): void {
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { ...allFlagsEnabled(), email_sync: true } }),
      ),
      http.get('/api/v1/connected-accounts', () => HttpResponse.json({ accounts })),
      http.get('/api/v1/email-templates', () =>
        HttpResponse.json({
          data: [
            {
              id: TEMPLATE_ID,
              name: 'Follow-up',
              category: 'general',
              subject: 'Following up, {{contact.first_name}}',
              body: '<p>Thanks for your time.</p><script>bad()</script>',
              merge_tags: [],
            },
          ],
          total: 1,
          page: 1,
          limit: 100,
        }),
      ),
    );
  }

  /** Records each send request's body and Idempotency-Key, answering with `respond`. */
  function captureSends(
    respond: () => Response = () =>
      HttpResponse.json({ message: { id: 'm-1' }, unresolved_merge_tags: [] }, { status: 201 }),
  ): { bodies: Record<string, unknown>[]; keys: (string | null)[] } {
    const bodies: Record<string, unknown>[] = [];
    const keys: (string | null)[] = [];
    server.use(
      http.post('/api/v1/email-messages/send', async ({ request }) => {
        // Safe: the modal always posts a JSON object.
        bodies.push((await request.json()) as Record<string, unknown>);
        keys.push(request.headers.get('Idempotency-Key'));
        return respond();
      }),
    );
    return { bodies, keys };
  }

  function open(onSent = noop): void {
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={onSent}
      />,
    );
  }

  async function chooseMailbox(): Promise<void> {
    const from = await screen.findByTestId('send-email-from');
    fireEvent.change(from, { target: { value: MAILBOX_ID } });
  }

  function type(subject: string, body: string): void {
    fireEvent.change(screen.getByTestId('send-email-subject'), { target: { value: subject } });
    fireEvent.change(screen.getByTestId('send-email-body'), { target: { value: body } });
  }

  it('offers only mailboxes that are active and can send', async () => {
    serve([
      mailbox({ id: 'no-send', email_address: 'readonly@example.com', can_send: false }),
      mailbox({ id: 'broken', email_address: 'broken@example.com', status: 'error' }),
      mailbox({ email_address: 'sender@example.com' }),
    ]);
    open();

    await screen.findByTestId('send-email-from');
    const offered = screen.getAllByRole('option').map((option) => option.textContent);
    expect(offered).toContain('sender@example.com');
    expect(offered).not.toContain('readonly@example.com');
    expect(offered).not.toContain('broken@example.com');
  });

  it('offers a mailbox that can send, with the company email as the default', async () => {
    serve([mailbox()]);
    open();

    const from = await screen.findByTestId('send-email-from');
    expect(from).toHaveValue('org');
    expect(screen.getByRole('option', { name: 'rep@example.com' })).toBeInTheDocument();
  });

  it('sends typed text through the mailbox, escaped, filed on the contact, with a key', async () => {
    serve([mailbox()]);
    const sends = captureSends();
    const onSent = vi.fn();
    open(onSent);
    await chooseMailbox();
    type('Hello', 'Hi <Jane>\n\nThanks');

    fireEvent.click(screen.getByTestId('send-email-submit'));

    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(sends.bodies).toEqual([
      {
        connected_account_id: MAILBOX_ID,
        to: [CONTACT_EMAIL],
        cc: [],
        subject: 'Hello',
        body_html: '<p>Hi &lt;Jane&gt;</p><p>Thanks</p>',
        record_type: 'contact',
        record_id: CONTACT_ID,
      },
    ]);
    expect(sends.keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('retries an unchanged compose under the same key, and an edited one under a new key', async () => {
    serve([mailbox()]);
    const sends = captureSends(() =>
      HttpResponse.json({ error: { code: 'SEND_FAILED', message: 'no' } }, { status: 502 }),
    );
    open();
    await chooseMailbox();
    type('Hello', 'Body');

    fireEvent.click(screen.getByTestId('send-email-submit'));
    await screen.findByTestId('send-email-error');
    fireEvent.click(screen.getByTestId('send-email-submit'));
    await waitFor(() => expect(sends.keys).toHaveLength(2));
    type('Hello again', 'Body');
    fireEvent.click(screen.getByTestId('send-email-submit'));
    await waitFor(() => expect(sends.keys).toHaveLength(3));

    expect(sends.keys[1]).toBe(sends.keys[0]);
    expect(sends.keys[2]).not.toBe(sends.keys[0]);
  });

  it('treats a repeat the server says already went out as sent', async () => {
    serve([mailbox()]);
    captureSends(() =>
      HttpResponse.json({ error: { code: 'SEND_ALREADY_SENT', message: 'sent' } }, { status: 409 }),
    );
    const onSent = vi.fn();
    open(onSent);
    await chooseMailbox();
    type('Hello', 'Body');

    fireEvent.click(screen.getByTestId('send-email-submit'));

    expect(await screen.findByTestId('send-email-success')).toBeInTheDocument();
    expect(onSent).toHaveBeenCalled();
  });

  it('says a send of unknown outcome may have gone, and does not call it sent', async () => {
    serve([mailbox()]);
    captureSends(() =>
      HttpResponse.json({ error: { code: 'SEND_UNCONFIRMED', message: 'maybe' } }, { status: 409 }),
    );
    const onSent = vi.fn();
    open(onSent);
    await chooseMailbox();
    type('Hello', 'Body');

    fireEvent.click(screen.getByTestId('send-email-submit'));

    expect(await screen.findByTestId('send-email-error')).toHaveTextContent(/may have been sent/i);
    expect(onSent).not.toHaveBeenCalled();
  });

  it('previews a picked template as text and sends it by id, rendered on the server', async () => {
    serve([mailbox()]);
    const sends = captureSends(() =>
      HttpResponse.json(
        { message: { id: 'm-1' }, unresolved_merge_tags: ['contact.title'] },
        { status: 201 },
      ),
    );
    open();
    await chooseMailbox();
    fireEvent.change(await screen.findByTestId('send-email-template'), {
      target: { value: TEMPLATE_ID },
    });

    const preview = screen.getByTestId('send-email-template-preview');
    expect(preview).toHaveTextContent('Following up, {{contact.first_name}}');
    expect(preview).toHaveTextContent('Thanks for your time.');
    expect(preview).not.toHaveTextContent('bad()');
    expect(screen.queryByTestId('send-email-subject')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('send-email-submit'));

    expect(await screen.findByTestId('send-email-success')).toHaveTextContent('contact.title');
    expect(sends.bodies[0]).toEqual({
      connected_account_id: MAILBOX_ID,
      to: [CONTACT_EMAIL],
      cc: [],
      template_id: TEMPLATE_ID,
      record_type: 'contact',
      record_id: CONTACT_ID,
    });
  });

  it('keeps sending through the company email when no mailbox is chosen', async () => {
    serve([mailbox()]);
    const sends = captureSends();
    let orgSends = 0;
    server.use(
      http.post(`/api/v1/contacts/${CONTACT_ID}/send-email`, () => {
        orgSends += 1;
        return HttpResponse.json({ delivered: true });
      }),
    );
    open();
    await screen.findByTestId('send-email-from');
    type('Hello', 'Body');

    fireEvent.click(screen.getByTestId('send-email-submit'));

    await screen.findByTestId('send-email-success');
    expect(orgSends).toBe(1);
    expect(sends.bodies).toHaveLength(0);
  });

  /** Lets every pending request and its re-render settle. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('offers no selector when email sync is on but no mailbox can send', async () => {
    let accountRequests = 0;
    serve([]);
    server.use(
      http.get('/api/v1/connected-accounts', () => {
        accountRequests += 1;
        return HttpResponse.json({ accounts: [mailbox({ can_send: false })] });
      }),
    );
    open();

    await waitFor(() => expect(accountRequests).toBe(1));
    await settle();
    expect(screen.queryByTestId('send-email-from')).not.toBeInTheDocument();
  });

  it('never asks for mailboxes when the user cannot manage them', async () => {
    let accountRequests = 0;
    serve([mailbox()]);
    server.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json(authMeBody(VIEWER_USER))),
      http.get('/api/v1/connected-accounts', () => {
        accountRequests += 1;
        return HttpResponse.json({ accounts: [mailbox()] });
      }),
    );
    open();

    await screen.findByTestId('send-email-subject');
    await settle();
    expect(accountRequests).toBe(0);
    expect(screen.queryByTestId('send-email-from')).not.toBeInTheDocument();
  });

  it('says why only the company email is offered when mailboxes fail to load', async () => {
    serve([]);
    server.use(
      http.get('/api/v1/connected-accounts', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 }),
      ),
    );
    open();

    expect(await screen.findByTestId('send-email-accounts-error')).toBeInTheDocument();
    expect(screen.queryByTestId('send-email-from')).not.toBeInTheDocument();
  });

  it('shows templates loading, then the picker', async () => {
    serve([mailbox()]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/v1/email-templates', async () => {
        await gate;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100 });
      }),
    );
    open();
    await chooseMailbox();

    expect(await screen.findByTestId('send-email-templates-loading')).toBeInTheDocument();
    release();
    await waitFor(() =>
      expect(screen.queryByTestId('send-email-templates-loading')).not.toBeInTheDocument(),
    );
  });

  it('says templates could not be loaded, and still lets typed text be sent', async () => {
    serve([mailbox()]);
    server.use(
      http.get('/api/v1/email-templates', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 }),
      ),
    );
    open();
    await chooseMailbox();

    expect(await screen.findByTestId('send-email-templates-error')).toBeInTheDocument();
    expect(screen.getByTestId('send-email-subject')).toBeInTheDocument();
  });

  it('offers no picker when there are no templates', async () => {
    let templateRequests = 0;
    serve([mailbox()]);
    server.use(
      http.get('/api/v1/email-templates', () => {
        templateRequests += 1;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100 });
      }),
    );
    open();
    await chooseMailbox();

    await waitFor(() => expect(templateRequests).toBe(1));
    await settle();
    expect(screen.queryByTestId('send-email-template')).not.toBeInTheDocument();
  });

  it('lists templates from every page', async () => {
    serve([mailbox()]);
    server.use(
      http.get('/api/v1/email-templates', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        return HttpResponse.json({
          data: [
            {
              id: `00000000-0000-4000-8000-00000000010${page}`,
              name: `Template ${page}`,
              category: 'general',
              subject: 's',
              body: '<p>b</p>',
              merge_tags: [],
            },
          ],
          total: 2,
          page,
          limit: 100,
        });
      }),
    );
    open();
    await chooseMailbox();

    await screen.findByRole('option', { name: 'Template 2' });
    expect(screen.getByRole('option', { name: 'Template 1' })).toBeInTheDocument();
    expect(screen.queryByTestId('send-email-templates-truncated')).not.toBeInTheDocument();
  });

  it('says when more templates exist than the picker reads', async () => {
    serve([mailbox()]);
    server.use(
      http.get('/api/v1/email-templates', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        return HttpResponse.json({
          data: [
            {
              id: `00000000-0000-4000-8000-0000000002${String(page).padStart(2, '0')}`,
              name: `Template ${page}`,
              category: 'general',
              subject: 's',
              body: '<p>b</p>',
              merge_tags: [],
            },
          ],
          total: 5000,
          page,
          limit: 100,
        });
      }),
    );
    open();
    await chooseMailbox();

    expect(await screen.findByTestId('send-email-templates-truncated')).toHaveTextContent('5000');
  });

  it('drops a picked template on switching back to the company email', async () => {
    serve([mailbox()]);
    open();
    await chooseMailbox();
    fireEvent.change(await screen.findByTestId('send-email-template'), {
      target: { value: TEMPLATE_ID },
    });

    fireEvent.change(screen.getByTestId('send-email-from'), { target: { value: 'org' } });

    expect(screen.queryByTestId('send-email-template-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-email-subject')).toBeInTheDocument();
    await chooseMailbox();
    expect(await screen.findByTestId('send-email-template')).toHaveValue('');
  });

  it('reports a send that went but was not stored as sent', async () => {
    serve([mailbox()]);
    captureSends(() =>
      HttpResponse.json({ error: { code: 'SENT_NOT_RECORDED', message: 'x' } }, { status: 500 }),
    );
    const onSent = vi.fn();
    open(onSent);
    await chooseMailbox();
    type('Hello', 'Body');

    fireEvent.click(screen.getByTestId('send-email-submit'));

    expect(await screen.findByTestId('send-email-success')).toBeInTheDocument();
    expect(onSent).toHaveBeenCalled();
  });

  it.each<[string, () => Response]>([
    [
      'the provider did not confirm it',
      () =>
        HttpResponse.json({ error: { code: 'SEND_NOT_CONFIRMED', message: 'x' } }, { status: 502 }),
    ],
    [
      'a repeat of an unconfirmed send',
      () =>
        HttpResponse.json({ error: { code: 'SEND_UNCONFIRMED', message: 'x' } }, { status: 409 }),
    ],
    [
      'the first attempt is still in flight',
      () =>
        HttpResponse.json({ error: { code: 'SEND_IN_PROGRESS', message: 'x' } }, { status: 409 }),
    ],
    ['the server failed without saying why', () => new HttpResponse(null, { status: 500 })],
    ['the connection dropped', () => HttpResponse.error()],
  ])(
    'freezes the compose when %s, and retries only the same request under the same key',
    async (_label, respond) => {
      serve([mailbox()]);
      const sends = captureSends(respond);
      open();
      await chooseMailbox();
      type('Hello', 'Body');

      fireEvent.click(screen.getByTestId('send-email-submit'));
      await screen.findByTestId('send-email-error');

      expect(screen.getByTestId('send-email-subject')).toBeDisabled();
      expect(screen.getByTestId('send-email-body')).toBeDisabled();
      expect(screen.getByTestId('send-email-from')).toBeDisabled();
      fireEvent.click(screen.getByTestId('send-email-submit'));
      await waitFor(() => expect(sends.keys).toHaveLength(2));
      expect(sends.keys[1]).toBe(sends.keys[0]);
      expect(sends.bodies[1]).toEqual(sends.bodies[0]);
    },
  );

  it('keeps the compose editable after a refusal that sent nothing', async () => {
    serve([mailbox()]);
    captureSends(() =>
      HttpResponse.json({ error: { code: 'RATE_LIMITED', message: 'x' } }, { status: 429 }),
    );
    open();
    await chooseMailbox();
    type('Hello', 'Body');

    fireEvent.click(screen.getByTestId('send-email-submit'));
    await screen.findByTestId('send-email-error');

    expect(screen.getByTestId('send-email-subject')).not.toBeDisabled();
  });

  it('shows the mailboxes loading', async () => {
    serve([]);
    const gate = new Promise<void>(() => {});
    server.use(
      http.get('/api/v1/connected-accounts', async () => {
        await gate;
        return HttpResponse.json({ accounts: [] });
      }),
    );
    open();

    expect(await screen.findByTestId('send-email-accounts-loading')).toBeInTheDocument();
  });

  it('falls back to the company email when a refetch drops the chosen mailbox', async () => {
    let accounts = [mailbox()];
    serve([]);
    server.use(http.get('/api/v1/connected-accounts', () => HttpResponse.json({ accounts })));
    open();
    await chooseMailbox();
    accounts = [];

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(screen.queryByTestId('send-email-from')).not.toBeInTheDocument());
    focusManager.setFocused(undefined);
    const mailboxSends = captureSends();
    let orgSends = 0;
    server.use(
      http.post(`/api/v1/contacts/${CONTACT_ID}/send-email`, () => {
        orgSends += 1;
        return HttpResponse.json({ delivered: true });
      }),
    );
    type('Hello', 'Body');

    fireEvent.click(screen.getByTestId('send-email-submit'));

    await screen.findByTestId('send-email-success');
    expect(orgSends).toBe(1);
    expect(mailboxSends.bodies).toHaveLength(0);
  });

  /** Refetches every active query, as returning to the tab does. */
  function refocus(): void {
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
  }

  it('resends the frozen template request as it was, even after a refetch drops the template', async () => {
    let templates = [
      {
        id: TEMPLATE_ID,
        name: 'Follow-up',
        category: 'general',
        subject: 's',
        body: '<p>b</p>',
        merge_tags: [],
      },
    ];
    serve([mailbox()]);
    server.use(
      http.get('/api/v1/email-templates', () =>
        HttpResponse.json({ data: templates, total: templates.length, page: 1, limit: 100 }),
      ),
    );
    const sends = captureSends(() =>
      HttpResponse.json({ error: { code: 'SEND_NOT_CONFIRMED', message: 'x' } }, { status: 502 }),
    );
    open();
    await chooseMailbox();
    fireEvent.change(await screen.findByTestId('send-email-template'), {
      target: { value: TEMPLATE_ID },
    });
    fireEvent.click(screen.getByTestId('send-email-submit'));
    await screen.findByTestId('send-email-error');
    templates = [];
    refocus();
    await waitFor(() =>
      expect(screen.queryByTestId('send-email-template-preview')).not.toBeInTheDocument(),
    );
    focusManager.setFocused(undefined);

    fireEvent.click(screen.getByTestId('send-email-submit'));

    await waitFor(() => expect(sends.keys).toHaveLength(2));
    expect(sends.keys[1]).toBe(sends.keys[0]);
    expect(sends.bodies[1]).toEqual(sends.bodies[0]);
    expect(sends.bodies[1]).toMatchObject({ template_id: TEMPLATE_ID });
  });

  it('resends the frozen request through its mailbox, even after a refetch drops the mailbox', async () => {
    let accounts = [mailbox()];
    serve([]);
    server.use(http.get('/api/v1/connected-accounts', () => HttpResponse.json({ accounts })));
    const sends = captureSends(() =>
      HttpResponse.json({ error: { code: 'SEND_NOT_CONFIRMED', message: 'x' } }, { status: 502 }),
    );
    let orgSends = 0;
    server.use(
      http.post(`/api/v1/contacts/${CONTACT_ID}/send-email`, () => {
        orgSends += 1;
        return HttpResponse.json({ delivered: true });
      }),
    );
    open();
    await chooseMailbox();
    type('Hello', 'Body');
    fireEvent.click(screen.getByTestId('send-email-submit'));
    await screen.findByTestId('send-email-error');
    accounts = [];
    refocus();
    await waitFor(() => expect(screen.queryByTestId('send-email-from')).not.toBeInTheDocument());
    focusManager.setFocused(undefined);

    fireEvent.click(screen.getByTestId('send-email-submit'));

    await waitFor(() => expect(sends.keys).toHaveLength(2));
    expect(sends.keys[1]).toBe(sends.keys[0]);
    expect(sends.bodies[1]).toEqual(sends.bodies[0]);
    expect(orgSends).toBe(0);
  });

  it('refreshes the synced-mail lists after a send through a mailbox', async () => {
    serve([mailbox()]);
    captureSends();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated = vi.spyOn(queryClient, 'invalidateQueries');
    renderWithProviders(
      <SendEmailModal
        isOpen={true}
        contactId={CONTACT_ID}
        contactEmail={CONTACT_EMAIL}
        contactName={CONTACT_NAME}
        onClose={noop}
        onSent={noop}
      />,
      { queryClient },
    );
    await chooseMailbox();
    type('Hello', 'Body');

    fireEvent.click(screen.getByTestId('send-email-submit'));

    await screen.findByTestId('send-email-success');
    expect(invalidated).toHaveBeenCalledWith({ queryKey: ['email-messages'] });
  });
});
