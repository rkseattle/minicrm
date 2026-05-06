/**
 * TagInput — interactive tag editor for record detail pages (MINCRM-186).
 * Supports typing to create or search existing tags, Enter/comma to confirm,
 * and × to remove attached tags.
 * Respects tags_restrict_creation setting: reps cannot create new tags inline
 * when restriction is enabled (MINCRM-263).
 */

import { useState, useRef, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import TagBadge from './TagBadge.js';
import { ALL_TAGS_QUERY_KEY, TAGS_QUERY_KEY } from '@/api/tags.js';
import { getTagsRestrictCreation, TAGS_RESTRICT_CREATION_QUERY_KEY } from '@/api/settings.js';
import { useAuth } from '@/hooks/useAuth.js';
import type { TagResponse } from '@shared/schemas/tagSchema.js';

interface TagInputProps {
  /** UUID of the record this input manages tags for */
  entityId: string;
  /** Entity type — determines which API endpoints are called */
  entityType: 'contact' | 'account' | 'deal';
  /** Current tags attached to the record */
  tags: TagResponse[];
  /** Called when a tag name is confirmed (Enter or comma) */
  onAttach: (name: string) => Promise<void>;
  /** Called when × is clicked on an attached tag */
  onDetach: (tagId: string) => Promise<void>;
  /** Whether attach mutations are in flight */
  isAttaching?: boolean;
  /** Tag IDs currently being detached */
  detachingIds?: Set<string>;
}

/**
 * Combobox-style tag input that lists matching existing tags as suggestions
 * and allows creating new tags by typing and pressing Enter or comma.
 *
 * @param entityId - ID of the owning record (used for test IDs)
 * @param tags - Currently attached tags
 * @param onAttach - Async callback to attach a tag by name
 * @param onDetach - Async callback to detach a tag by ID
 * @param isAttaching - Disable input while an attach is in flight
 * @param detachingIds - Set of tag IDs whose remove buttons are disabled
 */
export default function TagInput({
  entityId,
  tags,
  onAttach,
  onDetach,
  isAttaching = false,
  detachingIds = new Set(),
}: TagInputProps) {
  const { t } = useTranslation();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const { user } = useAuth();

  const { data: restrictData } = useQuery({
    queryKey: TAGS_RESTRICT_CREATION_QUERY_KEY,
    queryFn: getTagsRestrictCreation,
    staleTime: 60_000,
  });

  // When restriction is enabled, rep-role users cannot create new tags inline.
  const creationBlocked = (restrictData?.restricted ?? false) && user?.role === 'rep';

  const { data: allTagsData } = useQuery({
    queryKey: ALL_TAGS_QUERY_KEY,
    queryFn: async () => {
      const { listAllTags } = await import('@/api/tags.js');
      return listAllTags();
    },
    staleTime: 60_000,
  });

  const allTags = allTagsData?.tags ?? [];
  const attachedIds = new Set(tags.map((t) => t.id));
  const trimmed = inputValue.trim().toLowerCase();

  const suggestions = trimmed
    ? allTags.filter((t) => t.name.includes(trimmed) && !attachedIds.has(t.id))
    : [];

  // True when the user has typed something that matches no existing unattached tag.
  const noMatchFound = trimmed.length > 0 && suggestions.length === 0;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  async function confirmInput(value: string) {
    const name = value.trim().toLowerCase();
    if (!name) return;
    // When creation is blocked for reps and the typed value doesn't match an
    // existing tag, silently no-op — the "tag not found" hint is shown in the UI.
    if (creationBlocked && !allTags.some((tag) => tag.name === name)) return;
    setInputValue('');
    setIsOpen(false);
    await onAttach(name);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmInput(inputValue);
    } else if (event.key === ',') {
      event.preventDefault();
      void confirmInput(inputValue);
    } else if (event.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      const lastTag = tags[tags.length - 1];
      void onDetach(lastTag.id);
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(event.target.value);
    setIsOpen(event.target.value.trim().length > 0);
  }

  async function handleSuggestionClick(tag: TagResponse) {
    setInputValue('');
    setIsOpen(false);
    await onAttach(tag.name);
  }

  return (
    <div ref={containerRef} className="relative" data-testid={`tag-input-container-${entityId}`}>
      {/* Attached tag badges */}
      <div className="flex flex-wrap gap-1.5 mb-2" data-testid={`tag-list-${entityId}`}>
        {tags.map((tag) => (
          <TagBadge
            key={tag.id}
            tag={tag}
            onRemove={onDetach}
            removing={detachingIds.has(tag.id)}
          />
        ))}
      </div>

      {/* Text input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={t('tags.inputLabel')}
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          data-testid={`tag-input-${entityId}`}
          value={inputValue}
          disabled={isAttaching}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={t('tags.inputPlaceholder')}
          className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:opacity-60"
        />

        {/* Suggestion dropdown */}
        {isOpen && suggestions.length > 0 && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={t('tags.suggestionsLabel')}
            data-testid={`tag-suggestions-${entityId}`}
            className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          >
            {suggestions.map((tag) => (
              <li
                key={tag.id}
                role="option"
                aria-selected={false}
                data-testid={`tag-suggestion-${tag.id}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  void handleSuggestionClick(tag);
                }}
                className="cursor-pointer px-3 py-1.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
              >
                {tag.name}
              </li>
            ))}
          </ul>
        )}

        {/* "Tag not found" hint shown to reps when creation is blocked and no match */}
        {isOpen && creationBlocked && noMatchFound && (
          <p
            className="mt-1 text-sm text-gray-500"
            data-testid={`tag-creation-blocked-${entityId}`}
          >
            {t('tags.tagNotFound')}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Connected TagInput ─────────────────────────────────────────────────────────

/**
 * Props for ConnectedTagInput — wraps TagInput with its own mutations.
 */
interface ConnectedTagInputProps {
  entityId: string;
  entityType: 'contact' | 'account' | 'deal';
  /** React Query key to invalidate after attach/detach */
  entityQueryKey: readonly unknown[];
}

/**
 * TagInput connected to its own React Query mutations.
 * Fetches the entity's current tags and manages attach/detach internally.
 * Use this in detail pages.
 *
 * @param entityId - UUID of the record
 * @param entityType - 'contact' | 'account' | 'deal'
 * @param entityQueryKey - Query key to invalidate after mutations
 */
export function ConnectedTagInput({
  entityId,
  entityType,
  entityQueryKey,
}: ConnectedTagInputProps) {
  const queryClient = useQueryClient();
  const detachingIdsRef = useRef(new Set<string>());
  const [detachingIds, setDetachingIds] = useState<Set<string>>(new Set());

  const tagsQueryKey = [entityType, entityId, 'tags'] as const;

  const { data } = useQuery({
    queryKey: tagsQueryKey,
    queryFn: async () => {
      if (entityType === 'contact') {
        const { listContactTags } = await import('@/api/tags.js');
        return listContactTags(entityId);
      }
      if (entityType === 'account') {
        const { listAccountTags } = await import('@/api/tags.js');
        return listAccountTags(entityId);
      }
      const { listDealTags } = await import('@/api/tags.js');
      return listDealTags(entityId);
    },
  });

  const tags = data?.tags ?? [];

  const attachMutation = useMutation({
    mutationFn: async (name: string) => {
      if (entityType === 'contact') {
        const { attachContactTag } = await import('@/api/tags.js');
        return attachContactTag(entityId, name);
      }
      if (entityType === 'account') {
        const { attachAccountTag } = await import('@/api/tags.js');
        return attachAccountTag(entityId, name);
      }
      const { attachDealTag } = await import('@/api/tags.js');
      return attachDealTag(entityId, name);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagsQueryKey });
      void queryClient.invalidateQueries({ queryKey: entityQueryKey });
      void queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ALL_TAGS_QUERY_KEY });
    },
  });

  const detachMutation = useMutation({
    mutationFn: async (tagId: string) => {
      if (entityType === 'contact') {
        const { detachContactTag } = await import('@/api/tags.js');
        return detachContactTag(entityId, tagId);
      }
      if (entityType === 'account') {
        const { detachAccountTag } = await import('@/api/tags.js');
        return detachAccountTag(entityId, tagId);
      }
      const { detachDealTag } = await import('@/api/tags.js');
      return detachDealTag(entityId, tagId);
    },
    onMutate: async (tagId: string) => {
      await queryClient.cancelQueries({ queryKey: tagsQueryKey });
      const previous = queryClient.getQueryData<{ tags: TagResponse[] }>(tagsQueryKey);
      queryClient.setQueryData<{ tags: TagResponse[] }>(tagsQueryKey, (old) => ({
        tags: (old?.tags ?? []).filter((t) => t.id !== tagId),
      }));
      return { previous };
    },
    onSuccess: (_data, tagId) => {
      detachingIdsRef.current.delete(tagId);
      setDetachingIds(new Set(detachingIdsRef.current));
      void queryClient.invalidateQueries({ queryKey: tagsQueryKey });
      void queryClient.invalidateQueries({ queryKey: entityQueryKey });
    },
    onError: (_err, tagId, context) => {
      detachingIdsRef.current.delete(tagId);
      setDetachingIds(new Set(detachingIdsRef.current));
      if (context?.previous) {
        queryClient.setQueryData(tagsQueryKey, context.previous);
      }
    },
  });

  async function handleAttach(name: string) {
    await attachMutation.mutateAsync(name);
  }

  async function handleDetach(tagId: string) {
    detachingIdsRef.current.add(tagId);
    setDetachingIds(new Set(detachingIdsRef.current));
    await detachMutation.mutateAsync(tagId);
  }

  return (
    <TagInput
      entityId={entityId}
      entityType={entityType}
      tags={tags}
      onAttach={handleAttach}
      onDetach={handleDetach}
      isAttaching={attachMutation.isPending}
      detachingIds={detachingIds}
    />
  );
}
