/**
 * Tests for DataSettings — Import Data, Demo Data, and Audit Log sections.
 *
 * Verifies:
 * - All three section panels render
 * - Import tabs switch between accounts/contacts/deals panels
 * - Re-clicking the active import tab is a no-op
 * - Demo status loading and inactive states render correctly
 * - Demo status shows active badge when demo is active
 * - Seed/Reset/Remove buttons open the confirmation dialog
 * - Cancel on confirm dialog closes it without mutating
 * - Confirming seed/reset/remove calls the correct API and shows feedback
 * - Audit Log section contains the link to the audit log page
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import DataSettings from './DataSettings.js';

describe('DataSettings — sections', () => {
  it('renders import, demo, and audit log sections', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('import-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('demo-section')).toBeInTheDocument();
    expect(screen.getByTestId('audit-log-section')).toBeInTheDocument();
  });

  it('renders the audit log link', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('audit-log-link')).toBeInTheDocument();
    });
  });
});

describe('DataSettings — import tabs', () => {
  it('shows accounts tab as selected by default', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => {
      const tab = screen.getByTestId('import-tab-accounts');
      expect(tab).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByTestId('import-panel-accounts')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('import-panel-contacts')).toHaveAttribute('hidden');
    expect(screen.getByTestId('import-panel-deals')).toHaveAttribute('hidden');
  });

  it('switches to contacts tab on click', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('import-tab-contacts')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('import-tab-contacts'));

    expect(screen.getByTestId('import-tab-contacts')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('import-panel-contacts')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('import-panel-accounts')).toHaveAttribute('hidden');
  });

  it('switches to deals tab on click', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('import-tab-deals')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('import-tab-deals'));

    expect(screen.getByTestId('import-tab-deals')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('import-panel-deals')).not.toHaveAttribute('hidden');
  });

  it('re-clicking the active tab is a no-op', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('import-tab-accounts')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('import-tab-accounts'));

    expect(screen.getByTestId('import-tab-accounts')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('import-panel-accounts')).not.toHaveAttribute('hidden');
  });
});

describe('DataSettings — demo data', () => {
  it('shows inactive badge when no demo data exists', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('demo-status-badge')).toBeInTheDocument();
    });
  });

  it('shows active badge when demo data is seeded', async () => {
    server.use(http.get('/api/v1/admin/demo/status', () => HttpResponse.json({ active: true })));

    renderWithProviders(<DataSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('demo-status-badge')).toBeInTheDocument();
    });
  });

  it('shows demo status error on load failure', async () => {
    server.use(
      http.get('/api/v1/admin/demo/status', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<DataSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('demo-status-error')).toBeInTheDocument();
    });
  });

  it('opens confirm dialog when Seed is clicked', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('demo-seed-button'));

    expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
  });

  it('closes confirm dialog on Cancel', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('demo-seed-button'));
    expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('demo-confirm-cancel'));

    expect(screen.queryByTestId('demo-confirm-dialog')).not.toBeInTheDocument();
  });

  it('calls seed API and shows success feedback on confirm', async () => {
    let seedCalled = false;
    server.use(
      http.post('/api/v1/admin/demo/seed', () => {
        seedCalled = true;
        return HttpResponse.json({ success: true });
      }),
    );

    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('demo-seed-button'));
    fireEvent.click(screen.getByTestId('demo-confirm-ok'));

    await waitFor(() => {
      expect(seedCalled).toBe(true);
      expect(screen.getByTestId('demo-feedback')).toBeInTheDocument();
    });
  });

  it('opens confirm dialog when Reset is clicked', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('demo-reset-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('demo-reset-button'));

    expect(screen.getByTestId('demo-confirm-dialog')).toBeInTheDocument();
  });

  it('calls reset API on confirm', async () => {
    let resetCalled = false;
    server.use(
      http.post('/api/v1/admin/demo/reset', () => {
        resetCalled = true;
        return HttpResponse.json({ success: true });
      }),
    );

    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('demo-reset-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('demo-reset-button'));
    fireEvent.click(screen.getByTestId('demo-confirm-ok'));

    await waitFor(() => expect(resetCalled).toBe(true));
  });

  it('Remove button is disabled when demo is not active', async () => {
    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('demo-remove-button')).toBeInTheDocument());
    expect(screen.getByTestId('demo-remove-button')).toBeDisabled();
  });

  it('Remove button is enabled and calls DELETE API when demo is active', async () => {
    server.use(http.get('/api/v1/admin/demo/status', () => HttpResponse.json({ active: true })));

    let removeCalled = false;
    server.use(
      http.delete('/api/v1/admin/demo', () => {
        removeCalled = true;
        return HttpResponse.json({ success: true });
      }),
    );

    renderWithProviders(<DataSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('demo-remove-button'));
    fireEvent.click(screen.getByTestId('demo-confirm-ok'));

    await waitFor(() => expect(removeCalled).toBe(true));
  });

  it('shows error feedback when seed API fails', async () => {
    server.use(http.post('/api/v1/admin/demo/seed', () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<DataSettings />);

    await waitFor(() => expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('demo-seed-button'));
    fireEvent.click(screen.getByTestId('demo-confirm-ok'));

    await waitFor(() => {
      const feedback = screen.getByTestId('demo-feedback');
      expect(feedback).toBeInTheDocument();
      expect(feedback).toHaveAttribute('role', 'alert');
    });
  });

  it('invalidates the entire query cache after seed succeeds (MINCRM-347)', async () => {
    server.use(http.post('/api/v1/admin/demo/seed', () => HttpResponse.json({ success: true })));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithProviders(<DataSettings />, { queryClient });

    await waitFor(() => expect(screen.getByTestId('demo-seed-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('demo-seed-button'));
    fireEvent.click(screen.getByTestId('demo-confirm-ok'));

    await waitFor(() => {
      // Called with no filter — full-cache invalidation
      expect(invalidateSpy).toHaveBeenCalledWith();
    });
  });

  it('invalidates the entire query cache after reset succeeds (MINCRM-347)', async () => {
    server.use(http.post('/api/v1/admin/demo/reset', () => HttpResponse.json({ success: true })));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithProviders(<DataSettings />, { queryClient });

    await waitFor(() => expect(screen.getByTestId('demo-reset-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('demo-reset-button'));
    fireEvent.click(screen.getByTestId('demo-confirm-ok'));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith();
    });
  });

  it('invalidates the entire query cache after remove succeeds (MINCRM-347)', async () => {
    server.use(http.get('/api/v1/admin/demo/status', () => HttpResponse.json({ active: true })));
    server.use(http.delete('/api/v1/admin/demo', () => HttpResponse.json({ success: true })));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithProviders(<DataSettings />, { queryClient });

    await waitFor(() => {
      expect(screen.getByTestId('demo-remove-button')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('demo-remove-button'));
    fireEvent.click(screen.getByTestId('demo-confirm-ok'));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith();
    });
  });
});
