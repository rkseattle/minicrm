/**
 * Asserts a rendered modal dialog keeps Tab inside it: Tab from its last tabbable
 * control is cancelled and lands on its first.
 *
 * Shared because every dialog wired to useFocusTrap proves its wiring the same way.
 */

import { fireEvent } from '@testing-library/react';
import { expect } from 'vitest';
import { tabbable } from 'tabbable';

export function expectTabWrapsInside(dialog: HTMLElement): void {
  // jsdom lays nothing out, so skip the visibility check, as useFocusTrap does under test.
  const stops = tabbable(dialog, { displayCheck: 'none' });
  const firstControl = stops[0];
  const lastControl = stops[stops.length - 1];
  if (!firstControl || !lastControl) throw new Error('The dialog has nothing tabbable.');
  lastControl.focus();

  // A one-control dialog wraps onto itself, so the cancelled Tab is the real proof.
  const notCancelled = fireEvent.keyDown(lastControl, { key: 'Tab' });

  expect(notCancelled).toBe(false);
  expect(firstControl).toHaveFocus();
}
