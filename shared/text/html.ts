/**
 * Text-to-HTML rules every workspace that builds an email body must apply identically:
 * the composer, the send service's forward quoting, and the org-SMTP send path. Kept
 * dependency-free so client, server and qa can all import it.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes the five characters that can break out of HTML text or a quoted attribute.
 *
 * @param text - Untrusted text
 * @returns the text, safe to interpolate into HTML or XML
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * HTML for typed text: one paragraph per blank-line-separated block, line breaks kept.
 *
 * @param text - Plain text as the user typed it
 * @returns escaped HTML, empty when the text is only whitespace
 */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n\s*/)
    .map((block) => block.replace(/\s+$/, ''))
    .filter((block) => block !== '')
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
