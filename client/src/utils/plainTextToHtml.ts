/**
 * Turns text typed into a plain textarea into the HTML body a send takes.
 *
 * Every character is escaped, so nothing typed is ever read as markup; blank lines (even ones
 * holding only spaces) become paragraphs, single line breaks stay line breaks, and empty
 * paragraphs are dropped.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/** HTML for typed text, one paragraph per blank-line-separated block. */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n\s*/)
    .map((block) => block.replace(/\s+$/, ''))
    .filter((block) => block !== '')
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
