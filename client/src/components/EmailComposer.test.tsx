import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { ConnectedAccountResponse } from '@shared/schemas/connectedAccountSchema.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { CLOSE_AFTER_SENT_MS } from '@/hooks/useMailboxSend.js';
import EmailComposer from './EmailComposer.js';

const RECORD_ID = '00000000-0000-4000-8000-000000000c01';
const MAILBOX: ConnectedAccountResponse = {
  id: '00000000-0000-4000-8000-000000000c02',
  provider: 'microsoft',
  email_address: 'rep@example.com',
  granted_scopes: [],
  can_send: true,
  status: 'active',
  status_detail: null,
  last_sync_at: null,
  sync_paused: false,
  excluded_domains: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function captureSends(respond: () => Response) {
  const bodies: Record<string, unknown>[] = [];
  const keys: (string | null)[] = [];
  server.use(
    http.post('/api/v1/email-messages/send', async ({ request }) => {
      // Safe: the composer always posts a JSON object.
      bodies.push((await request.json()) as Record<string, unknown>);
      keys.push(request.headers.get('Idempotency-Key'));
      return respond();
    }),
  );
  return { bodies, keys };
}

function open(onClose = vi.fn()) {
  renderWithProviders(
    <EmailComposer
      mode={{ kind: 'new' }}
      recordType="deal"
      recordId={RECORD_ID}
      mailboxes={[MAILBOX]}
      onClose={onClose}
    />,
  );
  return onClose;
}

function fill(to: string): void {
  fireEvent.change(screen.getByTestId('email-composer-to'), { target: { value: to } });
  fireEvent.change(screen.getByTestId('email-composer-subject'), { target: { value: 'Hi' } });
  fireEvent.change(screen.getByTestId('email-composer-body'), { target: { value: 'Body' } });
}

describe('EmailComposer', () => {
  it('waits for a recipient, a subject and a message before it can send', () => {
    open();

    expect(screen.getByTestId('email-composer-send')).toBeDisabled();
    fill('a@x.test');
    expect(screen.getByTestId('email-composer-send')).not.toBeDisabled();
  });

  it('reads recipients as an address list, and files the send on its record', async () => {
    const sends = captureSends(() =>
      HttpResponse.json({ message: { id: 'm' }, unresolved_merge_tags: [] }, { status: 201 }),
    );
    open();
    fill('a@x.test, "Bee, B" <b@x.test>,  c@x.test');
    fireEvent.change(screen.getByTestId('email-composer-cc'), { target: { value: 'd@x.test' } });

    fireEvent.click(screen.getByTestId('email-composer-send'));

    await screen.findByTestId('email-composer-success');
    expect(sends.bodies[0]).toMatchObject({
      connected_account_id: MAILBOX.id,
      to: ['a@x.test', 'b@x.test', 'c@x.test'],
      cc: ['d@x.test'],
      record_type: 'deal',
      record_id: RECORD_ID,
    });
  });

  it('freezes after a failure that may have sent, and retries the same request under the same key', async () => {
    const sends = captureSends(() => HttpResponse.error());
    open();
    fill('a@x.test');

    fireEvent.click(screen.getByTestId('email-composer-send'));
    await screen.findByTestId('email-composer-error');
    expect(screen.getByTestId('email-composer-body')).toBeDisabled();
    fireEvent.click(screen.getByTestId('email-composer-send'));

    await waitFor(() => expect(sends.keys).toHaveLength(2));
    expect(sends.keys[1]).toBe(sends.keys[0]);
    expect(sends.bodies[1]).toEqual(sends.bodies[0]);
  });

  it('closes on Escape and on Cancel', () => {
    const onClose = open();

    fireEvent.keyDown(screen.getByTestId('email-composer'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('email-composer-cancel'));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it.each(['SENT_NOT_RECORDED', 'SEND_ALREADY_SENT'])(
    'reports %s as sent, since the message went',
    async (code) => {
      captureSends(() =>
        HttpResponse.json(
          { error: { code, message: 'x' } },
          { status: code === 'SENT_NOT_RECORDED' ? 500 : 409 },
        ),
      );
      open();
      fill('a@x.test');

      fireEvent.click(screen.getByTestId('email-composer-send'));

      expect(await screen.findByTestId('email-composer-success')).toBeInTheDocument();
    },
  );

  it('keeps the form editable after a refusal that sent nothing', async () => {
    captureSends(() =>
      HttpResponse.json({ error: { code: 'RECONNECT_REQUIRED', message: 'x' } }, { status: 409 }),
    );
    open();
    fill('a@x.test');

    fireEvent.click(screen.getByTestId('email-composer-send'));

    await screen.findByTestId('email-composer-error');
    expect(screen.getByTestId('email-composer-body')).not.toBeDisabled();
  });

  it('never closes a later composer from an earlier one\u2019s confirmation', async () => {
    captureSends(() =>
      HttpResponse.json({ message: { id: 'm' }, unresolved_merge_tags: [] }, { status: 201 }),
    );
    // Fake from the start, so the confirmation timer is one the test controls.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    const { unmount } = renderWithProviders(
      <EmailComposer
        mode={{ kind: 'new' }}
        recordType="deal"
        recordId={RECORD_ID}
        mailboxes={[MAILBOX]}
        onClose={onClose}
      />,
    );
    fill('a@x.test');
    fireEvent.click(screen.getByTestId('email-composer-send'));
    await screen.findByTestId('email-composer-success');

    unmount();
    vi.advanceTimersByTime(CLOSE_AFTER_SENT_MS * 2);
    vi.useRealTimers();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog', () => {
    open();
    fill('a@x.test');
    const cancel = screen.getByTestId('email-composer-cancel');
    cancel.focus();

    fireEvent.keyDown(cancel, { key: 'Tab' });

    expect(screen.getByTestId('email-composer-from')).toHaveFocus();
  });

  it('refuses to send unreadable recipients rather than drop one', () => {
    open();
    fill('Ada <a@x.test> Bob <b@x.test>');

    expect(screen.getByTestId('email-composer-send')).toBeDisabled();
  });

  it('says why To is unreadable once the field is left, not while typing', () => {
    open();
    fill('Ada <a@x.test> Bob <b@x.test>');
    const to = screen.getByTestId('email-composer-to');
    expect(to).not.toHaveAttribute('aria-invalid');

    fireEvent.blur(to);

    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(to).toHaveAccessibleDescription(
      expect.stringContaining("These addresses can't be read."),
    );
  });

  it('clears the message as soon as the recipients are fixed', () => {
    open();
    fill('Ada <a@x.test> Bob <b@x.test>');
    const to = screen.getByTestId('email-composer-to');
    fireEvent.blur(to);

    fireEvent.change(to, { target: { value: 'Ada <a@x.test>, Bob <b@x.test>' } });

    expect(to).not.toHaveAttribute('aria-invalid');
    expect(screen.getByTestId('email-composer-send')).toBeEnabled();
  });

  it('refuses to send while Cc is unreadable, and says so once Cc is left', () => {
    open();
    fill('a@x.test');
    const cc = screen.getByTestId('email-composer-cc');
    fireEvent.change(cc, { target: { value: 'x y' } });
    expect(screen.getByTestId('email-composer-send')).toBeDisabled();

    fireEvent.blur(cc);

    expect(cc).toHaveAttribute('aria-invalid', 'true');
  });

  it('locks the form once sent, so a second click cannot send again', async () => {
    const sends = captureSends(() =>
      HttpResponse.json({ message: { id: 'm' }, unresolved_merge_tags: [] }, { status: 201 }),
    );
    open();
    fill('a@x.test');

    fireEvent.click(screen.getByTestId('email-composer-send'));
    await screen.findByTestId('email-composer-success');

    expect(screen.getByTestId('email-composer-body')).toBeDisabled();
    expect(screen.getByTestId('email-composer-send')).toBeDisabled();
    fireEvent.click(screen.getByTestId('email-composer-send'));
    expect(sends.bodies).toHaveLength(1);
  });

  it('gives focus back to what opened it when it closes', async () => {
    function Opener() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>
            opener
          </button>
          {isOpen && (
            <EmailComposer
              mode={{ kind: 'new' }}
              recordType="deal"
              recordId={RECORD_ID}
              mailboxes={[MAILBOX]}
              onClose={() => setIsOpen(false)}
            />
          )}
        </>
      );
    }
    renderWithProviders(<Opener />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();

    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByTestId('email-composer-to')).toHaveFocus());
    fireEvent.click(screen.getByTestId('email-composer-cancel'));

    expect(opener).toHaveFocus();
  });
});
