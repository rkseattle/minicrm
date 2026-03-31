/**
 * useDebounce — returns a debounced copy of `value` that only updates after
 * `delayMs` milliseconds of inactivity.
 */

import { useState, useEffect } from 'react';

/** Default debounce delay in milliseconds */
const DEFAULT_DELAY_MS = 300;

/**
 * Returns a debounced version of `value` that lags behind by `delayMs`.
 *
 * @param value   - The value to debounce
 * @param delayMs - Milliseconds to wait before updating (default: 300)
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delayMs: number = DEFAULT_DELAY_MS): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
