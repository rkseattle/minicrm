/**
 * Shared text input component with label and error state support.
 */

import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Rendered as a <label> above the input */
  label?: string;
  /** Error message rendered below the input */
  error?: string;
}

const BASE_INPUT_CLASSES =
  'block w-full rounded-md border px-3 py-2 text-sm text-gray-900 shadow-sm ' +
  'transition-colors focus:outline-none focus:ring-2 focus:border-transparent ' +
  'placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

/**
 * Styled text input with optional label and error message.
 *
 * @param label - Label text rendered above the input
 * @param error - Error message rendered below the input
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className = '', ...props },
  ref,
) {
  const inputClasses = [
    BASE_INPUT_CLASSES,
    error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-indigo-500',
    className,
  ].join(' ');

  return (
    <div className="flex flex-col gap-1">
      {label !== undefined && (
        <label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <input ref={ref} id={id} className={inputClasses} {...props} />
      {error !== undefined && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
});
