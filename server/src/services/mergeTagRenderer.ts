/**
 * Renders an email template's merge tags against a record's values.
 *
 * Tokens follow Mustache's double-brace interpolation, `{{contact.first_name}}`, with
 * Liquid's `default` filter for a fallback: `{{contact.first_name | default: "there"}}`.
 * As in Mustache, anything substituted into the HTML body is escaped, because a record
 * field is user-entered text and must arrive as text, not markup. That protects element
 * content and quoted attributes; it does not make a value safe as a URL, so a token belongs
 * in an `href` only behind a fixed scheme. The subject is plain text and is not escaped.
 *
 * The caller supplies the values, so this module never decides which columns of a record a
 * template may read. A template's own `merge_tags` documents its tokens for an author and
 * does not gate substitution: a token the author forgot to declare still renders.
 */

import { escapeHtml } from './emailService.js';

/** Values a template may reference, keyed by dotted path: `contact.first_name`. */
export type MergeContext = Readonly<Record<string, string | null | undefined>>;

export interface RenderableTemplate {
  subject: string;
  body: string;
}

export interface RenderedTemplate {
  subject: string;
  bodyHtml: string;
  /**
   * Lowercase paths that rendered empty — no value and no usable default — so a caller can
   * warn the sender before sending. A token whose default rendered is not listed.
   */
  unresolved: string[];
}

// Segments start with a letter or underscore, so `{{1abc}}` and `{{ }}` are prose, not tokens.
// Anything after a `|` is captured whole and parsed below, so an unsupported filter still
// renders as a token rather than leaking raw syntax into the mail.
const TOKEN_PATTERN = /\{\{\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*(?:\|([^}]*))?\}\}/g;

/** Liquid's `default` filter, with either quote style Liquid accepts. */
const DEFAULT_FILTER = /^\s*default:\s*(?:"([^"]*)"|'([^']*)')\s*$/;

/** The fallback a filter names, or null for no filter or one this renderer does not support. */
function fallbackOf(filter: string | undefined): string | null {
  if (filter === undefined) return null;
  const match = DEFAULT_FILTER.exec(filter);
  return match ? (match[1] ?? match[2] ?? '') : null;
}

/**
 * The value at `path`, or null.
 *
 * Own keys only: an inherited one would let `{{constructor}}` render `Object`'s source, and
 * hand the body's escaper a function instead of a string.
 */
function lookup(context: MergeContext, path: string): string | null {
  if (!Object.hasOwn(context, path)) return null;
  const value = context[path];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Replaces the tokens in one field of the template.
 *
 * A function replacement, never a string one: a value containing `$&` or `$1` would
 * otherwise be read as a back-reference and splice the token back in.
 */
function substitute(
  text: string,
  context: MergeContext,
  unresolved: Set<string>,
  encode: (value: string) => string,
): string {
  return text.replace(TOKEN_PATTERN, (_token, rawPath: string, filter?: string) => {
    const path = rawPath.toLowerCase();
    const value = lookup(context, path);
    if (value !== null) return encode(value);
    const fallback = fallbackOf(filter);
    if (fallback !== null) return encode(fallback);
    unresolved.add(path);
    // Empty, not the token: raw template syntax reads as a broken mail-merge.
    return '';
  });
}

/**
 * Renders a template's subject and body against one record's values.
 *
 * @param template - The stored template; `body` is HTML.
 * @param context - Values by dotted path. Paths and tokens both match case-insensitively,
 *   so `{{Contact.First_Name}}` reads a value keyed `contact.first_name`.
 */
export function renderTemplate(
  template: RenderableTemplate,
  context: MergeContext,
): RenderedTemplate {
  const values: MergeContext = Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const unresolved = new Set<string>();
  const subject = substitute(template.subject, values, unresolved, (value) => value);
  const bodyHtml = substitute(template.body, values, unresolved, escapeHtml);
  return { subject, bodyHtml, unresolved: [...unresolved] };
}
