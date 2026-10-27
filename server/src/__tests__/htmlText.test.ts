import { describe, expect, it } from 'vitest';

import { escapeHtml, plainTextToHtml } from '@minicrm/shared/text/html.js';

describe('plainTextToHtml', () => {
  it('escapes everything typed, so nothing is read as markup', () => {
    expect(plainTextToHtml(`<script>"a" & 'b'</script>`)).toBe(
      '<p>&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;</p>',
    );
  });

  it('makes blank-line blocks paragraphs and keeps single line breaks', () => {
    expect(plainTextToHtml('Hi Ada,\n\nLine one\r\nLine two')).toBe(
      '<p>Hi Ada,</p><p>Line one<br>Line two</p>',
    );
  });

  it('returns nothing for empty or blank input', () => {
    expect(plainTextToHtml('')).toBe('');
    expect(plainTextToHtml('  \n\n  ')).toBe('');
  });

  it('drops trailing blank lines and treats a line of spaces as a paragraph break', () => {
    expect(plainTextToHtml('Hi\n\n')).toBe('<p>Hi</p>');
    expect(plainTextToHtml('a\n \nb')).toBe('<p>a</p><p>b</p>');
  });
});

describe('escapeHtml', () => {
  it('escapes all five HTML special characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('Hello, World!')).toBe('Hello, World!');
  });
});
