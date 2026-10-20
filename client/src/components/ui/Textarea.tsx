/**
 * Shared multi-line text input, styled and labelled to match the Input component.
 */

import { forwardRef, useId } from 'react';
import type { TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Rendered as a <label> above the textarea */
  label?: string;
  /** Error message rendered below the textarea */
  error?: string;
}

const BASE_TEXTAREA_CLASSES =
  'block w-full resize-y rounded-md border px-3 py-2 text-sm text-gray-900 shadow-sm ' +
  'transition-colors focus:outline-none focus:ring-2 focus:border-transparent ' +
  'placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

/**
 * Styled textarea with optional label and error message.
 *
 * @param label - Label text rendered above the textarea
 * @param error - Error message rendered below the textarea
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    error,
    id,
    className = '',
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  // The message is announced with the field, not found later by browsing past it.
  const errorId = `${textareaId}-error`;
  const classes = [
    BASE_TEXTAREA_CLASSES,
    error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-primary-500',
    className,
  ].join(' ');

  return (
    <div className="flex flex-col gap-1">
      {label !== undefined && (
        <label htmlFor={textareaId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        className={classes}
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={
          [describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined
        }
        {...props}
      />
      {error && (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
});
