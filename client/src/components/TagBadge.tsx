/**
 * TagBadge — compact tag label for list view rows.
 * Renders a tag name as an inline badge. When onRemove is provided,
 * renders an × button to detach the tag.
 */

import { useTranslation } from 'react-i18next';

/** Minimal tag shape required by TagBadge — compatible with both TagResponse and embedded list tags */
interface TagLike {
  id: string;
  name: string;
}

interface TagBadgeProps {
  /** The tag to display */
  tag: TagLike;
  /**
   * When provided, renders a remove button that calls this handler.
   * Omit on list views where tags are read-only.
   */
  onRemove?: (tagId: string) => void;
  /** Whether the remove action is in progress */
  removing?: boolean;
}

/**
 * Compact badge displaying a tag name with an optional remove button.
 *
 * @param tag - Tag record to display
 * @param onRemove - Called with the tag ID when × is clicked
 * @param removing - Disables the remove button while the mutation is in flight
 */
export default function TagBadge({ tag, onRemove, removing = false }: TagBadgeProps) {
  const { t } = useTranslation();

  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700 ring-1 ring-inset ring-primary-700/10 whitespace-nowrap shrink-0"
      data-testid={`tag-badge-${tag.id}`}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          aria-label={t('tags.removeTag', { name: tag.name })}
          data-testid={`remove-tag-${tag.id}`}
          disabled={removing}
          onClick={() => onRemove(tag.id)}
          className="ms-0.5 rounded-full p-0.5 text-primary-500 hover:bg-primary-100 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          ×
        </button>
      )}
    </span>
  );
}
