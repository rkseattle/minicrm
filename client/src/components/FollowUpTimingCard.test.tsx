/**
 * Tests for the FollowUpTimingCard component. (MINCRM-470)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import FollowUpTimingCard from './FollowUpTimingCard.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';

const CONTACT_ID = '00000000-0000-0000-0000-000000000101';

const SUGGESTION = {
  contact_id: CONTACT_ID,
  day_of_week: 2,
  hour_start: 9,
  hour_end: 11,
  timezone: 'UTC',
  sample_size: 6,
  computed_at: '2026-07-01T00:00:00.000Z',
};

describe('FollowUpTimingCard', () => {
  it('renders the suggestion sentence with the contact name and day/time', () => {
    renderWithProviders(
      <FollowUpTimingCard contactId={CONTACT_ID} contactName="Sarah Lee" suggestion={SUGGESTION} />,
    );
    expect(screen.getByTestId(`followup-timing-suggestion-${CONTACT_ID}`)).toHaveTextContent(
      'Sarah Lee',
    );
    expect(screen.getByTestId(`followup-timing-suggestion-${CONTACT_ID}`)).toHaveTextContent(
      '9 AM–11 AM',
    );
  });

  it('does not show the schedule form until the button is clicked', () => {
    renderWithProviders(
      <FollowUpTimingCard contactId={CONTACT_ID} contactName="Sarah Lee" suggestion={SUGGESTION} />,
    );
    expect(
      screen.queryByTestId(`followup-timing-schedule-form-${CONTACT_ID}`),
    ).not.toBeInTheDocument();
  });

  it('opens a pre-populated, editable Task form when Schedule follow-up is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <FollowUpTimingCard contactId={CONTACT_ID} contactName="Sarah Lee" suggestion={SUGGESTION} />,
    );

    await user.click(screen.getByTestId(`followup-timing-schedule-${CONTACT_ID}`));

    await waitFor(() => {
      expect(screen.getByTestId(`followup-timing-schedule-form-${CONTACT_ID}`)).toBeInTheDocument();
    });
    const subjectInput = screen.getByLabelText(/subject/i) as HTMLInputElement;
    expect(subjectInput.value).toContain('Sarah Lee');
  });

  it('creates the Task activity and closes the form on successful submit', async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post('/api/v1/activities', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            activity: {
              id: 'a1',
              type: 'Task',
              subject: 'Follow up',
              notes: null,
              due_date: '2026-07-14',
              status: 'open',
              direction: null,
              outcome: null,
              contact_id: CONTACT_ID,
              account_id: null,
              deal_id: null,
              owner_id: 'u1',
              owner_name: 'Test User',
              created_at: '2026-07-01T00:00:00.000Z',
              updated_at: '2026-07-01T00:00:00.000Z',
              version: 1,
            },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <FollowUpTimingCard contactId={CONTACT_ID} contactName="Sarah Lee" suggestion={SUGGESTION} />,
    );

    await user.click(screen.getByTestId(`followup-timing-schedule-${CONTACT_ID}`));
    await waitFor(() => {
      expect(screen.getByTestId(`followup-timing-schedule-form-${CONTACT_ID}`)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(
        screen.queryByTestId(`followup-timing-schedule-form-${CONTACT_ID}`),
      ).not.toBeInTheDocument();
    });
    expect(capturedBody).toMatchObject({ type: 'Task', contact_id: CONTACT_ID });
  });

  it('shows an error message when scheduling fails', async () => {
    server.use(
      http.post('/api/v1/activities', () =>
        HttpResponse.json(
          { error: { code: 'SERVER_ERROR', message: 'Save failed' } },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <FollowUpTimingCard contactId={CONTACT_ID} contactName="Sarah Lee" suggestion={SUGGESTION} />,
    );

    await user.click(screen.getByTestId(`followup-timing-schedule-${CONTACT_ID}`));
    await waitFor(() => {
      expect(screen.getByTestId(`followup-timing-schedule-form-${CONTACT_ID}`)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('computes the pre-populated due date in the suggestion timezone, not the browser timezone', async () => {
    // Regression test: nextDateForDayOfWeek previously computed "today" from the
    // browser's local Date#getDay(), not suggestion.timezone (the org default).
    // Freeze the system clock at a UTC instant where the two timezones disagree
    // on the current calendar day: 2026-07-14 (Tue) 01:00 UTC is still Monday
    // 2026-07-13 in America/Los_Angeles (UTC-7 in July).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-14T01:00:00.000Z'));

    const pacificSuggestion = {
      ...SUGGESTION,
      day_of_week: 2, // Tuesday, in America/Los_Angeles
      timezone: 'America/Los_Angeles',
    };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(
      <FollowUpTimingCard
        contactId={CONTACT_ID}
        contactName="Sarah Lee"
        suggestion={pacificSuggestion}
      />,
    );

    await user.click(screen.getByTestId(`followup-timing-schedule-${CONTACT_ID}`));
    await waitFor(() => {
      expect(screen.getByTestId(`followup-timing-schedule-form-${CONTACT_ID}`)).toBeInTheDocument();
    });

    const dueDateInput = screen.getByLabelText(/due date/i) as HTMLInputElement;
    // It is still Monday in America/Los_Angeles, so the next Tuesday is 2026-07-14
    // (today in UTC) — not 2026-07-21, which a browser-UTC-based "today" of
    // Tuesday would have incorrectly rolled forward to next week.
    expect(dueDateInput.value).toBe('2026-07-14');

    vi.useRealTimers();
  });

  it('closes the form without saving when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <FollowUpTimingCard contactId={CONTACT_ID} contactName="Sarah Lee" suggestion={SUGGESTION} />,
    );

    await user.click(screen.getByTestId(`followup-timing-schedule-${CONTACT_ID}`));
    await waitFor(() => {
      expect(screen.getByTestId(`followup-timing-schedule-form-${CONTACT_ID}`)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(
      screen.queryByTestId(`followup-timing-schedule-form-${CONTACT_ID}`),
    ).not.toBeInTheDocument();
  });
});
