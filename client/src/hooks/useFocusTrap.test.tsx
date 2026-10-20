import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from './useFocusTrap.js';

function Dialog({ active }: { active?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, active);
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} data-testid="dialog">
      <input data-testid="first" />
      <button type="button" data-testid="last">
        last
      </button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('wraps Tab from the last control to the first', () => {
    render(<Dialog />);
    screen.getByTestId('last').focus();

    const notCancelled = fireEvent.keyDown(screen.getByTestId('last'), { key: 'Tab' });

    expect(notCancelled).toBe(false);
    expect(screen.getByTestId('first')).toHaveFocus();
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    render(<Dialog />);
    screen.getByTestId('first').focus();

    fireEvent.keyDown(screen.getByTestId('first'), { key: 'Tab', shiftKey: true });

    expect(screen.getByTestId('last')).toHaveFocus();
  });

  it('wraps Shift+Tab from the focused dialog itself to the last control', () => {
    render(<Dialog />);
    screen.getByTestId('dialog').focus();

    fireEvent.keyDown(screen.getByTestId('dialog'), { key: 'Tab', shiftKey: true });

    expect(screen.getByTestId('last')).toHaveFocus();
  });

  it('does nothing while inactive', () => {
    render(<Dialog active={false} />);
    screen.getByTestId('last').focus();

    const notCancelled = fireEvent.keyDown(screen.getByTestId('last'), { key: 'Tab' });

    expect(notCancelled).toBe(true);
    expect(screen.getByTestId('last')).toHaveFocus();
  });

  it('starts trapping when it becomes active', () => {
    const { rerender } = render(<Dialog active={false} />);
    rerender(<Dialog active />);
    screen.getByTestId('last').focus();

    fireEvent.keyDown(screen.getByTestId('last'), { key: 'Tab' });

    expect(screen.getByTestId('first')).toHaveFocus();
  });

  it('removes its listener on unmount', () => {
    const { unmount } = render(<Dialog />);
    const dialog = screen.getByTestId('dialog');
    const removeListener = vi.spyOn(dialog, 'removeEventListener');

    unmount();

    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
