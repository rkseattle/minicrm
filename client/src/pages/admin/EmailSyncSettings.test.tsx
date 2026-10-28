/**
 * EmailSyncSettings — the org's excluded domains and backfill window.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  EMAIL_SYNC_BACKFILL_DAYS_QUERY_KEY,
  EMAIL_SYNC_EXCLUDED_DOMAINS_QUERY_KEY,
} from '@/api/settings.js';
import { server } from '../../test/setup.js';
import { createCachedQueryClient, renderWithProviders } from '../../test/renderWithProviders.js';
import EmailSyncSettings from './EmailSyncSettings.js';

function serve(domains: string[] = ['hr.example'], days = 45) {
  server.use(
    http.get('/api/v1/settings/email-sync-excluded-domains', () => HttpResponse.json({ domains })),
    http.get('/api/v1/settings/email-sync-backfill-days', () => HttpResponse.json({ days })),
  );
}

async function loaded(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('email-sync-excluded-domains-input')).toBeInTheDocument(),
  );
}

describe('EmailSyncSettings', () => {
  it('shows a loading state first', () => {
    serve();
    renderWithProviders(<EmailSyncSettings />);
    expect(screen.getByTestId('email-sync-settings-loading')).toBeInTheDocument();
  });

  it.each([
    ['the list', '/api/v1/settings/email-sync-excluded-domains'],
    ['the window', '/api/v1/settings/email-sync-backfill-days'],
  ])('shows a load error, and no form to overwrite with, when %s fails', async (_label, url) => {
    serve();
    server.use(
      http.get(url, () =>
        HttpResponse.json({ error: { code: 'X', message: 'x' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<EmailSyncSettings />);

    expect(await screen.findByTestId('email-sync-settings-error')).toBeInTheDocument();
    expect(screen.queryByTestId('email-sync-excluded-domains-input')).not.toBeInTheDocument();
  });

  it('shows the stored list one domain per line, and the stored window', async () => {
    serve(['hr.example', 'family.example'], 30);
    renderWithProviders(<EmailSyncSettings />);
    await loaded();

    expect(screen.getByTestId('email-sync-excluded-domains-input')).toHaveValue(
      'hr.example\nfamily.example',
    );
    expect(screen.getByTestId('email-sync-backfill-days-input')).toHaveValue(30);
  });

  it('shows the stored values when they are already cached on opening', async () => {
    const queryClient = createCachedQueryClient([
      [EMAIL_SYNC_EXCLUDED_DOMAINS_QUERY_KEY, { domains: ['cached.example'] }],
      [EMAIL_SYNC_BACKFILL_DAYS_QUERY_KEY, { days: 14 }],
    ]);
    renderWithProviders(<EmailSyncSettings />, { queryClient });
    await loaded();

    expect(screen.getByTestId('email-sync-excluded-domains-input')).toHaveValue('cached.example');
    expect(screen.getByTestId('email-sync-backfill-days-input')).toHaveValue(14);
  });

  it('shows an empty list as an empty box', async () => {
    serve([]);
    renderWithProviders(<EmailSyncSettings />);
    await loaded();
    expect(screen.getByTestId('email-sync-excluded-domains-input')).toHaveValue('');
  });

  it('saves the list normalized and says so', async () => {
    serve([]);
    let sent: unknown;
    server.use(
      http.patch('/api/v1/settings/email-sync-excluded-domains', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ domains: ['hr.example'] });
      }),
    );
    renderWithProviders(<EmailSyncSettings />);
    await loaded();

    fireEvent.change(screen.getByTestId('email-sync-excluded-domains-input'), {
      target: { value: ' HR.example \n\nhr.example' },
    });
    fireEvent.click(screen.getByTestId('email-sync-domains-save'));

    expect(await screen.findByTestId('email-sync-domains-saved')).toBeInTheDocument();
    expect(sent).toEqual({ domains: ['hr.example'] });
  });

  it('clears "Saved" as soon as the list is edited again', async () => {
    serve([]);
    renderWithProviders(<EmailSyncSettings />);
    await loaded();
    fireEvent.change(screen.getByTestId('email-sync-excluded-domains-input'), {
      target: { value: 'hr.example' },
    });
    fireEvent.click(screen.getByTestId('email-sync-domains-save'));
    await screen.findByTestId('email-sync-domains-saved');

    fireEvent.change(screen.getByTestId('email-sync-excluded-domains-input'), {
      target: { value: 'hr.example\nother.example' },
    });

    expect(screen.queryByTestId('email-sync-domains-saved')).not.toBeInTheDocument();
  });

  it('refuses an address in the list without calling the server', async () => {
    serve([]);
    let called = false;
    server.use(
      http.patch('/api/v1/settings/email-sync-excluded-domains', () => {
        called = true;
        return HttpResponse.json({ domains: [] });
      }),
    );
    renderWithProviders(<EmailSyncSettings />);
    await loaded();

    fireEvent.change(screen.getByTestId('email-sync-excluded-domains-input'), {
      target: { value: 'someone@hr.example' },
    });
    fireEvent.click(screen.getByTestId('email-sync-domains-save'));

    expect(await screen.findByTestId('email-sync-domains-error')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('reports a failed save of the list', async () => {
    serve([]);
    server.use(
      http.patch('/api/v1/settings/email-sync-excluded-domains', () =>
        HttpResponse.json({ error: { code: 'X', message: 'x' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<EmailSyncSettings />);
    await loaded();

    fireEvent.change(screen.getByTestId('email-sync-excluded-domains-input'), {
      target: { value: 'hr.example' },
    });
    fireEvent.click(screen.getByTestId('email-sync-domains-save'));

    expect(await screen.findByTestId('email-sync-domains-error')).toBeInTheDocument();
  });

  it('saves the window', async () => {
    serve();
    let sent: unknown;
    server.use(
      http.patch('/api/v1/settings/email-sync-backfill-days', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ days: 14 });
      }),
    );
    renderWithProviders(<EmailSyncSettings />);
    await loaded();

    fireEvent.change(screen.getByTestId('email-sync-backfill-days-input'), {
      target: { value: '14' },
    });
    fireEvent.click(screen.getByTestId('email-sync-days-save'));

    expect(await screen.findByTestId('email-sync-days-saved')).toBeInTheDocument();
    expect(sent).toEqual({ days: 14 });
  });

  it.each(['0', '366', '', '1.5'])('refuses a window of %j', async (value) => {
    serve();
    renderWithProviders(<EmailSyncSettings />);
    await loaded();

    fireEvent.change(screen.getByTestId('email-sync-backfill-days-input'), {
      target: { value },
    });
    fireEvent.click(screen.getByTestId('email-sync-days-save'));

    expect(await screen.findByTestId('email-sync-days-error')).toBeInTheDocument();
  });

  it('reports a failed save of the window', async () => {
    serve();
    server.use(
      http.patch('/api/v1/settings/email-sync-backfill-days', () =>
        HttpResponse.json({ error: { code: 'X', message: 'x' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<EmailSyncSettings />);
    await loaded();

    fireEvent.click(screen.getByTestId('email-sync-days-save'));

    expect(await screen.findByTestId('email-sync-days-error')).toBeInTheDocument();
  });

  it('stays visible but disabled, with a banner, when email sync is off', async () => {
    serve();
    renderWithProviders(<EmailSyncSettings disabled />);
    await loaded();

    expect(screen.getByTestId('email-sync-settings-disabled-banner')).toBeInTheDocument();
    expect(screen.getByTestId('email-sync-excluded-domains-input')).toBeDisabled();
    expect(screen.getByTestId('email-sync-backfill-days-input')).toBeDisabled();
    expect(screen.getByTestId('email-sync-domains-save')).toBeDisabled();
  });
});
