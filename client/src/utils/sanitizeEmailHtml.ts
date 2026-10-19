/**
 * Makes a stored email body safe to render.
 *
 * Bodies are stored exactly as the sender wrote them, so this is the only thing between a
 * stranger's markup and the page. An explicit allowlist rather than DOMPurify's html
 * profile: that profile admits forms and images, and an email needs neither by default.
 *
 * Remote images are removed unless the reader opts in, as Gmail, Outlook and Thunderbird
 * do: an image fetch tells the sender the message was opened, and from where. Opting in is
 * a second call with `allowImages`, not a second rendering path.
 */

import DOMPurify from 'dompurify';

/** Elements an email body may keep. Anything else is removed, its text kept. */
const ALLOWED_TAGS = [
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
];

const ALLOWED_ATTR = [
  'align',
  'alt',
  'border',
  'cellpadding',
  'cellspacing',
  'color',
  'colspan',
  'dir',
  'height',
  'href',
  'lang',
  'rowspan',
  'src',
  'style',
  'title',
  'valign',
  'width',
];

/** Elements removed outright. */
const FORBID_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'link',
  'meta',
  'base',
  'svg',
  'math',
];

/**
 * Removed with their contents too. DOMPurify keeps a forbidden element's children unless
 * told otherwise, which would leave a phishing form's labels and an object's fallback as prose.
 */
const FORBID_CONTENTS = ['form', 'object', 'embed', 'button', 'textarea', 'select'];

/** Link schemes a reader may follow, as every mail client allows; never script or data. */
const SAFE_LINK = /^(?:https?:|mailto:)/i;

/** An image source the reader may load once they opt in: https only, never data or cid. */
const SAFE_IMAGE = /^https:/i;

/**
 * Inline-style properties a body may keep: layout, type and colour. None can load anything,
 * so no `background-image`, `list-style-image`, `border-image`, `content` or `cursor`.
 */
const ALLOWED_STYLE_PROPERTIES = new Set([
  'color',
  'background-color',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'text-indent',
  'text-transform',
  'white-space',
  'vertical-align',
  'direction',
  'display',
  'float',
  'clear',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-style',
  'border-color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-radius',
  'border-collapse',
  'border-spacing',
  'table-layout',
  'list-style-type',
  'list-style-position',
]);

/** Functions a kept value may call: colours and arithmetic, none of which fetch. */
const ALLOWED_STYLE_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'calc']);

const STYLE_FUNCTION = /([a-z-]+)\s*\(/gi;

/** Escapes and comments are where CSS parsers disagree, so a style holding either goes whole. */
const AMBIGUOUS_STYLE = /\\|\/\*/;

/**
 * The parts of an inline style a body may keep, or null for none.
 *
 * Parsed by the browser's own CSS parser and rebuilt from an allowlist, never filtered as
 * text: a text filter is bypassed by whatever the parser resolves that the filter did not,
 * as `u\72l(` and `image-set('…')` both are.
 */
function safeStyle(raw: string): string | null {
  if (AMBIGUOUS_STYLE.test(raw)) return null;
  const probe = document.createElement('span');
  probe.style.cssText = raw;
  const kept: string[] = [];
  for (let index = 0; index < probe.style.length; index += 1) {
    const property = probe.style.item(index);
    if (!ALLOWED_STYLE_PROPERTIES.has(property)) continue;
    const value = probe.style.getPropertyValue(property);
    // Safe: STYLE_FUNCTION's one capture group is not optional, so every match carries it.
    const calls = [...value.matchAll(STYLE_FUNCTION)].map((match) => match[1]!.toLowerCase());
    if (calls.some((call) => !ALLOWED_STYLE_FUNCTIONS.has(call))) continue;
    kept.push(`${property}: ${value}`);
  }
  return kept.length > 0 ? kept.join('; ') : null;
}

export interface SanitizeOptions {
  /** Keep https images. Off by default; the reader turns it on per thread. */
  allowImages?: boolean;
}

/** Sanitized HTML for one stored email body. */
export function sanitizeEmailHtml(html: string, options: SanitizeOptions = {}): string {
  // A fresh instance per call: hooks are per-instance state, and a shared one would carry
  // one call's image choice into the next.
  const purifier = DOMPurify(window);

  purifier.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName !== 'style') return;
    const kept = safeStyle(data.attrValue);
    if (kept === null) data.keepAttr = false;
    else data.attrValue = kept;
  });

  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href');
      if (href !== null && !SAFE_LINK.test(href.trim())) node.removeAttribute('href');
      if (node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      if (!options.allowImages || !SAFE_IMAGE.test(src.trim())) node.remove();
    }
  });

  return purifier.sanitize(html, {
    ALLOWED_TAGS,
    // target and rel are set by the hook above, never taken from the sender.
    ALLOWED_ATTR,
    FORBID_TAGS,
    ADD_FORBID_CONTENTS: FORBID_CONTENTS,
    ALLOW_DATA_ATTR: false,
  });
}
