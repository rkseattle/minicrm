/**
 * Tests for the TagInput component.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import TagInput, { ConnectedTagInput } from './TagInput.js';
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
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1, TAG_2], total: 2, page: 1, limit: 1000 }),
      ),
    );
    renderWithProviders(<TagInput {...makeProps()} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'ent');
    await waitFor(() => {
      expect(screen.getByTestId(`tag-suggestions-${ENTITY_ID}`)).toBeInTheDocument();
      expect(screen.getByTestId(`tag-suggestion-${TAG_1.id}`)).toBeInTheDocument();
    });
  });

  it('does not show already-attached tags in suggestions', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1, TAG_2], total: 2, page: 1, limit: 1000 }),
      ),
    );
    renderWithProviders(<TagInput {...makeProps({ tags: [TAG_1] })} />);
    const input = screen.getByTestId(`tag-input-${ENTITY_ID}`);
    await userEvent.type(input, 'ent');
    await waitFor(() => {
      expect(screen.queryByTestId(`tag-suggestion-${TAG_1.id}`)).not.toBeInTheDocument();
    });
  });

  it('calls onAttach when a suggestion is clicked', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1], total: 1, page: 1, limit: 1000 }),
      ),
    );
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

// ── Tag creation restriction ─────────────────────────────────────

describe('TagInput — rep with restriction enabled', () => {
  beforeEach(() => {
    // Override auth to return a rep user and restriction to true
    server.use(
      http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })),
      http.get('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ restricted: true }),
      ),
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1], total: 1, page: 1, limit: 1000 }),
      ),
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
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 1000 }),
      ),
    );
    // Default /api/v1/auth/me handler returns ADMIN_USER
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

// ── ConnectedTagInput — entity type routing ────────────────────────────────────

const CONNECTED_ID = '00000000-0000-0000-0000-000000000099';
const ENTITY_QUERY_KEY = ['contact', CONNECTED_ID] as const;

const EXISTING_TAG: TagResponse = {
  id: 'tag-uuid-existing',
  name: 'vip',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

describe('ConnectedTagInput — contact entity type', () => {
  it('renders the tag input for a contact', async () => {
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="contact"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId(`tag-input-${CONNECTED_ID}`)).toBeInTheDocument();
    });
  });

  it('loads and displays tags from the contacts endpoint', async () => {
    server.use(
      http.get(`/api/v1/contacts/${CONNECTED_ID}/tags`, () =>
        HttpResponse.json({ tags: [EXISTING_TAG] }),
      ),
    );
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="contact"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId(`tag-badge-${EXISTING_TAG.id}`)).toBeInTheDocument();
    });
  });

  it('attaches a tag via the contact attach endpoint', async () => {
    let attachCalled = false;
    server.use(
      http.post(`/api/v1/contacts/${CONNECTED_ID}/tags`, () => {
        attachCalled = true;
        return HttpResponse.json({ tag: EXISTING_TAG });
      }),
    );
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="contact"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`tag-input-${CONNECTED_ID}`)).toBeInTheDocument(),
    );
    const input = screen.getByTestId(`tag-input-${CONNECTED_ID}`);
    await userEvent.type(input, 'newtag');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(attachCalled).toBe(true));
  });

  it('shows the badge when the attach resolves before the first tag list does', async () => {
    // The ordering the E2E hit on mobile-web, controlled here rather than raced: the
    // input is interactive while the initial GET is open, so a POST can land first. An
    // invalidate would join that pending GET instead of restarting it, and its empty
    // pre-attach body would then settle the query as fresh with the new tag missing.
    let releaseInitialGet: (() => void) | undefined;
    const initialGetHeld = new Promise<void>((resolve) => {
      releaseInitialGet = resolve;
    });

    server.use(
      http.get(`/api/v1/contacts/${CONNECTED_ID}/tags`, async () => {
        await initialGetHeld;
        return HttpResponse.json({ tags: [] });
      }),
      http.post(`/api/v1/contacts/${CONNECTED_ID}/tags`, () =>
        HttpResponse.json({ tag: EXISTING_TAG }),
      ),
    );

    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="contact"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId(`tag-input-${CONNECTED_ID}`)).toBeInTheDocument(),
    );
    await userEvent.type(screen.getByTestId(`tag-input-${CONNECTED_ID}`), EXISTING_TAG.name);
    await userEvent.keyboard('{Enter}');

    // Only now does the pre-attach list answer, with the tag absent.
    releaseInitialGet?.();

    expect(await screen.findByTestId(`tag-badge-${EXISTING_TAG.id}`)).toBeInTheDocument();
  });

  it('restores the tag list when an attach fired during the initial load fails', async () => {
    // onMutate cancels the list's own fetch. Only the success path re-seeds it, so a
    // failed attach would otherwise leave the tags the user already had hidden.
    let releaseInitialGet: (() => void) | undefined;
    const initialGetHeld = new Promise<void>((resolve) => {
      releaseInitialGet = resolve;
    });
    let getCalls = 0;

    server.use(
      http.get(`/api/v1/contacts/${CONNECTED_ID}/tags`, async () => {
        getCalls += 1;
        if (getCalls === 1) await initialGetHeld;
        return HttpResponse.json({ tags: [EXISTING_TAG] });
      }),
      http.post(
        `/api/v1/contacts/${CONNECTED_ID}/tags`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="contact"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId(`tag-input-${CONNECTED_ID}`)).toBeInTheDocument(),
    );
    await userEvent.type(screen.getByTestId(`tag-input-${CONNECTED_ID}`), 'doomed');
    await userEvent.keyboard('{Enter}');
    releaseInitialGet?.();

    // The attach failed, but the tags that were already on the contact must come back.
    expect(await screen.findByTestId(`tag-badge-${EXISTING_TAG.id}`)).toBeInTheDocument();
  });

  it('detaches a tag via the contact detach endpoint', async () => {
    let detachCalled = false;
    server.use(
      http.get(`/api/v1/contacts/${CONNECTED_ID}/tags`, () =>
        HttpResponse.json({ tags: [EXISTING_TAG] }),
      ),
      http.delete(`/api/v1/contacts/${CONNECTED_ID}/tags/${EXISTING_TAG.id}`, () => {
        detachCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="contact"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`remove-tag-${EXISTING_TAG.id}`)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByTestId(`remove-tag-${EXISTING_TAG.id}`));
    await waitFor(() => expect(detachCalled).toBe(true));
  });
});

describe('ConnectedTagInput — account entity type', () => {
  it('renders the tag input for an account', async () => {
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="account"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId(`tag-input-${CONNECTED_ID}`)).toBeInTheDocument();
    });
  });

  it('attaches a tag via the account attach endpoint', async () => {
    let attachCalled = false;
    server.use(
      http.post(`/api/v1/accounts/${CONNECTED_ID}/tags`, () => {
        attachCalled = true;
        return HttpResponse.json({ tag: EXISTING_TAG });
      }),
    );
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="account"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`tag-input-${CONNECTED_ID}`)).toBeInTheDocument(),
    );
    const input = screen.getByTestId(`tag-input-${CONNECTED_ID}`);
    await userEvent.type(input, 'accounttag');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(attachCalled).toBe(true));
  });

  it('detaches a tag via the account detach endpoint', async () => {
    let detachCalled = false;
    server.use(
      http.get(`/api/v1/accounts/${CONNECTED_ID}/tags`, () =>
        HttpResponse.json({ tags: [EXISTING_TAG] }),
      ),
      http.delete(`/api/v1/accounts/${CONNECTED_ID}/tags/${EXISTING_TAG.id}`, () => {
        detachCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="account"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`remove-tag-${EXISTING_TAG.id}`)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByTestId(`remove-tag-${EXISTING_TAG.id}`));
    await waitFor(() => expect(detachCalled).toBe(true));
  });
});

describe('ConnectedTagInput — deal entity type', () => {
  it('renders the tag input for a deal', async () => {
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="deal"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId(`tag-input-${CONNECTED_ID}`)).toBeInTheDocument();
    });
  });

  it('attaches a tag via the deal attach endpoint', async () => {
    let attachCalled = false;
    server.use(
      http.post(`/api/v1/deals/${CONNECTED_ID}/tags`, () => {
        attachCalled = true;
        return HttpResponse.json({ tag: EXISTING_TAG });
      }),
    );
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="deal"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`tag-input-${CONNECTED_ID}`)).toBeInTheDocument(),
    );
    const input = screen.getByTestId(`tag-input-${CONNECTED_ID}`);
    await userEvent.type(input, 'dealtag');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(attachCalled).toBe(true));
  });

  it('detaches a tag via the deal detach endpoint', async () => {
    let detachCalled = false;
    server.use(
      http.get(`/api/v1/deals/${CONNECTED_ID}/tags`, () =>
        HttpResponse.json({ tags: [EXISTING_TAG] }),
      ),
      http.delete(`/api/v1/deals/${CONNECTED_ID}/tags/${EXISTING_TAG.id}`, () => {
        detachCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="deal"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(`remove-tag-${EXISTING_TAG.id}`)).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByTestId(`remove-tag-${EXISTING_TAG.id}`));
    await waitFor(() => expect(detachCalled).toBe(true));
  });
});

describe('ConnectedTagInput — loads tags by entity type', () => {
  it('shows an empty tag list for a deal entity on initial load', async () => {
    renderWithProviders(
      <ConnectedTagInput
        entityId={CONNECTED_ID}
        entityType="deal"
        entityQueryKey={ENTITY_QUERY_KEY}
      />,
    );
    await waitFor(() => {
      // With empty tags, the tag list div should be empty
      expect(screen.getByTestId(`tag-list-${CONNECTED_ID}`)).toBeInTheDocument();
    });
    // No tag badges since the deal has no tags
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});
