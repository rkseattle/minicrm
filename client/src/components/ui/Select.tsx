/**
 * Shared select component styled to match the Input component.
 */

import type { SelectHTMLAttributes } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Rendered as a <label> above the select */
  label?: string;
}

const SELECT_CLASSES =
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'shadow-sm transition-colors focus:border-transparent focus:outline-none focus:ring-2 ' +
  'focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

/**
 * Styled select with optional label.
 *
 * @param label - Label text rendered above the select
 */
export function Select({ label, id, className = '', children, ...props }: SelectProps) {
  return (
    <div className="flex flex-col gap-1">
      {label !== undefined && (
        <label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <select id={id} className={[SELECT_CLASSES, className].join(' ')} {...props}>
        {children}
      </select>
    </div>
  );
}
