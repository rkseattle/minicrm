/**
 * Tests for the TagInput component (MINCRM-186, MINCRM-263).
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import TagInput from './TagInput.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import type { TagResponse } from '@shared/schemas/tagSchema.js';
import { REP_USER } from '../test/msw/handlers.js';

const TAG_1: TagResponse = {
  id: 'tag-uuid-1',
  name: 'enterprise',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

const TAG_2: TagResponse = {
  id: 'tag-uuid-2',
  name: 'priority',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

const ENTITY_ID = 'entity-abc';

function makeProps(overrides: Partial<Parameters<typeof TagInput>[0]> = {}) {
  return {
    entityId: ENTITY_ID,
    entityType: 'contact' as const,
    tags: [],
    onAttach: vi.fn().mockResolvedValue(undefined),
    onDetach: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('TagInput', () => {
  it('renders the text input', async () => {
    renderWithProviders(<TagInput {...makeProps()} />);
    expect(screen.getByTestId(`tag-input-${ENTITY_ID}`)).toBeInTheDocument();
  });

  it('renders attached tag badges', async () => {
    renderWithProviders(<TagInput {...makeProps({ tags: [TAG_1, TAG_2] })} />);
    expect(screen.getByTestId(`tag-badge-${TAG_1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`tag-badge-${TAG_2.id}`)).toBeInTheDocument();
  });

  it('renders remove buttons for attached tags', async () => {
    renderWithProviders(<TagInput {...makeProps({ tags: [TAG_1] })} />);
    expect(screen.getByTestId(`remove-tag-${TAG_1.id}`)).toBeInTheDocument();
  });

  it('calls onDetach when remove button is clicked', async () => {
    const onDetach = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TagInput {...makeProps({ tags: [TAG_1], onDetach })} />);
    await userEvent.click(screen.getByTestId(`remove-tag-${TAG_1.id}`));
    expect(onDetach).toHaveBeenCalledWith(TAG_1.id);
  });

  it('calls onAttach when Enter is pressed with a value', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TagInput {...makeProps({ onAttach })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'newtag');
    await userEvent.keyboard('{Enter}');
    expect(onAttach).toHaveBeenCalledWith('newtag');
  });

  it('calls onAttach when comma is pressed with a value', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TagInput {...makeProps({ onAttach })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'newtag,');
    expect(onAttach).toHaveBeenCalledWith('newtag');
  });

  it('clears input after Enter confirmation', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TagInput {...makeProps({ onAttach })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'newtag');
    await userEvent.keyboard('{Enter}');
    expect(input).toHaveValue('');
  });

  it('calls onDetach for last tag on Backspace when input is empty', async () => {
    const onDetach = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TagInput {...makeProps({ tags: [TAG_1, TAG_2], onDetach })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onDetach).toHaveBeenCalledWith(TAG_2.id);
  });

  it('does not call onAttach when Enter is pressed with empty input', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TagInput {...makeProps({ onAttach })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}');
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('disables the input when isAttaching is true', async () => {
    renderWithProviders(<TagInput {...makeProps({ isAttaching: true })} />);
    expect(screen.getByTestId(`tag-input-${ENTITY_ID}`)).toBeDisabled();
  });

  it('disables the remove button for a tag being detached', async () => {
    const detachingIds = new Set([TAG_1.id]);
    renderWithProviders(<TagInput {...makeProps({ tags: [TAG_1], detachingIds })} />);
    expect(screen.getByTestId(`remove-tag-${TAG_1.id}`)).toBeDisabled();
  });

  it('shows tag suggestions when typing a matching prefix', async () => {
    server.use(http.get('/api/v1/tags', () => HttpResponse.json({ tags: [TAG_1, TAG_2] })));
    renderWithProviders(<TagInput {...makeProps()} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'ent');
    await waitFor(() => {
      expect(screen.getByTestId(`tag-suggestions-${ENTITY_ID}`)).toBeInTheDocument();
      expect(screen.getByTestId(`tag-suggestion-${TAG_1.id}`)).toBeInTheDocument();
    });
  });

  it('does not show already-attached tags in suggestions', async () => {
    server.use(http.get('/api/v1/tags', () => HttpResponse.json({ tags: [TAG_1, TAG_2] })));
    renderWithProviders(<TagInput {...makeProps({ tags: [TAG_1] })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'ent');
    await waitFor(() => {
      expect(screen.queryByTestId(`tag-suggestion-${TAG_1.id}`)).not.toBeInTheDocument();
    });
  });

  it('calls onAttach when a suggestion is clicked', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    server.use(http.get('/api/v1/tags', () => HttpResponse.json({ tags: [TAG_1] })));
    renderWithProviders(<TagInput {...makeProps({ onAttach })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'ent');
    await waitFor(() => {
      expect(screen.getByTestId(`tag-suggestion-${TAG_1.id}`)).toBeInTheDocument();
    });
    fireEvent.pointerDown(screen.getByTestId(`tag-suggestion-${TAG_1.id}`));
    expect(onAttach).toHaveBeenCalledWith(TAG_1.name);
  });
});

// ── Tag creation restriction (MINCRM-263) ─────────────────────────────────────

describe('TagInput — rep with restriction enabled', () => {
  beforeEach(() => {
    // Override auth to return a rep user and restriction to true
    server.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })),
      http.get('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ restricted: true }),
      ),
      http.get('/api/v1/tags', () => HttpResponse.json({ tags: [TAG_1] })),
    );
  });

  it('does not call onAttach when Enter is pressed with a non-matching value', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TagInput {...makeProps({ onAttach })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'brandnewtag');
    await userEvent.keyboard('{Enter}');
    expect(onAttach).not.toHaveBeenCalled();
  });

  it('shows tag-creation-blocked hint when typing a non-matching value', async () => {
    renderWithProviders(<TagInput {...makeProps()} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'brandnewtag');
    await waitFor(() => {
      expect(screen.getByTestId(`tag-creation-blocked-${ENTITY_ID}`)).toBeInTheDocument();
    });
  });

  it('still calls onAttach when selecting an existing tag suggestion', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TagInput {...makeProps({ onAttach })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'ent');
    await waitFor(() => {
      expect(screen.getByTestId(`tag-suggestion-${TAG_1.id}`)).toBeInTheDocument();
    });
    fireEvent.pointerDown(screen.getByTestId(`tag-suggestion-${TAG_1.id}`));
    expect(onAttach).toHaveBeenCalledWith(TAG_1.name);
  });
});

describe('TagInput — admin with restriction enabled', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ restricted: true }),
      ),
      http.get('/api/v1/tags', () => HttpResponse.json({ tags: [] })),
    );
    // Default /api/auth/me handler returns ADMIN_USER
  });

  it('calls onAttach when Enter is pressed (admin is never blocked)', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TagInput {...makeProps({ onAttach })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'newtag');
    await userEvent.keyboard('{Enter}');
    expect(onAttach).toHaveBeenCalledWith('newtag');
  });

  it('does not show tag-creation-blocked hint for admins', async () => {
    renderWithProviders(<TagInput {...makeProps()} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'brandnewtag');
    // Small wait to let the query settle
    await waitFor(() => {
      expect(screen.getByTestId(`tag-input-${ENTITY_ID}`)).toHaveValue('brandnewtag');
    });
    expect(screen.queryByTestId(`tag-creation-blocked-${ENTITY_ID}`)).not.toBeInTheDocument();
  });
});
