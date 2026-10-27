/**
 * Shared select component styled to match the Input component.
 */

import { useId } from 'react';
import type { Ref, SelectHTMLAttributes } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Rendered as a <label> above the select */
  label?: string;
  /** Error message — applies red border and renders message below the select */
  error?: string;
}

const SELECT_BASE_CLASSES =
  'block w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-900 ' +
  'shadow-xs transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-0 ' +
  'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 ' +
  'min-h-[44px] sm:min-h-0';

const SELECT_NORMAL_CLASSES = 'border-gray-300 focus:border-transparent focus:ring-primary-500';
const SELECT_ERROR_CLASSES = 'border-red-500 focus:border-transparent focus:ring-red-500';

/**
 * Styled select with optional label and error state.
 *
 * @param label - Label text rendered above the select
 * @param error - Error message rendered below the select; also applies red-border styling
 */
export function Select({
  ref,
  label,
  error,
  id,
  className = '',
  children,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: SelectProps & { ref?: Ref<HTMLSelectElement> }) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  // The message is announced with the field, not found later by browsing past it.
  const errorId = `${selectId}-error`;
  const stateClasses = error ? SELECT_ERROR_CLASSES : SELECT_NORMAL_CLASSES;

  return (
    <div className="flex flex-col gap-1">
      {label !== undefined && (
        <label htmlFor={selectId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={
          [describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined
        }
        className={[SELECT_BASE_CLASSES, stateClasses, className].filter(Boolean).join(' ')}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
