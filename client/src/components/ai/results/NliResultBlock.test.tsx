/**
 * Tests for NliResultBlock dispatcher. (MINCRM-431)
 *
 * Covers:
 *  - Loading state renders skeleton (nli-result-loading)
 *  - No read tools → renders nothing
 *  - Write-only tools → renders nothing
 *  - searchContacts output renders ContactResultCard items
 *  - Empty data array shows noResults text
 *  - Single-record getContact output renders one card
 *  - Multiple read tool blocks are each rendered in their own group
 */

import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/renderWithProviders.js';
import NliResultBlock from './NliResultBlock.js';
import type { AiToolResult } from '@shared/schemas/aiSessionSchema.js';

describe('NliResultBlock — loading state', () => {
  it('renders skeleton divs when isLoading is true', () => {
    const toolResults: AiToolResult[] = [];
    renderWithProviders(<NliResultBlock toolResults={toolResults} isLoading={true} />);
    expect(screen.getByTestId('nli-result-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('nli-result-block')).not.toBeInTheDocument();
  });
});

describe('NliResultBlock — no renderable results', () => {
  it('renders nothing when toolResults is empty', () => {
    const { container } = renderWithProviders(<NliResultBlock toolResults={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for write tool results (createContact)', () => {
    const toolResults: AiToolResult[] = [
      {
        toolName: 'createContact',
        input: { first_name: 'Bob' },
        output: { id: 'c1', first_name: 'Bob' },
      },
    ];
    const { container } = renderWithProviders(<NliResultBlock toolResults={toolResults} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for admin tools', () => {
    const toolResults: AiToolResult[] = [
      {
        toolName: 'listUsers',
        input: {},
        output: { data: [] },
      },
    ];
    const { container } = renderWithProviders(<NliResultBlock toolResults={toolResults} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('NliResultBlock — searchContacts', () => {
  it('renders ContactResultCard items for each contact in data array', () => {
    const toolResults: AiToolResult[] = [
      {
        toolName: 'searchContacts',
        input: { query: 'alice' },
        output: {
          data: [
            { id: 'c1', first_name: 'Alice', last_name: 'Smith' },
            { id: 'c2', first_name: 'Bob', last_name: 'Jones' },
          ],
          total: 2,
        },
      },
    ];
    renderWithProviders(<NliResultBlock toolResults={toolResults} />);
    expect(screen.getByTestId('nli-result-block')).toBeInTheDocument();
    expect(screen.getByTestId('nli-contact-card-c1')).toBeInTheDocument();
    expect(screen.getByTestId('nli-contact-card-c2')).toBeInTheDocument();
  });

  it('shows noResults text when data array is empty', () => {
    const toolResults: AiToolResult[] = [
      {
        toolName: 'searchContacts',
        input: { query: 'nobody' },
        output: { data: [], total: 0 },
      },
    ];
    renderWithProviders(<NliResultBlock toolResults={toolResults} />);
    expect(screen.getByTestId('nli-result-empty')).toHaveTextContent('No results found.');
  });
});

describe('NliResultBlock — getContact single record', () => {
  it('renders one ContactResultCard when getContact returns a single record', () => {
    const toolResults: AiToolResult[] = [
      {
        toolName: 'getContact',
        input: { id: 'c42' },
        output: { id: 'c42', first_name: 'Carol', last_name: 'White' },
      },
    ];
    renderWithProviders(<NliResultBlock toolResults={toolResults} />);
    expect(screen.getByTestId('nli-contact-card-c42')).toBeInTheDocument();
    expect(screen.getByTestId('nli-contact-card-link-c42')).toHaveTextContent('Carol White');
  });
});

describe('NliResultBlock — multiple read tool blocks', () => {
  it('renders each block in its own group div', () => {
    const toolResults: AiToolResult[] = [
      {
        toolName: 'searchContacts',
        input: { query: 'alice' },
        output: { data: [{ id: 'c1', first_name: 'Alice', last_name: null }], total: 1 },
      },
      {
        toolName: 'searchDeals',
        input: { query: 'big deal' },
        output: { data: [{ id: 'd1', name: 'Big Deal' }], total: 1 },
      },
    ];
    renderWithProviders(<NliResultBlock toolResults={toolResults} />);
    expect(screen.getByTestId('nli-result-group-0')).toBeInTheDocument();
    expect(screen.getByTestId('nli-result-group-1')).toBeInTheDocument();
    expect(screen.getByTestId('nli-contact-card-c1')).toBeInTheDocument();
    expect(screen.getByTestId('nli-deal-card-d1')).toBeInTheDocument();
  });
});
