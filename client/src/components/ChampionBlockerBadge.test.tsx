/**
 * Tests for the ChampionBlockerBadge component. (MINCRM-466)
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ChampionBlockerBadge from './ChampionBlockerBadge.js';

function renderBadge(props: Partial<React.ComponentProps<typeof ChampionBlockerBadge>> = {}) {
  return render(<ChampionBlockerBadge contactId="c1" status="champion" {...props} />);
}

describe('ChampionBlockerBadge', () => {
  it('renders nothing for the default neutral, non-overridden state', () => {
    const { container } = renderBadge({ status: 'neutral' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the badge for a neutral override (rep manually set it)', () => {
    renderBadge({ status: 'neutral', isOverridden: true });
    expect(screen.getByTestId('champion-blocker-badge-c1')).toBeInTheDocument();
  });

  it('renders the champion label', () => {
    renderBadge({ status: 'champion' });
    expect(screen.getByTestId('champion-blocker-badge-c1')).toHaveTextContent('Champion');
  });

  it('renders the blocker label', () => {
    renderBadge({ status: 'blocker' });
    expect(screen.getByTestId('champion-blocker-badge-c1')).toHaveTextContent('Blocker');
  });

  it('does not render a Why? button when there are no recent signals', () => {
    renderBadge({ status: 'champion', recentSignals: [] });
    expect(screen.queryByTestId('champion-blocker-why-c1')).not.toBeInTheDocument();
  });

  it('shows the AI-inferred panel with recent signals when Why? is clicked', async () => {
    const user = userEvent.setup();
    renderBadge({
      status: 'likely_champion',
      recentSignals: [
        {
          description: 'Mentioned sharing proposal with VP Finance',
          detected_at: '2026-06-28T00:00:00.000Z',
        },
      ],
    });

    expect(screen.queryByTestId('champion-blocker-why-panel-c1')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('champion-blocker-why-c1'));

    expect(screen.getByTestId('champion-blocker-why-panel-c1')).toBeInTheDocument();
    expect(screen.getByText(/VP Finance/)).toBeInTheDocument();
    expect(screen.getByText('AI-inferred, not factual')).toBeInTheDocument();
  });

  it('calls onDismiss when the Not accurate link is clicked', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderBadge({ status: 'champion', onDismiss });

    await user.click(screen.getByTestId('champion-blocker-dismiss-c1'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render the dismiss link when onDismiss is not provided', () => {
    renderBadge({ status: 'champion' });
    expect(screen.queryByTestId('champion-blocker-dismiss-c1')).not.toBeInTheDocument();
  });
});
