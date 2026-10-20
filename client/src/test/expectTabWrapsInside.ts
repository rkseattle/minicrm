/**
 * Asserts a rendered modal dialog keeps Tab inside it: Tab from its last tabbable
 * control is cancelled and lands on its first.
 *
 * Shared because every dialog wired to useFocusTrap proves its wiring the same way.
 */

import { fireEvent } from '@testing-library/react';
import { expect } from 'vitest';
import { tabbableElements } from '@/utils/focusTrap.js';

export function expectTabWrapsInside(dialog: HTMLElement): void {
  const tabbable = tabbableElements(dialog);
  const firstControl = tabbable[0];
  const lastControl = tabbable[tabbable.length - 1];
  if (!firstControl || !lastControl) throw new Error('The dialog has nothing tabbable.');
  lastControl.focus();

  // A one-control dialog wraps onto itself, so the cancelled Tab is the real proof.
  const notCancelled = fireEvent.keyDown(lastControl, { key: 'Tab' });

  expect(notCancelled).toBe(false);
  expect(firstControl).toHaveFocus();
}
