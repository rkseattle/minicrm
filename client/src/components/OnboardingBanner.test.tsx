/**
 * Tests for OnboardingBanner component (MINCRM-256).
 *
 * Verifies:
 * - Banner renders for admin when is_first_run is true
 * - Banner does not render for rep users
 * - Banner does not render when is_first_run is false
 * - Step progression works (step 1 → 2 → 3)
 * - X button calls dismiss API
 * - Invite flow sends invite and shows confirmation
 * - Step 2 skip advances to step 3
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import OnboardingBanner from './OnboardingBanner.js';

/** Mock user helpers */
function mockAdminUser() {
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          name: 'Admin User',
          role: 'admin',
          status: 'active',
          must_change_password: false,
        },
      }),
    ),
  );
}

function mockRepUser() {
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({
        user: {
          id: 'user-2',
          email: 'rep@example.com',
          name: 'Rep User',
          role: 'rep',
          status: 'active',
          must_change_password: false,
        },
      }),
    ),
  );
}

function mockFirstRun() {
  server.use(
    http.get('/api/v1/settings/onboarding', () =>
      HttpResponse.json({ is_first_run: true, onboarding_completed: false }),
    ),
  );
}

function mockNotFirstRun() {
  server.use(
    http.get('/api/v1/settings/onboarding', () =>
      HttpResponse.json({ is_first_run: false, onboarding_completed: false }),
    ),
  );
}

beforeEach(() => {
  server.use(http.get('/api/v1/settings/nav-layout', () => HttpResponse.json({ layout: 'top' })));
});

describe('OnboardingBanner', () => {
  it('renders for admin when is_first_run is true', async () => {
    mockAdminUser();
    mockFirstRun();

    renderWithProviders(<OnboardingBanner />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-banner')).toBeInTheDocument();
    });
  });

  it('does not render when is_first_run is false', async () => {
    mockAdminUser();
    mockNotFirstRun();

    renderWithProviders(<OnboardingBanner />);

    // Wait for auth and onboarding queries to resolve
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-banner')).not.toBeInTheDocument();
    });
  });

  it('does not render for rep users', async () => {
    mockRepUser();
    mockFirstRun();

    renderWithProviders(<OnboardingBanner />);

    // Rep users: no fetch occurs, banner never renders
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId('onboarding-banner')).not.toBeInTheDocument();
  });

  it('shows step 1 content initially', async () => {
    mockAdminUser();
    mockFirstRun();

    renderWithProviders(<OnboardingBanner />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-1')).toBeInTheDocument();
    });
  });

  it('advances to step 2 when Looks good is clicked', async () => {
    mockAdminUser();
    mockFirstRun();

    renderWithProviders(<OnboardingBanner />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('onboarding-step1-looks-good'));

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-2')).toBeInTheDocument();
    });
  });

  it('advances to step 3 when Skip for now is clicked in step 2', async () => {
    mockAdminUser();
    mockFirstRun();
    server.use(
      http.put('/api/v1/settings/onboarding', () =>
        HttpResponse.json({ onboarding_completed: true }),
      ),
    );

    renderWithProviders(<OnboardingBanner />);

    await waitFor(() => expect(screen.getByTestId('onboarding-step-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('onboarding-step1-looks-good'));
    await waitFor(() => expect(screen.getByTestId('onboarding-step-2')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('onboarding-step2-skip'));

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-3')).toBeInTheDocument();
    });
  });

  it('calls dismiss API when X is clicked', async () => {
    mockAdminUser();

    let dismissCalled = false;
    // Set up first run, then after dismiss return completed
    let requestCount = 0;
    server.use(
      http.get('/api/v1/settings/onboarding', () => {
        requestCount += 1;
        if (requestCount === 1) {
          return HttpResponse.json({ is_first_run: true, onboarding_completed: false });
        }
        return HttpResponse.json({ is_first_run: false, onboarding_completed: true });
      }),
      http.put('/api/v1/settings/onboarding', () => {
        dismissCalled = true;
        return HttpResponse.json({ onboarding_completed: true });
      }),
    );

    renderWithProviders(<OnboardingBanner />);

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-dismiss-button')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('onboarding-dismiss-button'));

    await waitFor(() => {
      expect(dismissCalled).toBe(true);
    });
  });

  it('shows invite confirmation after successful invite', async () => {
    mockAdminUser();
    mockFirstRun();
    server.use(
      http.post('/api/v1/users/invite', () =>
        HttpResponse.json({
          user: {
            id: 'new-user',
            email: 'invited@example.com',
            name: 'invited',
            role: 'rep',
            status: 'invited',
            must_change_password: true,
          },
          inviteToken: 'token123',
          setPasswordPath: '/set-password?token=token123',
        }),
      ),
    );

    renderWithProviders(<OnboardingBanner />);

    // Advance to step 2
    await waitFor(() => expect(screen.getByTestId('onboarding-step-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('onboarding-step1-looks-good'));
    await waitFor(() => expect(screen.getByTestId('onboarding-step-2')).toBeInTheDocument());

    // Fill in email and send invite
    fireEvent.change(screen.getByTestId('onboarding-invite-email'), {
      target: { value: 'invited@example.com' },
    });
    fireEvent.click(screen.getByTestId('onboarding-send-invite-button'));

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-invite-confirmation')).toBeInTheDocument();
    });
  });
});
