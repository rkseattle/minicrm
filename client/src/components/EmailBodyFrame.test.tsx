import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import EmailBodyFrame, { emailFramePolicy } from './EmailBodyFrame.js';

const HOSTILE =
  '<p>Hi</p><script>alert(1)</script><img src="https://tracker.test/p.png">' +
  '<p style="background:u\\72l(https://tracker.test/q)">x</p>';

function frame(allowImages: boolean): HTMLIFrameElement {
  renderWithProviders(<EmailBodyFrame html={HOSTILE} allowImages={allowImages} title="Hello" />);
  // Safe: the component renders exactly one iframe with this test id.
  return screen.getByTestId('email-body-frame') as HTMLIFrameElement;
}

describe('EmailBodyFrame', () => {
  it('sandboxes the body with no scripts and no same origin, but lets links open', () => {
    const sandbox = frame(false).getAttribute('sandbox') ?? '';

    expect(sandbox.split(' ').sort()).toEqual(['allow-popups', 'allow-popups-to-escape-sandbox']);
  });

  it('forbids images in the frame until the reader allows them', () => {
    const doc = frame(false).getAttribute('srcdoc') ?? '';

    expect(doc).toContain(`content="${emailFramePolicy(false)}"`);
    expect(emailFramePolicy(false)).toContain("img-src 'none'");
    expect(emailFramePolicy(false)).toContain("default-src 'none'");
  });

  it('allows https images in the frame once the reader opts in', () => {
    const doc = frame(true).getAttribute('srcdoc') ?? '';

    expect(doc).toContain(`content="${emailFramePolicy(true)}"`);
    expect(emailFramePolicy(true)).toContain('img-src https:');
    expect(doc).toContain('https://tracker.test/p.png');
  });

  it('never hands the frame unsanitized markup', () => {
    const doc = frame(false).getAttribute('srcdoc') ?? '';

    expect(doc).not.toContain('<script>alert');
    expect(doc).not.toContain('tracker.test');
    expect(doc).toContain('<p>Hi</p>');
  });

  it('names the frame for assistive technology', () => {
    expect(frame(false).getAttribute('title')).toContain('Hello');
  });
});
