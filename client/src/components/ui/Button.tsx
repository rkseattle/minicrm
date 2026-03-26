/**
 * Shared button component with consistent variants and sizes.
 */

import type { ButtonHTMLAttributes } from 'react';

/** Visual style of the button */
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/** Size of the button */
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style — defaults to primary */
  variant?: ButtonVariant;
  /** Size — defaults to md */
  size?: ButtonSize;
  /** Whether the button should span the full width of its container */
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500 border-transparent',
  secondary: 'bg-white text-gray-700 hover:bg-gray-50 focus:ring-indigo-500 border-gray-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 border-transparent',
  ghost:
    'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:ring-gray-400 border-transparent',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Reusable button with consistent styling.
 *
 * @param variant - Visual style (default: primary)
 * @param size - Button size (default: md)
 * @param fullWidth - Span full container width
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const classes = [
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
