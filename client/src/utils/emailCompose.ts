/**
 * The pure rules a composer fills its fields by.
 */

import addressParser from 'email-addresses';
import type { EmailMessage } from '@shared/schemas/emailMessageSchema.js';

/**
 * Addresses typed into one field, read as an RFC 5322 address list: comma-separated, each a
 * bare address or `Name <address>`, quoted names may hold commas.
 *
 * @returns the addresses, or null when the text is not an address list. A list the parser
 *   cannot read is refused whole rather than partly sent, since a guess drops a recipient.
 */
export function parseRecipients(value: string): string[] | null {
  if (value.trim() === '') return [];
  const parsed = addressParser.parseAddressList(value);
  if (!parsed) return null;
  return parsed.flatMap((entry) =>
    entry.type === 'group' ? entry.addresses.map((member) => member.address) : [entry.address],
  );
}

/**
 * Who a reply goes to: for mail received, its Reply-To when it names one (RFC 5322 §3.6.2),
 * else its sender; for mail sent, its recipients.
 */
export function replyRecipients(message: EmailMessage): string[] {
  if (message.direction === 'outbound') return [...message.to_addresses];
  return message.reply_to_addresses.length > 0
    ? [...message.reply_to_addresses]
    : [message.from_address];
}

/**
 * Reply prefixes other mail clients write, in the locales this app ships and their neighbors:
 * Re, German AW, Nordic SV and VS, Dutch Antw, French Réf, Italian Rif, Polish Odp, Chinese 回复.
 * A counter (`RE[2]:`, `Re^2:`) and a full-width colon are allowed, as Thunderbird accepts them.
 */
const REPLY_PREFIXES =
  /^(?:\s*(?:re|aw|sv|vs|antw|r[ée]f|rif|odp|回复|回覆)(?:\[\d+\]|\^\d+)?\s*[:：])+\s*/iu;

/**
 * A reply's subject: the original's with any chain of reply prefixes replaced by one `Re:`,
 * the way Thunderbird strips them, so a German `AW: AW:` thread does not grow `Re: AW: AW:`.
 */
export function replySubject(subject: string | null): string {
  const base = (subject ?? '').replace(REPLY_PREFIXES, '').trim();
  return base === '' ? 'Re:' : `Re: ${base}`;
}
