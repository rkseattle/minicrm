/**
 * Tests for the AccountHealthBadge component.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import AccountHealthBadge from './AccountHealthBadge.js';

function renderBadge(props: Partial<React.ComponentProps<typeof AccountHealthBadge>> = {}) {
  return render(
    <AccountHealthBadge
      accountId="a1"
      state="healthy"
      singleThreadedRisk={false}
      contributingFactors={[]}
      {...props}
    />,
  );
}

describe('AccountHealthBadge', () => {
  it('renders the strong state label', () => {
    renderBadge({ state: 'strong' });
    expect(screen.getByTestId('account-health-badge-a1')).toHaveTextContent('Strong');
  });

  it('renders the dormant state label', () => {
    renderBadge({ state: 'dormant' });
    expect(screen.getByTestId('account-health-badge-a1')).toHaveTextContent('Dormant');
  });

  it('renders the at_risk state label', () => {
    renderBadge({ state: 'at_risk' });
    expect(screen.getByTestId('account-health-badge-a1')).toHaveTextContent('At Risk');
  });

  it('does not render a single-threaded risk badge by default', () => {
    renderBadge({ singleThreadedRisk: false });
    expect(screen.queryByTestId('account-health-single-threaded-a1')).not.toBeInTheDocument();
  });

  it('renders a single-threaded risk badge when flagged, regardless of overall state', () => {
    renderBadge({ state: 'strong', singleThreadedRisk: true });
    expect(screen.getByTestId('account-health-single-threaded-a1')).toBeInTheDocument();
  });

  it('does not render a Why? button when there are no contributing factors', () => {
    renderBadge({ contributingFactors: [] });
    expect(screen.queryByTestId('account-health-why-a1')).not.toBeInTheDocument();
  });

  it('shows the AI-inferred panel with contributing factors when Why? is clicked', async () => {
    const user = userEvent.setup();
    renderBadge({
      contributingFactors: [
        { description: 'No contact in 45 days' },
        { description: 'Sentiment trend is cooling' },
      ],
    });

    expect(screen.queryByTestId('account-health-why-panel-a1')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('account-health-why-a1'));

    expect(screen.getByTestId('account-health-why-panel-a1')).toBeInTheDocument();
    expect(screen.getByText('No contact in 45 days')).toBeInTheDocument();
    expect(screen.getByText('Sentiment trend is cooling')).toBeInTheDocument();
    expect(screen.getByText('AI-inferred, not factual')).toBeInTheDocument();
  });

  it('shows only the top 3 contributing factors', async () => {
    const user = userEvent.setup();
    renderBadge({
      contributingFactors: [
        { description: 'Factor one' },
        { description: 'Factor two' },
        { description: 'Factor three' },
        { description: 'Factor four' },
      ],
    });

    await user.click(screen.getByTestId('account-health-why-a1'));
    expect(screen.getByText('Factor one')).toBeInTheDocument();
    expect(screen.getByText('Factor three')).toBeInTheDocument();
    expect(screen.queryByText('Factor four')).not.toBeInTheDocument();
  });
});
