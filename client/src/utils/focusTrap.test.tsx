import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { keepTabInside } from './focusTrap.js';

function Dialog({ empty = false }: { empty?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="presentation"
      data-testid="dialog"
      onKeyDown={(e) => keepTabInside(e, ref.current)}
    >
      {!empty && (
        <>
          <input data-testid="first" />
          <button type="button" disabled>
            off
          </button>
          <button type="button" data-testid="last">
            last
          </button>
        </>
      )}
    </div>
  );
}

describe('keepTabInside', () => {
  it('wraps Tab from the last control to the first', () => {
    render(<Dialog />);
    screen.getByTestId('last').focus();

    const notCancelled = fireEvent.keyDown(screen.getByTestId('last'), { key: 'Tab' });

    expect(notCancelled).toBe(false);
    expect(screen.getByTestId('first')).toHaveFocus();
  });

  it('wraps Shift+Tab from the first control to the last, skipping disabled ones', () => {
    render(<Dialog />);
    screen.getByTestId('first').focus();

    fireEvent.keyDown(screen.getByTestId('first'), { key: 'Tab', shiftKey: true });

    expect(screen.getByTestId('last')).toHaveFocus();
  });

  it('leaves Tab between inner controls to the browser', () => {
    render(<Dialog />);
    screen.getByTestId('first').focus();

    const notCancelled = fireEvent.keyDown(screen.getByTestId('first'), { key: 'Tab' });

    expect(notCancelled).toBe(true);
    expect(screen.getByTestId('first')).toHaveFocus();
  });

  it('ignores other keys', () => {
    render(<Dialog />);
    screen.getByTestId('last').focus();

    expect(fireEvent.keyDown(screen.getByTestId('last'), { key: 'Enter' })).toBe(true);
  });

  it('holds Tab when there is nothing to move to', () => {
    render(<Dialog empty />);

    expect(fireEvent.keyDown(screen.getByTestId('dialog'), { key: 'Tab' })).toBe(false);
  });
});
