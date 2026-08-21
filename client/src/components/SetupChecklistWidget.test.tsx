/**
 * Tests for SetupChecklistWidget component.
 *
 * Verifies:
 * - Widget renders for admin when is_first_run is true
 * - Widget does not render for rep users
 * - Widget does not render when onboarding_completed is true
 * - All five tasks are shown
 * - Incomplete tasks show action links; completed tasks do not
 * - Collapse/expand toggle works and persists to localStorage
 * - Collapsed pill is shown when expanded=false
 * - X dismiss button calls PUT /api/v1/settings/onboarding with true
 * - Completion celebration shown when all tasks done; auto-dismiss fires
 * - Loading state renders nothing
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import SetupChecklistWidget from './SetupChecklistWidget.js';

/** In-memory localStorage substitute for tests (same pattern as ReportsPage.test.tsx). */
function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string): string | null => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  };
}

const ALL_INCOMPLETE_TASKS = [
  { id: 'pipeline_stages_reviewed', completed: false },
  { id: 'team_member_invited', completed: false },
  { id: 'first_contact_added', completed: false },
  { id: 'first_deal_created', completed: false },
  { id: 'smtp_configured', completed: false },
];

const ALL_COMPLETE_TASKS = ALL_INCOMPLETE_TASKS.map((t) => ({ ...t, completed: true }));

// rep task list (4 tasks, no admin-only tasks)
const REP_INCOMPLETE_TASKS = [
  { id: 'first_contact_added', completed: false },
  { id: 'first_account_created', completed: false },
  { id: 'first_deal_created', completed: false },
  { id: 'logged_first_activity', completed: false },
];

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

function mockFirstRun(tasks = ALL_INCOMPLETE_TASKS) {
  server.use(
    http.get('/api/v1/settings/onboarding', () =>
      HttpResponse.json({ is_first_run: true, onboarding_completed: false, tasks }),
    ),
  );
}

function mockOnboardingCompleted() {
  server.use(
    http.get('/api/v1/settings/onboarding', () =>
      HttpResponse.json({
        is_first_run: false,
        onboarding_completed: true,
        tasks: ALL_COMPLETE_TASKS,
      }),
    ),
  );
}

let localStorageMock: ReturnType<typeof makeLocalStorageMock>;

beforeEach(() => {
  server.use(http.get('/api/v1/settings/nav-layout', () => HttpResponse.json({ layout: 'top' })));
  localStorageMock = makeLocalStorageMock();
  vi.stubGlobal('localStorage', localStorageMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SetupChecklistWidget', () => {
  it('renders expanded widget for admin when is_first_run is true', async () => {
    mockAdminUser();
    mockFirstRun();

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-widget')).toBeInTheDocument();
    });
  });

  // reps now have their own onboarding checklist
  it('renders widget for rep users when is_first_run is true', async () => {
    mockRepUser();
    server.use(
      http.get('/api/v1/settings/onboarding', () =>
        HttpResponse.json({
          is_first_run: true,
          onboarding_completed: false,
          tasks: REP_INCOMPLETE_TASKS,
        }),
      ),
    );

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-widget')).toBeInTheDocument();
    });
  });

  it('does not render when onboarding_completed is true', async () => {
    mockAdminUser();
    mockOnboardingCompleted();

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(() => {
      expect(screen.queryByTestId('setup-checklist-widget')).not.toBeInTheDocument();
    });
  });

  it('shows all five tasks', async () => {
    mockAdminUser();
    mockFirstRun();

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-task-list')).toBeInTheDocument();
    });
    const list = screen.getByTestId('setup-checklist-task-list');
    expect(list.querySelectorAll('li')).toHaveLength(5);
  });

  it('shows action links for incomplete tasks', async () => {
    mockAdminUser();
    mockFirstRun(ALL_INCOMPLETE_TASKS);

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-task-list')).toBeInTheDocument();
    });
    // All 5 tasks incomplete → 5 "Go" links
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(5);
  });

  it('does not show action link for completed tasks', async () => {
    const tasks = [
      { id: 'pipeline_stages_reviewed', completed: true },
      ...ALL_INCOMPLETE_TASKS.slice(1),
    ];
    mockAdminUser();
    mockFirstRun(tasks);

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-task-list')).toBeInTheDocument();
    });
    // 4 incomplete → 4 links
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
  });

  it('collapses to pill when collapse button is clicked', async () => {
    mockAdminUser();
    mockFirstRun();

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-collapse-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('setup-checklist-collapse-button'));

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-pill')).toBeInTheDocument();
      expect(screen.queryByTestId('setup-checklist-widget')).not.toBeInTheDocument();
    });
  });

  it('persists collapsed state in localStorage', async () => {
    mockAdminUser();
    mockFirstRun();

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-collapse-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('setup-checklist-collapse-button'));

    await waitFor(() => {
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'minicrm_setup_checklist_expanded',
        'false',
      );
    });
  });

  it('expands from pill when pill is clicked', async () => {
    // Configure mock to return 'false' BEFORE rendering so useState reads it
    localStorageMock.getItem.mockImplementation((key: string): string | null =>
      key === 'minicrm_setup_checklist_expanded' ? 'false' : null,
    );
    mockAdminUser();
    mockFirstRun();

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(
      () => {
        expect(screen.getByTestId('setup-checklist-pill')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    fireEvent.click(screen.getByTestId('setup-checklist-expand-button'));

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-widget')).toBeInTheDocument();
      expect(screen.queryByTestId('setup-checklist-pill')).not.toBeInTheDocument();
    });
  });

  it('calls dismiss API when X is clicked', async () => {
    mockAdminUser();

    let dismissCalled = false;
    let getCallCount = 0;
    server.use(
      http.get('/api/v1/settings/onboarding', () => {
        getCallCount += 1;
        if (getCallCount === 1) {
          return HttpResponse.json({
            is_first_run: true,
            onboarding_completed: false,
            tasks: ALL_INCOMPLETE_TASKS,
          });
        }
        return HttpResponse.json({
          is_first_run: false,
          onboarding_completed: true,
          tasks: ALL_COMPLETE_TASKS,
        });
      }),
      http.put('/api/v1/settings/onboarding', () => {
        dismissCalled = true;
        return HttpResponse.json({ onboarding_completed: true });
      }),
    );

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(() => {
      expect(screen.getByTestId('setup-checklist-dismiss-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('setup-checklist-dismiss-button'));

    await waitFor(() => {
      expect(dismissCalled).toBe(true);
    });
  });

  it('shows completion celebration when all tasks are done', async () => {
    mockAdminUser();

    server.use(
      http.get('/api/v1/settings/onboarding', () =>
        HttpResponse.json({
          is_first_run: true,
          onboarding_completed: false,
          tasks: ALL_COMPLETE_TASKS,
        }),
      ),
      http.put('/api/v1/settings/onboarding', () =>
        HttpResponse.json({ onboarding_completed: true }),
      ),
    );

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(
      () => {
        expect(screen.getByTestId('setup-checklist-complete')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('shows progress bar with correct count', async () => {
    const tasks = [
      { id: 'pipeline_stages_reviewed', completed: true },
      { id: 'team_member_invited', completed: true },
      { id: 'first_contact_added', completed: false },
      { id: 'first_deal_created', completed: false },
      { id: 'smtp_configured', completed: false },
    ];
    mockAdminUser();
    mockFirstRun(tasks);

    renderWithProviders(<SetupChecklistWidget />);

    await waitFor(
      () => {
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('2');
    expect(progressbar.getAttribute('aria-valuemax')).toBe('5');
  });
});
