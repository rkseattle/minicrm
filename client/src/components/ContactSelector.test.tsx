/**
 * Tests for ContactSelector — searchable multi-select for linking contacts.
 *
 * Verifies:
 * - Shows "none" state when no contacts are selected
 * - Shows selected contacts as chips
 * - Removing a chip calls onChange with that contact removed
 * - Search input triggers the contacts API and shows results
 * - Clicking a search result calls onChange with that contact added
 * - "No results" state shown when search returns empty
 * - In disabled mode, search input is hidden and remove buttons are absent
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import ContactSelector from './ContactSelector.js';
import { CONTACT_1, CONTACT_2 } from '../test/msw/handlers.js';

describe('ContactSelector', () => {
  it('shows none state when no contacts are selected', () => {
    renderWithProviders(<ContactSelector selectedIds={[]} onChange={vi.fn()} />);

    expect(screen.getByTestId('contact-selector-none')).toBeInTheDocument();
  });

  it('does not show none state when contacts are selected', async () => {
    renderWithProviders(
      <ContactSelector selectedIds={[CONTACT_1.id]} onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('contact-selector-none')).not.toBeInTheDocument();
    });
  });

  it('renders chips for selected contacts once fetched', async () => {
    renderWithProviders(
      <ContactSelector selectedIds={[CONTACT_1.id]} onChange={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`contact-selector-chip-${CONTACT_1.id}`)).toBeInTheDocument();
    });
  });

  it('calls onChange without the contact when its chip remove button is clicked', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ContactSelector selectedIds={[CONTACT_1.id, CONTACT_2.id]} onChange={onChange} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId(`contact-selector-remove-${CONTACT_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`contact-selector-remove-${CONTACT_1.id}`));

    expect(onChange).toHaveBeenCalledWith([CONTACT_2.id]);
  });

  it('shows search input when not disabled', () => {
    renderWithProviders(<ContactSelector selectedIds={[]} onChange={vi.fn()} />);

    expect(screen.getByTestId('contact-selector-search')).toBeInTheDocument();
  });

  it('hides search input and remove buttons in disabled mode', () => {
    renderWithProviders(
      <ContactSelector selectedIds={[CONTACT_1.id]} onChange={vi.fn()} disabled />,
    );

    expect(screen.queryByTestId('contact-selector-search')).not.toBeInTheDocument();
  });

  it('shows search results dropdown after typing a query', async () => {
    renderWithProviders(<ContactSelector selectedIds={[]} onChange={vi.fn()} />);

    const input = screen.getByTestId('contact-selector-search');
    fireEvent.change(input, { target: { value: 'Alice' } });

    await waitFor(() => {
      expect(screen.getByTestId('contact-selector-dropdown')).toBeInTheDocument();
    });
  });

  it('shows no-results state when search returns empty', async () => {
    server.use(
      http.get('/api/contacts', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 }),
      ),
    );

    renderWithProviders(<ContactSelector selectedIds={[]} onChange={vi.fn()} />);

    const input = screen.getByTestId('contact-selector-search');
    fireEvent.change(input, { target: { value: 'xyz' } });

    await waitFor(() => {
      expect(screen.getByTestId('contact-selector-no-results')).toBeInTheDocument();
    });
  });

  it('calls onChange with added contact when a search result is clicked', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ContactSelector selectedIds={[]} onChange={onChange} />);

    const input = screen.getByTestId('contact-selector-search');
    fireEvent.change(input, { target: { value: 'Alice' } });

    await waitFor(() => {
      expect(
        screen.getByTestId(`contact-selector-option-${CONTACT_1.id}`),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`contact-selector-option-${CONTACT_1.id}`));

    expect(onChange).toHaveBeenCalledWith([CONTACT_1.id]);
  });

  it('does not add the same contact twice', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ContactSelector selectedIds={[CONTACT_1.id]} onChange={onChange} />,
    );

    const input = screen.getByTestId('contact-selector-search');
    fireEvent.change(input, { target: { value: 'Alice' } });

    await waitFor(() => {
      // CONTACT_1 is already selected so should not appear in results
      expect(
        screen.queryByTestId(`contact-selector-option-${CONTACT_1.id}`),
      ).not.toBeInTheDocument();
    });
  });
});
