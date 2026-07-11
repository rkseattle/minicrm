/**
 * Tests for the useVisualViewportHeight hook.
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { useVisualViewportHeight } from './useVisualViewportHeight.js';

class FakeVisualViewport extends EventTarget {
  height: number;

  constructor(height: number) {
    super();
    this.height = height;
  }

  setHeight(height: number): void {
    this.height = height;
    this.dispatchEvent(new Event('resize'));
  }
}

describe('useVisualViewportHeight', () => {
  const originalVisualViewport = window.visualViewport;

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      value: originalVisualViewport,
      configurable: true,
    });
  });

  it('returns undefined when VisualViewport is unsupported', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBeUndefined();
  });

  it('returns the initial visualViewport height when supported', () => {
    const fake = new FakeVisualViewport(600);
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBe(600);
  });

  it('updates when the visualViewport resizes (e.g. keyboard overlay shrinks it)', () => {
    const fake = new FakeVisualViewport(600);
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    const { result } = renderHook(() => useVisualViewportHeight());

    act(() => {
      fake.setHeight(320);
    });

    expect(result.current).toBe(320);
  });
});
