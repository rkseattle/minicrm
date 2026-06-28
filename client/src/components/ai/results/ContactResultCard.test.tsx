/**
 * Tests for ContactResultCard. (MINCRM-431)
 *
 * Covers:
 *  - Renders name as a link to /contacts/:id
 *  - Renders tags via TagBadge
 *  - Renders title and account_name when provided
 *  - Omits optional fields when null/undefined
 *  - Shows last_activity_at date when present
 */

import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/renderWithProviders.js';
import ContactResultCard from './ContactResultCard.js';

const baseContact = {
  id: 'contact-1',
  first_name: 'Alice',
  last_name: 'Smith',
};

describe('ContactResultCard — name link', () => {
  it('renders full name as a link to the contact detail page', () => {
    renderWithProviders(<ContactResultCard contact={baseContact} />);
    const link = screen.getByTestId('nli-contact-card-link-contact-1');
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent('Alice Smith');
    expect(link).toHaveAttribute('href', '/contacts/contact-1');
  });

  it('handles null last_name gracefully', () => {
    renderWithProviders(<ContactResultCard contact={{ ...baseContact, last_name: null }} />);
    expect(screen.getByTestId('nli-contact-card-link-contact-1')).toHaveTextContent('Alice');
  });
});

describe('ContactResultCard — tags', () => {
  it('renders tags via TagBadge when present', () => {
    renderWithProviders(
      <ContactResultCard
        contact={{
          ...baseContact,
          tags: [
            { id: 'tag-1', name: 'VIP' },
            { id: 'tag-2', name: 'Prospect' },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('tag-badge-tag-1')).toHaveTextContent('VIP');
    expect(screen.getByTestId('tag-badge-tag-2')).toHaveTextContent('Prospect');
  });

  it('renders no tag badges when tags array is empty', () => {
    renderWithProviders(<ContactResultCard contact={{ ...baseContact, tags: [] }} />);
    expect(screen.queryByTestId(/tag-badge-/)).not.toBeInTheDocument();
  });
});

describe('ContactResultCard — optional fields', () => {
  it('renders title and account_name when provided', () => {
    renderWithProviders(
      <ContactResultCard contact={{ ...baseContact, title: 'CEO', account_name: 'Acme Corp' }} />,
    );
    expect(screen.getByText('CEO')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('omits title paragraph when title is not provided', () => {
    renderWithProviders(<ContactResultCard contact={baseContact} />);
    // No title or account_name text should appear other than the name link
    expect(screen.queryByText('CEO')).not.toBeInTheDocument();
  });

  it('renders email when provided', () => {
    renderWithProviders(
      <ContactResultCard contact={{ ...baseContact, email: 'alice@example.com' }} />,
    );
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });
});

describe('ContactResultCard — last activity', () => {
  it('shows last activity date when last_activity_at is provided', () => {
    renderWithProviders(
      <ContactResultCard contact={{ ...baseContact, last_activity_at: '2024-03-15T10:00:00Z' }} />,
    );
    // The component slices to YYYY-MM-DD and uses the i18n key ai.results.lastActivity
    expect(screen.getByText(/2024-03-15/)).toBeInTheDocument();
  });

  it('omits the last activity span when last_activity_at is null', () => {
    renderWithProviders(<ContactResultCard contact={{ ...baseContact, last_activity_at: null }} />);
    expect(screen.queryByText(/Last activity/)).not.toBeInTheDocument();
  });
});
