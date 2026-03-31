/**
 * Hook that calls a handler when a mousedown event occurs outside the given element.
 */

import { useEffect } from 'react';

/**
 * Attaches a mousedown listener to the document and fires the handler
 * whenever a click originates outside the referenced element.
 *
 * @param ref - Ref pointing to the element to watch.
 * @param handler - Callback invoked on an outside click.
 */
export function useOnClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: (event: MouseEvent) => void,
): void {
  useEffect(() => {
    function listener(event: MouseEvent): void {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler(event);
    }

    document.addEventListener('mousedown', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
    };
  }, [ref, handler]);
}
