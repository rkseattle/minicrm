import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from './EmptyState.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';

const ICON = <svg data-testid="test-icon" />;

describe('EmptyState', () => {
  it('renders title and description', () => {
    renderWithProviders(
      <EmptyState icon={ICON} title="No items" description="Nothing here yet." />,
    );
    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('renders the icon', () => {
    renderWithProviders(
      <EmptyState icon={ICON} title="No items" description="Nothing here yet." />,
    );
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('renders the primary action button when onClick is provided', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    renderWithProviders(
      <EmptyState
        icon={ICON}
        title="No items"
        description="Nothing here yet."
        action={{ label: 'Add item', onClick: handleClick }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Add item' });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders the primary action as a link when to is provided', () => {
    renderWithProviders(
      <EmptyState
        icon={ICON}
        title="No items"
        description="Nothing here yet."
        action={{ label: 'Go somewhere', to: '/some-path' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Go somewhere' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/some-path');
  });

  it('renders a secondary action button', async () => {
    const user = userEvent.setup();
    const handleSecondary = vi.fn();
    renderWithProviders(
      <EmptyState
        icon={ICON}
        title="No items"
        description="Nothing here yet."
        action={{ label: 'Primary', onClick: vi.fn() }}
        secondaryAction={{ label: 'Secondary', onClick: handleSecondary }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Secondary' });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(handleSecondary).toHaveBeenCalledTimes(1);
  });

  it('renders no action buttons when neither action nor secondaryAction is provided', () => {
    renderWithProviders(
      <EmptyState icon={ICON} title="No items" description="Nothing here yet." />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('applies the data-testid attribute to the root element', () => {
    renderWithProviders(
      <EmptyState
        icon={ICON}
        title="No items"
        description="Nothing here yet."
        data-testid="my-empty-state"
      />,
    );
    expect(screen.getByTestId('my-empty-state')).toBeInTheDocument();
  });

  describe('loading state', () => {
    it('is not tested here — EmptyState renders only when not loading (caller responsibility)', () => {
      // Loading/error/empty states are tested in the host page/component tests.
    });
  });
});
