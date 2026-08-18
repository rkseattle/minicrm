/**
 * Unit tests for SubPageNav component.
 *
 * Default test environment: desktop (matchMedia returns matches=true for min-width:768px),
 * navLayout='top' → vertical tab list mode.
 *
 * Mobile mode tests override matchMedia to simulate a narrow viewport.
 * Horizontal mode tests override navLayout to 'left' via MSW.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import SubPageNav from './SubPageNav.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

const TEST_ITEMS = [
  { key: 'alpha', label: 'Alpha', 'data-testid': 'tab-alpha' },
  { key: 'beta', label: 'Beta', 'data-testid': 'tab-beta' },
  { key: 'gamma', label: 'Gamma', 'data-testid': 'tab-gamma' },
];

function renderNav(
  activeKey = 'alpha',
  onChange = vi.fn(),
  overrides: { listTestId?: string } = {},
) {
  return renderWithProviders(
    <SubPageNav
      items={TEST_ITEMS}
      activeKey={activeKey}
      onChange={onChange}
      ariaLabel="Test nav"
      data-testid={overrides.listTestId ?? 'test-tab-list'}
    />,
  );
}

// ── Vertical tabs (desktop + top/hamburger nav — default) ────────────────────

describe('SubPageNav — vertical tab list (desktop + top nav, default)', () => {
  it('renders a tablist with role="tablist"', async () => {
    renderNav();
    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });
  });

  it('renders one tab button per item', async () => {
    renderNav();
    await waitFor(() => {
      expect(screen.getByTestId('tab-alpha')).toBeInTheDocument();
      expect(screen.getByTestId('tab-beta')).toBeInTheDocument();
      expect(screen.getByTestId('tab-gamma')).toBeInTheDocument();
    });
  });

  it('marks the active tab as aria-selected="true"', async () => {
    renderNav('beta');
    await waitFor(() => {
      expect(screen.getByTestId('tab-beta')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('tab-alpha')).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('calls onChange when an inactive tab is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderNav('alpha', onChange);
    await waitFor(() => expect(screen.getByTestId('tab-beta')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-beta'));
    expect(onChange).toHaveBeenCalledWith('beta');
  });

  it('does not call onChange when the active tab is clicked again', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderNav('alpha', onChange);
    await waitFor(() => expect(screen.getByTestId('tab-alpha')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-alpha'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not render a native select element', async () => {
    renderNav();
    await waitFor(() => expect(screen.getByRole('tablist')).toBeInTheDocument());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

// ── Horizontal tabs (desktop + left sidebar nav) ─────────────────────────────

describe('SubPageNav — horizontal tab bar (desktop + left sidebar nav)', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/settings/nav-layout', () => HttpResponse.json({ layout: 'left' })),
    );
  });

  it('renders a horizontal tablist', async () => {
    renderNav();
    await waitFor(() => {
      const tablist = screen.getByRole('tablist');
      expect(tablist).toBeInTheDocument();
    });
  });

  it('marks the active tab as aria-selected="true"', async () => {
    renderNav('gamma');
    await waitFor(() => {
      expect(screen.getByTestId('tab-gamma')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('tab-alpha')).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('calls onChange when an inactive tab is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderNav('alpha', onChange);
    await waitFor(() => expect(screen.getByTestId('tab-gamma')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-gamma'));
    expect(onChange).toHaveBeenCalledWith('gamma');
  });

  it('does not call onChange when the active tab is re-clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderNav('beta', onChange);
    await waitFor(() => expect(screen.getByTestId('tab-beta')).toBeInTheDocument());
    await user.click(screen.getByTestId('tab-beta'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ── Mobile select picker ──────────────────────────────────────────────────────

describe('SubPageNav — mobile select picker', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query !== '(min-width: 768px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    // Restore desktop matchMedia default
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(min-width: 768px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders a native select element (no tablist)', async () => {
    renderNav();
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('select has the active key as its current value', async () => {
    renderNav('beta');
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('beta');
    });
  });

  it('calls onChange when a different option is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderNav('alpha', onChange);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'gamma');
    expect(onChange).toHaveBeenCalledWith('gamma');
  });

  it('does not call onChange when the same option is re-selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderNav('alpha', onChange);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'alpha');
    expect(onChange).not.toHaveBeenCalled();
  });
});
