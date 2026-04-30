/**
 * Tests for TagBadge — compact inline tag badge with optional remove button.
 *
 * Verifies:
 * - Renders the tag name
 * - Uses data-testid="tag-badge-{id}"
 * - Renders a remove button when onRemove is provided
 * - Does not render a remove button when onRemove is omitted
 * - Clicking remove calls onRemove with the tag id
 * - Remove button is disabled when removing=true
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../test/renderWithProviders.js';
import TagBadge from './TagBadge.js';

const TAG = { id: 'tag-abc', name: 'enterprise' };

describe('TagBadge', () => {
  it('renders the tag name', () => {
    renderWithProviders(<TagBadge tag={TAG} />);

    expect(screen.getByText('enterprise')).toBeInTheDocument();
  });

  it('uses data-testid based on the tag id', () => {
    renderWithProviders(<TagBadge tag={TAG} />);

    expect(screen.getByTestId('tag-badge-tag-abc')).toBeInTheDocument();
  });

  it('does not render a remove button when onRemove is not provided', () => {
    renderWithProviders(<TagBadge tag={TAG} />);

    expect(screen.queryByTestId('remove-tag-tag-abc')).not.toBeInTheDocument();
  });

  it('renders a remove button when onRemove is provided', () => {
    renderWithProviders(<TagBadge tag={TAG} onRemove={vi.fn()} />);

    expect(screen.getByTestId('remove-tag-tag-abc')).toBeInTheDocument();
  });

  it('calls onRemove with the tag id when the remove button is clicked', () => {
    const onRemove = vi.fn();
    renderWithProviders(<TagBadge tag={TAG} onRemove={onRemove} />);

    fireEvent.click(screen.getByTestId('remove-tag-tag-abc'));

    expect(onRemove).toHaveBeenCalledWith('tag-abc');
  });

  it('disables the remove button when removing=true', () => {
    renderWithProviders(<TagBadge tag={TAG} onRemove={vi.fn()} removing />);

    expect(screen.getByTestId('remove-tag-tag-abc')).toBeDisabled();
  });

  it('remove button is enabled when removing=false', () => {
    renderWithProviders(<TagBadge tag={TAG} onRemove={vi.fn()} removing={false} />);

    expect(screen.getByTestId('remove-tag-tag-abc')).not.toBeDisabled();
  });
});
