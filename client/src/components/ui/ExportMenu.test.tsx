/**
 * Tests for ExportMenu — single "Export" trigger that reveals a dropdown of
 * export actions.
 *
 * Verifies:
 * - Trigger renders with correct aria attributes; menu closed by default
 * - Clicking the trigger opens the menu and focuses the first enabled item
 * - Clicking a menu item fires its onClick and closes the menu
 * - Disabled items are skipped when focusing the first item on open
 * - Hidden items are not rendered
 * - ArrowDown/ArrowUp/Home/End move focus between items (roving)
 * - Escape closes the menu and returns focus to the trigger
 * - Outside click closes the menu
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { ExportMenu } from './ExportMenu.js';
import type { ExportMenuItemConfig } from './ExportMenu.js';

interface ActionItemOverride {
  disabled?: boolean;
  hidden?: boolean;
  onClick?: () => void;
}

function defaultItems(overrides: ActionItemOverride[] = []): ExportMenuItemConfig[] {
  const base = [
    { key: 'csv', testId: 'export-csv-button', label: 'Export CSV', onClick: vi.fn() },
    { key: 'pdf', testId: 'export-pdf-button', label: 'Export PDF', onClick: vi.fn() },
    { key: 'all', testId: 'export-all-button', label: 'Export All', onClick: vi.fn() },
  ];
  return base.map((item, i) => ({ ...item, ...overrides[i] }));
}

describe('ExportMenu', () => {
  it('renders the trigger button with correct aria attributes', () => {
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={defaultItems()} />,
    );
    const trigger = screen.getByTestId('deals-export-menu-button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not render menu items until opened', () => {
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={defaultItems()} />,
    );
    expect(screen.queryByTestId('export-csv-button')).not.toBeInTheDocument();
  });

  it('opens the menu and focuses the first item on trigger click', async () => {
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={defaultItems()} />,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));

    expect(screen.getByTestId('deals-export-menu-button')).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByTestId('export-csv-button')).toHaveFocus());
  });

  it('skips disabled items when focusing the first item on open', async () => {
    const items = defaultItems([{ disabled: true }]);
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={items} />,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));
    await waitFor(() => expect(screen.getByTestId('export-pdf-button')).toHaveFocus());
  });

  it('does not render hidden items', () => {
    const items = defaultItems([{}, {}, { hidden: true }]);
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={items} />,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));
    expect(screen.queryByTestId('export-all-button')).not.toBeInTheDocument();
  });

  it('calls the item onClick and closes the menu when a menu item is clicked', () => {
    const onClick = vi.fn();
    const items = defaultItems([{ onClick }]);
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={items} />,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));
    fireEvent.click(screen.getByTestId('export-csv-button'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('deals-export-menu-button')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('export-csv-button')).not.toBeInTheDocument();
  });

  it('moves focus to the next item on ArrowDown', async () => {
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={defaultItems()} />,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));
    await waitFor(() => expect(screen.getByTestId('export-csv-button')).toHaveFocus());

    fireEvent.keyDown(screen.getByTestId('export-csv-button'), { key: 'ArrowDown' });
    expect(screen.getByTestId('export-pdf-button')).toHaveFocus();
  });

  it('moves focus to the previous item on ArrowUp, wrapping to the last item', async () => {
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={defaultItems()} />,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));
    await waitFor(() => expect(screen.getByTestId('export-csv-button')).toHaveFocus());

    fireEvent.keyDown(screen.getByTestId('export-csv-button'), { key: 'ArrowUp' });
    expect(screen.getByTestId('export-all-button')).toHaveFocus();
  });

  it('moves focus to the last item on End and back to the first on Home', async () => {
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={defaultItems()} />,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));
    await waitFor(() => expect(screen.getByTestId('export-csv-button')).toHaveFocus());

    fireEvent.keyDown(screen.getByTestId('export-csv-button'), { key: 'End' });
    expect(screen.getByTestId('export-all-button')).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId('export-all-button'), { key: 'Home' });
    expect(screen.getByTestId('export-csv-button')).toHaveFocus();
  });

  it('closes the menu and returns focus to the trigger on Escape', async () => {
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={defaultItems()} />,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));
    await waitFor(() => expect(screen.getByTestId('export-csv-button')).toHaveFocus());

    fireEvent.keyDown(screen.getByTestId('export-csv-button'), { key: 'Escape' });

    expect(screen.queryByTestId('export-csv-button')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('deals-export-menu-button')).toHaveFocus());
  });

  it('closes the menu on an outside click', async () => {
    renderWithProviders(
      <div>
        <ExportMenu label="Export" testId="deals-export-menu-button" items={defaultItems()} />
        <button type="button" data-testid="outside">
          Outside
        </button>
      </div>,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));
    await waitFor(() => expect(screen.getByTestId('export-csv-button')).toHaveFocus());

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(screen.queryByTestId('export-csv-button')).not.toBeInTheDocument();
  });

  it('preserves each item disabled state', () => {
    const items = defaultItems([{ disabled: true }]);
    renderWithProviders(
      <ExportMenu label="Export" testId="deals-export-menu-button" items={items} />,
    );
    fireEvent.click(screen.getByTestId('deals-export-menu-button'));
    expect(screen.getByTestId('export-csv-button')).toBeDisabled();
  });

  it('renders an enabled link item as a real anchor with the given href', () => {
    const items: ExportMenuItemConfig[] = [
      { key: 'csv', testId: 'export-csv-link', label: 'Export CSV', href: '/api/export.csv' },
    ];
    renderWithProviders(
      <ExportMenu label="Export" testId="reports-export-menu-button" items={items} />,
    );
    fireEvent.click(screen.getByTestId('reports-export-menu-button'));
    const link = screen.getByTestId('export-csv-link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/api/export.csv');
  });

  it('wraps around the visible items after the visible set shrinks', () => {
    const items: ExportMenuItemConfig[] = [
      { key: 'a', testId: 'export-a', label: 'A', onClick: vi.fn() },
      { key: 'b', testId: 'export-b', label: 'B', onClick: vi.fn() },
      { key: 'c', testId: 'export-c', label: 'C', onClick: vi.fn() },
    ];
    const { rerender } = render(
      <MemoryRouter>
        <ExportMenu label="Export" testId="reports-export-menu-button" items={items} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('reports-export-menu-button'));

    // Render three, then hide the last while the menu is open — the shape of a
    // role-gated item. The ref array keeps its third slot, so a wrap computed from
    // its length targets an unmounted item and focus stops moving entirely.
    rerender(
      <MemoryRouter>
        <ExportMenu
          label="Export"
          testId="reports-export-menu-button"
          items={[items[0], items[1], { ...items[2], hidden: true }]}
        />
      </MemoryRouter>,
    );
    const menu = screen.getByRole('menu');

    screen.getByTestId('export-a').focus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(screen.getByTestId('export-b')).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByTestId('export-a')).toHaveFocus();
  });

  it('renders a disabled link item as a disabled button, not a navigable anchor', () => {
    const items: ExportMenuItemConfig[] = [
      {
        key: 'csv',
        testId: 'export-csv-link',
        label: 'Export CSV',
        href: '/api/export.csv',
        disabled: true,
      },
    ];
    renderWithProviders(
      <ExportMenu label="Export" testId="reports-export-menu-button" items={items} />,
    );
    fireEvent.click(screen.getByTestId('reports-export-menu-button'));
    const item = screen.getByTestId('export-csv-link');
    expect(item.tagName).toBe('BUTTON');
    expect(item).toBeDisabled();
    expect(item).not.toHaveAttribute('href');
  });
});
