/**
 * Tests for the MeetingBriefPanel component. (MINCRM-465)
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import MeetingBriefPanel from './MeetingBriefPanel.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import type { MeetingBriefResponse } from '@shared/schemas/meetingBriefSchema.js';

const SAMPLE_BRIEF: MeetingBriefResponse = {
  activity_id: 'a1',
  brief: {
    contact_snapshot: {
      name: 'Jane Doe',
      title: 'VP Sales',
      company: 'Acme',
      contact_since: '2025-01-01T00:00:00.000Z',
      last_interaction_at: null,
    },
    account_summary: 'Growing account, strong engagement.',
    open_opportunities: [
      {
        deal_id: 'd1',
        name: 'Acme Renewal',
        stage: 'Proposal',
        value: '25000',
        currency: 'USD',
        days_in_current_stage: 5,
        next_step: 'Send updated proposal.',
      },
    ],
    recent_activity_summary: ['Discussed renewal pricing.'],
    suggested_talking_points: ['Confirm budget owner.', 'Review contract terms.'],
    known_objections: ['Price'],
  },
  generated_by: 'u1',
  generated_at: '2026-07-01T00:00:00.000Z',
};

function renderPanel(props: Partial<React.ComponentProps<typeof MeetingBriefPanel>> = {}) {
  return renderWithProviders(
    <MeetingBriefPanel
      brief={SAMPLE_BRIEF}
      onDismiss={vi.fn()}
      onRegenerate={vi.fn()}
      isRegenerating={false}
      {...props}
    />,
  );
}

describe('MeetingBriefPanel', () => {
  it('renders the contact snapshot and account summary', async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('meeting-brief-panel')).toBeInTheDocument();
    });
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('VP Sales')).toBeInTheDocument();
    expect(screen.getByText('Growing account, strong engagement.')).toBeInTheDocument();
  });

  it('renders open opportunities with their next step', () => {
    renderPanel();

    expect(screen.getByTestId('meeting-brief-opportunities')).toBeInTheDocument();
    expect(screen.getByText(/Acme Renewal/)).toBeInTheDocument();
    expect(screen.getByText('Send updated proposal.')).toBeInTheDocument();
  });

  it('renders suggested talking points', () => {
    renderPanel();

    const talkingPoints = screen.getByTestId('meeting-brief-talking-points');
    expect(talkingPoints).toHaveTextContent('Confirm budget owner.');
    expect(talkingPoints).toHaveTextContent('Review contract terms.');
  });

  it('does not render a follow-up timing section when no suggestion is present', () => {
    renderPanel();
    expect(screen.queryByTestId('meeting-brief-followup-timing')).not.toBeInTheDocument();
  });

  it('renders the follow-up timing suggestion when present (MINCRM-470)', () => {
    renderPanel({
      brief: {
        ...SAMPLE_BRIEF,
        brief: {
          ...SAMPLE_BRIEF.brief,
          followup_timing: {
            contact_id: 'c1',
            day_of_week: 2,
            hour_start: 9,
            hour_end: 11,
            timezone: 'UTC',
            sample_size: 6,
            computed_at: '2026-07-01T00:00:00.000Z',
          },
        },
      },
    });

    const timing = screen.getByTestId('meeting-brief-followup-timing');
    expect(timing).toHaveTextContent('Jane Doe');
    expect(timing).toHaveTextContent('Tuesdays');
  });

  it('renders a news hook item when present', () => {
    renderPanel({
      brief: {
        ...SAMPLE_BRIEF,
        brief: {
          ...SAMPLE_BRIEF.brief,
          news_hook: [
            {
              title: 'Acme raises Series B',
              url: 'https://news.example.com/a',
              source: 'news.example.com',
              published_at: '2 days ago',
            },
          ],
        },
      },
    });

    expect(screen.getByTestId('meeting-brief-news-item-0')).toHaveTextContent(
      'Acme raises Series B',
    );
  });

  it('copies the brief to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderPanel();

    await user.click(screen.getByTestId('meeting-brief-copy-button'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Jane Doe'));
    });
    expect(screen.getByTestId('meeting-brief-copy-button')).toHaveTextContent('Copied');
  });

  it('shows a clipboard error when copying fails', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });

    renderPanel();

    await user.click(screen.getByTestId('meeting-brief-copy-button'));

    await waitFor(() => {
      expect(screen.getByTestId('meeting-brief-copy-error')).toBeInTheDocument();
    });
  });

  it('calls onRegenerate when the regenerate button is clicked', async () => {
    const user = userEvent.setup();
    const handleRegenerate = vi.fn();
    renderPanel({ onRegenerate: handleRegenerate });

    await user.click(screen.getByTestId('meeting-brief-regenerate-button'));
    expect(handleRegenerate).toHaveBeenCalledOnce();
  });

  it('disables the regenerate button while regenerating', () => {
    renderPanel({ isRegenerating: true });

    expect(screen.getByTestId('meeting-brief-regenerate-button')).toBeDisabled();
    expect(screen.getByTestId('meeting-brief-regenerate-button')).toHaveTextContent('Generating');
  });

  it('calls onDismiss when the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    const handleDismiss = vi.fn();
    renderPanel({ onDismiss: handleDismiss });

    await user.click(screen.getByTestId('meeting-brief-dismiss'));
    expect(handleDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss on Escape key', async () => {
    const handleDismiss = vi.fn();
    renderPanel({ onDismiss: handleDismiss });

    const panel = await screen.findByTestId('meeting-brief-panel');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(handleDismiss).toHaveBeenCalledOnce();
  });

  it('opens window.print when the print button is clicked', async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    renderPanel();

    await user.click(screen.getByTestId('meeting-brief-print-button'));
    expect(printSpy).toHaveBeenCalledOnce();

    printSpy.mockRestore();
  });
});
