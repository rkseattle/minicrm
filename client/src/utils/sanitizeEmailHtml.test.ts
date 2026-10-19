import { describe, it, expect } from 'vitest';

import { sanitizeEmailHtml } from './sanitizeEmailHtml.js';

/** Parses sanitized output so assertions read the DOM a browser would build, not a string. */
function render(html: string, allowImages = false): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = sanitizeEmailHtml(html, { allowImages });
  return host;
}

describe('sanitizeEmailHtml — hostile markup', () => {
  it.each([
    ['a script element', '<p>hi</p><script>alert(1)</script>'],
    ['an onerror handler', '<img src="https://x.test/a.png" onerror="alert(1)">'],
    ['an onclick handler', '<p onclick="alert(1)">hi</p>'],
    ['an SVG carrying a script', '<svg><script>alert(1)</script></svg>'],
    ['an SVG onload', '<svg onload="alert(1)"></svg>'],
    ['an iframe', '<iframe src="https://evil.test"></iframe>'],
    ['an object', '<object data="https://evil.test/x.swf"></object>'],
    ['an embed', '<embed src="https://evil.test/x.swf">'],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.test">'],
    ['a base element', '<base href="https://evil.test/">'],
    ['a style element', '<style>body{background:url(https://evil.test/t)}</style>'],
  ])('removes %s', (_label, html) => {
    const output = sanitizeEmailHtml(html, { allowImages: true });

    expect(output).not.toMatch(/<script|<svg|<iframe|<object|<embed|<meta|<base|<style/i);
    expect(output).not.toMatch(/\bon\w+=/i);
    expect(output).not.toContain('alert(1)');
  });

  it('removes a form with its contents, so no phishing label survives as prose', () => {
    const host = render(
      '<form><label>Password</label><textarea>enter here</textarea><button>Go</button>' +
        '<select><option>Opt</option></select></form><p>after</p>',
    );

    expect(host.textContent).toBe('after');
  });

  it('removes an object with its fallback content', () => {
    expect(render('<object>fallback text</object><p>after</p>').textContent).toBe('after');
  });

  it('removes a form and its external action, keeping no control a reader could submit', () => {
    const host = render(
      '<form action="https://evil.test/steal"><input name="password"><button>Go</button></form>',
    );

    expect(host.querySelector('form, input, button')).toBeNull();
    expect(host.innerHTML).not.toContain('evil.test');
  });

  it.each(['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:x'])(
    'strips a link to %j but keeps its text',
    (href) => {
      const host = render(`<a href="${href}">click</a>`);

      const link = host.querySelector('a');
      expect(link?.hasAttribute('href')).toBe(false);
      expect(host.textContent).toBe('click');
    },
  );

  it('keeps a plain-http link, as every mail client does, opened away from the app', () => {
    const link = render('<a href="http://x.test">x</a>').querySelector('a');

    expect(link?.getAttribute('href')).toBe('http://x.test');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('keeps an https link and opens it away from the app, without a referrer', () => {
    const link = render('<a href="https://x.test/page">x</a>').querySelector('a');

    expect(link?.getAttribute('href')).toBe('https://x.test/page');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('keeps a mailto link', () => {
    expect(render('<a href="mailto:a@x.test">a</a>').querySelector('a')?.getAttribute('href')).toBe(
      'mailto:a@x.test',
    );
  });

  it.each([
    'background-image: url(https://evil.test/pixel)',
    'background: url(https://evil.test/pixel)',
    'width: expression(alert(1))',
    'behavior: url(x.htc)',
    // CSS escapes resolve before the parser sees url(, so a text filter misses them.
    'background:u\\72l(https://evil.test/p)',
    'background:\\75rl(https://evil.test/p)',
    // image-set takes a bare string, no url( at all.
    "background-image:image-set('https://evil.test/p' 1x)",
    "background-image:-webkit-image-set('https://evil.test/p' 1x)",
    'background-image:var(--pixel)',
    'list-style-image: url(https://evil.test/p)',
    'border-image: url(https://evil.test/p) 30',
    'content: url(https://evil.test/p)',
    'cursor: url(https://evil.test/p), auto',
    'background:u/**/rl(https://evil.test/p)',
  ])('keeps nothing that could load from the style %s', (style) => {
    const host = render(`<p style="${style}">x</p>`);

    expect(host.innerHTML).not.toContain('evil.test');
    expect(host.innerHTML).not.toMatch(/url|image-set|var\(/i);
  });

  it('keeps the colour a background shorthand sets, and nothing that could load', () => {
    const style = render('<p style="background: #ffffff url(https://evil.test/p)">x</p>')
      .querySelector('p')
      ?.getAttribute('style');

    expect(style).toBe('background-color: rgb(255, 255, 255)');
  });

  it.each(['color: var(--tracker)', 'color: color-mix(in srgb, red, blue)', 'width: attr(data-x)'])(
    'drops an allowed property whose value calls a function that is not allowed: %s',
    (style) => {
      expect(render(`<p style="${style}">x</p>`).querySelector('p')?.hasAttribute('style')).toBe(
        false,
      );
    },
  );

  it("keeps only this sanitizer's own target and rel, never the sender's", () => {
    const host = render(
      '<a target="frame" rel="opener">no href</a><a href="https://x.test" target="frame" rel="opener">y</a>',
    );
    const [bare, linked] = [...host.querySelectorAll('a')];

    expect(bare?.hasAttribute('target')).toBe(false);
    expect(bare?.hasAttribute('rel')).toBe(false);
    expect(linked?.getAttribute('target')).toBe('_blank');
    expect(linked?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('keeps a colour given as a function', () => {
    expect(
      render('<p style="color: rgb(255, 0, 0)">x</p>').querySelector('p')?.getAttribute('style'),
    ).toBe('color: rgb(255, 0, 0)');
  });

  it('keeps a harmless inline style, which most email layouts depend on', () => {
    expect(render('<p style="color: red">x</p>').querySelector('p')?.getAttribute('style')).toBe(
      'color: red',
    );
  });
});

describe('sanitizeEmailHtml — images', () => {
  it('removes a remote image by default', () => {
    expect(render('<p>a</p><img src="https://x.test/a.png">').querySelector('img')).toBeNull();
  });

  it('keeps an https image once the reader opts in', () => {
    const image = render('<img src="https://x.test/a.png" alt="logo">', true).querySelector('img');

    expect(image?.getAttribute('src')).toBe('https://x.test/a.png');
  });

  it.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'http://x.test/a.png',
    'cid:part1@x.test',
    'javascript:alert(1)',
  ])('removes an image from %j even when images are allowed', (src) => {
    expect(render(`<img src="${src}">`, true).querySelector('img')).toBeNull();
  });

  it("does not carry one call's image choice into the next, in either order", () => {
    const image = '<img src="https://x.test/a.png">';

    // Blocked, then allowed: a blocking hook left on a shared instance would still remove it.
    render(image);
    expect(render(image, true).querySelector('img')).not.toBeNull();
    // Allowed, then blocked.
    expect(render(image).querySelector('img')).toBeNull();
  });

  it('removes an image with no source, even when images are allowed', () => {
    expect(render('<img alt="x">', true).querySelector('img')).toBeNull();
  });
});

describe('sanitizeEmailHtml — ordinary mail', () => {
  it('keeps the structure a newsletter is built from', () => {
    const host = render(
      '<table><tr><td><h1>Title</h1><p><b>Bold</b> and <i>italic</i></p><ul><li>one</li></ul></td></tr></table>',
    );

    expect(host.querySelector('table td h1')?.textContent).toBe('Title');
    expect(host.querySelector('li')?.textContent).toBe('one');
  });

  it('returns an empty string for an empty body', () => {
    expect(sanitizeEmailHtml('')).toBe('');
  });
});
