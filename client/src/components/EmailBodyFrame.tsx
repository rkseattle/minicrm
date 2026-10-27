/**
 * EmailBodyFrame — renders one stored email body, in the second of two layers.
 *
 * The HTML is sanitized first, then shown inside a sandboxed iframe whose own
 * Content-Security-Policy forbids images until the reader opts in, as Open-Xchange App
 * Suite and other webmail do: a sanitizer miss then still loads nothing and runs nothing.
 * The sandbox grants no scripts and no same-origin, which is also why the parent cannot
 * measure the content: the frame has a fixed height the reader can drag taller. The drag
 * handle is on a wrapper, since Firefox ignores `resize` on an iframe.
 */

import { useTranslation } from 'react-i18next';
import { sanitizeEmailHtml } from '@/utils/sanitizeEmailHtml.js';

/** Links open in a new tab, outside the sandbox; nothing else is permitted. */
export const EMAIL_FRAME_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

/** The policy a body renders under: inline styles only, and images only once allowed. */
export function emailFramePolicy(allowImages: boolean): string {
  return `default-src 'none'; style-src 'unsafe-inline'; img-src ${allowImages ? 'https:' : "'none'"}`;
}

/** The full document a frame shows, around an already-sanitized body. */
export function emailFrameDocument(sanitizedBody: string, allowImages: boolean): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${emailFramePolicy(allowImages)}">` +
    '<base target="_blank">' +
    '<style>body{margin:8px;font:0.875rem/1.5 system-ui,sans-serif;color:#111827;' +
    'overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>' +
    `</head><body>${sanitizedBody}</body></html>`
  );
}

interface EmailBodyFrameProps {
  /** The body exactly as stored: unsanitized. */
  html: string;
  /** Whether the reader chose to show this thread's images. */
  allowImages: boolean;
  /** Names the frame for assistive technology, e.g. the message's subject. */
  title: string;
}

export default function EmailBodyFrame({ html, allowImages, title }: EmailBodyFrameProps) {
  const { t } = useTranslation();
  return (
    <div className="h-64 min-h-32 resize-y overflow-auto rounded-sm border border-gray-200 bg-white">
      <iframe
        title={t('emails.bodyFrameTitle', { subject: title })}
        sandbox={EMAIL_FRAME_SANDBOX}
        srcDoc={emailFrameDocument(sanitizeEmailHtml(html, { allowImages }), allowImages)}
        data-testid="email-body-frame"
        className="block w-full h-full"
      />
    </div>
  );
}
