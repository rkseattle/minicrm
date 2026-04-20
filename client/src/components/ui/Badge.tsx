/**
 * Pill badge for status and categorical labels.
 */

import type { ReactNode, HTMLAttributes } from 'react';

/** Visual variant controlling the color scheme */
type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral';

export interface BadgeProps {
  /** Color variant — defaults to neutral */
  variant?: BadgeVariant;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  error: 'bg-red-50 text-red-700 ring-red-600/20',
  neutral: 'bg-gray-100 text-gray-600 ring-gray-500/10',
};

/**
 * Small colored pill for displaying status labels.
 *
 * @param variant - Color scheme (default: neutral)
 */
export function Badge({
  variant = 'neutral',
  children,
  ...rest
}: BadgeProps & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap shrink-0',
        VARIANT_CLASSES[variant],
      ].join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}
