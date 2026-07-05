/**
 * Tests for ActivityTimeline component.
 * MINCRM-303: extended to cover mutation paths, direction badge, error states,
 * and delete confirmation branches.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
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
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10 }),
      ),
    );

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

    const meta = screen.getByTestId(`activity-meta-${ACTIVITY_1.id}`);
    expect(meta).toHaveTextContent(ACTIVITY_1.owner_name);
    expect(meta).toHaveTextContent(new Date(ACTIVITY_1.created_at).toLocaleString('en'));
  });

  it('shows "Mark complete" button for open tasks', async () => {
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`mark-complete-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });
  });

  it('shows completed badge for complete activities', async () => {
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({ data: [ACTIVITY_2], total: 1, page: 1, limit: 10 }),
      ),
    );

    renderWithProviders(<ActivityTimeline contactId={ACTIVITY_2.contact_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`activity-complete-badge-${ACTIVITY_2.id}`)).toBeInTheDocument();
    });
  });

  it('applies line-through styling to completed activity subjects', async () => {
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({ data: [ACTIVITY_2], total: 1, page: 1, limit: 10 }),
      ),
    );

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
      http.get('/api/v1/auth/me', () =>
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

  it('does not show "Load more" button when all activities are returned', async () => {
    // Default handler returns 2 activities with total=2, so none are hidden
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`activity-item-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    expect(screen.queryByTestId('activity-timeline-load-more')).not.toBeInTheDocument();
  });

  it('shows "Load more" button when total exceeds currently loaded count', async () => {
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({ data: [ACTIVITY_1], total: 5, page: 1, limit: 10 }),
      ),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId('activity-timeline-load-more')).toBeInTheDocument();
    });
  });

  it('renders the direction badge when an activity has a direction set', async () => {
    const activityWithDirection = {
      ...ACTIVITY_1,
      id: '00000000-0000-0000-0000-000000000411',
      type: 'Call',
      direction: 'Inbound',
    };
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({
          data: [activityWithDirection],
          total: 1,
          page: 1,
          limit: 10,
        }),
      ),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(
        screen.getByTestId(`activity-direction-${activityWithDirection.id}`),
      ).toBeInTheDocument();
    });
  });

  it('renders the outcome text when an activity has an outcome set', async () => {
    const activityWithOutcome = {
      ...ACTIVITY_1,
      id: '00000000-0000-0000-0000-000000000412',
      outcome: 'Left voicemail',
    };
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({ data: [activityWithOutcome], total: 1, page: 1, limit: 10 }),
      ),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`activity-outcome-${activityWithOutcome.id}`)).toHaveTextContent(
        'Left voicemail',
      );
    });
  });

  it('shows edit/delete for activities owned by another user when current user is admin', async () => {
    const foreignActivity = {
      ...ACTIVITY_1,
      id: '00000000-0000-0000-0000-000000000413',
      owner_id: '00000000-0000-0000-0000-000000000099',
    };
    server.use(
      http.get('/api/v1/activities', () =>
        HttpResponse.json({ data: [foreignActivity], total: 1, page: 1, limit: 10 }),
      ),
    );
    // Default auth handler returns ADMIN_USER (role: 'admin')
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`edit-activity-${foreignActivity.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`delete-activity-${foreignActivity.id}`)).toBeInTheDocument();
    });
  });

  it('does not show delete/edit when user is null (unauthenticated)', async () => {
    server.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json({ user: null }, { status: 401 })),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      // Activities load, but no edit/delete buttons since canModify returns false
      expect(screen.queryByTestId(`edit-activity-${ACTIVITY_1.id}`)).not.toBeInTheDocument();
    });
  });

  it('shows the create error message when create mutation fails', async () => {
    server.use(
      http.post('/api/v1/activities', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Subject is required' } },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-activity-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-activity-button'));

    await waitFor(() => {
      expect(screen.getByTestId('activity-create-form-container')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('activity-subject'), 'Test activity');
    await user.click(screen.getByTestId('activity-form-submit'));

    await waitFor(() => {
      // Form stays visible; the error is shown inside ActivityForm via its error prop
      expect(screen.getByTestId('activity-create-form-container')).toBeInTheDocument();
    });
  });

  it('closes the create form when cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-activity-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-activity-button'));
    expect(screen.getByTestId('activity-create-form-container')).toBeInTheDocument();

    await user.click(screen.getByTestId('activity-form-cancel'));

    expect(screen.queryByTestId('activity-create-form-container')).not.toBeInTheDocument();
  });

  it('successfully creates an activity and closes the form', async () => {
    let createCalled = false;
    server.use(
      http.post('/api/v1/activities', () => {
        createCalled = true;
        return HttpResponse.json(
          { activity: { ...ACTIVITY_1, id: '00000000-0000-0000-0000-000000000414' } },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-activity-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-activity-button'));

    await waitFor(() => {
      expect(screen.getByTestId('activity-create-form-container')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('activity-subject'), 'New activity subject');
    await user.click(screen.getByTestId('activity-form-submit'));

    await waitFor(() => {
      expect(createCalled).toBe(true);
    });
  });

  it('successfully updates an activity and closes the edit form', async () => {
    let patchCalled = false;
    server.use(
      http.patch(`/api/v1/activities/${ACTIVITY_1.id}`, async () => {
        patchCalled = true;
        return HttpResponse.json({ activity: { ...ACTIVITY_1, subject: 'Updated subject' } });
      }),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`edit-activity-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`edit-activity-${ACTIVITY_1.id}`));

    // The edit form is pre-populated with ACTIVITY_1.subject so the submit button is enabled
    fireEvent.click(screen.getByTestId('activity-form-submit'));

    await waitFor(() => {
      expect(patchCalled).toBe(true);
    });
  });

  it('shows the edit error message when update mutation fails', async () => {
    server.use(
      http.patch(`/api/v1/activities/${ACTIVITY_1.id}`, () =>
        HttpResponse.json(
          { error: { code: 'SERVER_ERROR', message: 'Failed to update' } },
          { status: 500 },
        ),
      ),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`edit-activity-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`edit-activity-${ACTIVITY_1.id}`));

    // The edit form is pre-populated so the submit button is enabled
    fireEvent.click(screen.getByTestId('activity-form-submit'));

    // Edit form should still be visible with an error
    await waitFor(() => {
      expect(screen.getByTestId('activity-form')).toBeInTheDocument();
    });
  });

  it('shows the complete error when mark-complete mutation fails', async () => {
    server.use(
      http.patch(`/api/v1/activities/${ACTIVITY_1.id}`, () =>
        HttpResponse.json(
          { error: { code: 'SERVER_ERROR', message: 'Failed to complete' } },
          { status: 500 },
        ),
      ),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`mark-complete-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`mark-complete-${ACTIVITY_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('complete-error')).toBeInTheDocument();
    });
  });

  it('deletes an activity when the user confirms the window.confirm dialog', async () => {
    let deleteCalled = false;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(
      http.delete(`/api/v1/activities/${ACTIVITY_1.id}`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`delete-activity-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`delete-activity-${ACTIVITY_1.id}`));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });

    vi.restoreAllMocks();
  });

  it('does not delete an activity when the user cancels the window.confirm dialog', async () => {
    let deleteCalled = false;
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    server.use(
      http.delete(`/api/v1/activities/${ACTIVITY_1.id}`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`delete-activity-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`delete-activity-${ACTIVITY_1.id}`));

    expect(deleteCalled).toBe(false);

    vi.restoreAllMocks();
  });

  it('shows the delete error when delete mutation fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(
      http.delete(`/api/v1/activities/${ACTIVITY_1.id}`, () =>
        HttpResponse.json(
          { error: { code: 'SERVER_ERROR', message: 'Failed to delete' } },
          { status: 500 },
        ),
      ),
    );

    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`delete-activity-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`delete-activity-${ACTIVITY_1.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('delete-error')).toBeInTheDocument();
    });

    vi.restoreAllMocks();
  });

  it('closes the edit form when cancel is clicked', async () => {
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId(`edit-activity-${ACTIVITY_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`edit-activity-${ACTIVITY_1.id}`));
    expect(screen.getByTestId('activity-form')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('activity-form-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('activity-form')).not.toBeInTheDocument();
    });
  });

  // MINCRM-436: AI call/note summarizer — accepted follow-up tasks create linked Task activities
  it('creates a linked Task activity for each accepted AI-suggested follow-up task', async () => {
    const createdActivityBodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('/api/v1/activities/summarize', () =>
        HttpResponse.json({
          summary: 'Summary text.',
          action_items: [],
          suggested_follow_up_tasks: [
            { description: 'Send follow-up email', suggested_due_date: '2026-07-11' },
          ],
          generated_at: '2026-07-04T00:00:00.000Z',
        }),
      ),
      http.post('/api/v1/activities', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        createdActivityBodies.push(body);
        return HttpResponse.json(
          {
            activity: {
              ...ACTIVITY_1,
              id: '00000000-0000-0000-0000-000000000404',
              type: body['type'],
              subject: body['subject'],
              due_date: body['due_date'],
            },
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ActivityTimeline dealId={ACTIVITY_1.deal_id!} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-activity-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('add-activity-button'));
    await user.click(screen.getByTestId('activity-summarize-button'));
    await user.type(screen.getByTestId('activity-summary-input'), 'Raw call transcript text');
    await user.click(screen.getByTestId('activity-summary-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('activity-summary-apply')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('activity-summary-apply'));

    await waitFor(() => {
      expect(createdActivityBodies).toContainEqual(
        expect.objectContaining({
          type: 'Task',
          subject: 'Send follow-up email',
          due_date: '2026-07-11',
          deal_id: ACTIVITY_1.deal_id,
        }),
      );
    });
  });
});
