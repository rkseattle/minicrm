/**
 * Tests for ActivityTimeline component.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import ActivityTimeline from './ActivityTimeline.js';
import { ACTIVITY_1, ACTIVITY_2, ADMIN_USER } from '@/test/msw/handlers.js';

describe('ActivityTimeline', () => {
  it('shows the loading state while fetching', () => {
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);
    expect(screen.getByTestId('activity-timeline-loading')).toBeInTheDocument();
  });

  it('shows the empty state when there are no activities', async () => {
    server.use(http.get('/api/activities', () => HttpResponse.json({ activities: [] })));

    renderWithProviders(<ActivityTimeline dealId="00000000-0000-0000-0000-000000000999" />);

    await waitFor(() => {
      expect(screen.getByTestId('activity-timeline-empty')).toBeInTheDocument();
    });
  });

  it('renders activity items from the API', async () => {
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`activity-item-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    expect(screen.getByTestId(`activity-subject-${ACTIVITY_1.id}`)).toHaveTextContent(
      ACTIVITY_1.subject,
    );
    expect(screen.getByTestId(`activity-notes-${ACTIVITY_1.id}`)).toHaveTextContent(
      ACTIVITY_1.notes!,
    );
    expect(screen.getByTestId(`activity-due-date-${ACTIVITY_1.id}`)).toHaveTextContent(
      ACTIVITY_1.due_date!,
    );
  });

  it('renders the author name and timestamp in the meta line', async () => {
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`activity-meta-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    expect(screen.getByTestId(`activity-meta-${ACTIVITY_1.id}`)).toHaveTextContent(
      ACTIVITY_1.owner_name,
    );
  });

  it('shows "Mark complete" button for open tasks', async () => {
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`mark-complete-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });
  });

  it('shows completed badge for complete activities', async () => {
    server.use(http.get('/api/activities', () => HttpResponse.json({ activities: [ACTIVITY_2] })));

    renderWithProviders(<ActivityTimeline contactId={ACTIVITY_2.contact_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`activity-complete-badge-${ACTIVITY_2.id}`)).toBeInTheDocument();
    });
  });

  it('applies line-through styling to completed activity subjects', async () => {
    server.use(http.get('/api/activities', () => HttpResponse.json({ activities: [ACTIVITY_2] })));

    renderWithProviders(<ActivityTimeline contactId={ACTIVITY_2.contact_id!} />);

    await waitFor(() => {
      const subject = screen.getByTestId(`activity-subject-${ACTIVITY_2.id}`);
      expect(subject.className).toContain('line-through');
    });
  });

  it('shows edit and delete buttons for owned activities when user is the owner', async () => {
    // Default MSW handler returns ADMIN_USER as the current user
    // ACTIVITY_1.owner_id matches ADMIN_USER.id
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`edit-activity-${ACTIVITY_1.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`delete-activity-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });
  });

  it('does not show edit/delete for activities owned by another user', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({
          user: { ...ADMIN_USER, id: '00000000-0000-0000-0000-000000000999', role: 'rep' },
        }),
      ),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.queryByTestId(`edit-activity-${ACTIVITY_1.id}`)).not.toBeInTheDocument();
    });
  });

  it('shows the "Log activity" button when not in create mode', async () => {
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-activity-button')).toBeInTheDocument();
    });
  });

  it('reveals the create form when "Log activity" is clicked', async () => {
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-activity-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('add-activity-button'));

    expect(screen.getByTestId('activity-create-form-container')).toBeInTheDocument();
  });

  it('shows the edit form inline when the edit button is clicked', async () => {
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`edit-activity-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`edit-activity-${ACTIVITY_1.id}`));

    expect(screen.getByTestId('activity-form')).toBeInTheDocument();
  });
});
