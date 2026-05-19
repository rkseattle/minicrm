/**
 * Shared empty-state component used across all list and detail pages. (MINCRM-380)
 *
 * Renders centred in its container: icon → title → description → action button(s).
 * The icon is muted and typography is subdued so it reads as informational, not an error.
 */

import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';

interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  to?: string;
}

export interface EmptyStateProps {
  /** Lucide icon or inline SVG illustration — rendered above the title */
  icon: React.ReactNode;
  /** Short headline, e.g. "No contacts yet" */
  title: string;
  /** One sentence explaining what belongs here */
  description: string;
  /** Primary call-to-action button */
  action?: EmptyStateAction;
  /** Secondary call-to-action button */
  secondaryAction?: EmptyStateAction;
  /** data-testid placed on the root element */
  'data-testid'?: string;
}

/**
 * Renders an action button or link based on the provided action props.
 *
 * @param action - Action config (label + onClick or to)
 * @param variant - Button visual style
 */
function ActionButton({
  action,
  variant,
}: {
  action: EmptyStateAction;
  variant: 'primary' | 'secondary';
}) {
  if (action.to) {
    return (
      <Link to={action.to}>
        <Button variant={variant} size="sm">
          {action.label}
        </Button>
      </Link>
    );
  }
  return (
    <Button variant={variant} size="sm" onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

/**
 * Shared empty-state presentation component.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  'data-testid': testId,
}: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
      data-testid={testId}
    >
      <div className="mb-4 text-gray-300">{icon}</div>
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{title}</h3>
      <p className="text-sm text-gray-600 max-w-sm mb-6">{description}</p>
      {(action ?? secondaryAction) && (
        <div className="flex items-center gap-3">
          {action && <ActionButton action={action} variant="primary" />}
          {secondaryAction && <ActionButton action={secondaryAction} variant="secondary" />}
        </div>
      )}
    </div>
  );
}
