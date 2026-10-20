import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { keepTabInside, tabbableElements } from './focusTrap.js';

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
          <input type="hidden" name="not-a-tab-stop" />
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

describe('tabbableElements', () => {
  function stopsIn(html: string): string[] {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      return tabbableElements(container).map((element) => element.id);
    } finally {
      container.remove();
    }
  }

  it('stops on only the checked radio of a group', () => {
    expect(
      stopsIn(
        '<input type="radio" id="theirs" name="field"><input type="radio" id="mine" name="field" checked>',
      ),
    ).toEqual(['mine']);
  });

  it("stops on a group's first radio when none is checked, and on every ungrouped radio", () => {
    expect(
      stopsIn(
        '<input type="radio" id="a" name="g"><input type="radio" id="b" name="g">' +
          '<input type="radio" id="c"><input type="radio" id="d">',
      ),
    ).toEqual(['a', 'c', 'd']);
  });

  it('skips what Tab passes over: tabindex -1, disabled, hidden and inert subtrees', () => {
    expect(
      stopsIn(
        '<button id="ok">ok</button><button id="neg" tabindex="-1">x</button>' +
          '<a id="link" href="#">l</a><a id="neglink" href="#" tabindex="-1">l</a>' +
          '<button id="off" disabled>x</button><input id="secret" type="hidden">' +
          '<div hidden><button id="inhidden">x</button></div>' +
          '<div inert><button id="ininert">x</button></div>',
      ),
    ).toEqual(['ok', 'link']);
  });

  it("stops on a closed <details>' summary but not its contents", () => {
    expect(
      stopsIn(
        '<details><summary id="sum">More</summary><button id="inside">x</button></details>' +
          '<details open><summary id="osum">Open</summary><button id="oinside">x</button></details>',
      ),
    ).toEqual(['sum', 'osum', 'oinside']);
  });

  it('stops on an editable region, and visits positive tabindex first', () => {
    expect(
      stopsIn(
        '<button id="plain">p</button><div id="edit" contenteditable="true"></div>' +
          '<button id="second" tabindex="2">s</button><button id="first" tabindex="1">f</button>',
      ),
    ).toEqual(['first', 'second', 'plain', 'edit']);
  });
});

describe('keepTabInside with a radio group', () => {
  it('wraps Shift+Tab from the checked radio when it is the first stop', () => {
    function Dialog() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref} role="presentation" onKeyDown={(e) => keepTabInside(e, ref.current)}>
          <input type="radio" name="choice" data-testid="theirs" />
          <input type="radio" name="choice" data-testid="mine" defaultChecked />
          <button type="button" data-testid="done">
            done
          </button>
        </div>
      );
    }
    render(<Dialog />);
    const mine = screen.getByTestId('mine');
    mine.focus();

    fireEvent.keyDown(mine, { key: 'Tab', shiftKey: true });

    expect(screen.getByTestId('done')).toHaveFocus();
  });
});
