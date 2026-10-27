/**
 * Decides whether a synced message falls under its mailbox's excluded domains.
 *
 * A message is skipped only when it has at least one counterparty and every one of them
 * is on an excluded domain — HubSpot's Never Log rule. One counterparty outside the list
 * keeps the whole message, since that conversation is CRM-relevant to someone. The
 * mailbox's own address is never a counterparty; a note-to-self has none and is kept.
 */

import { domainOfAddress, normalizeAddress } from './address.js';
import type { NormalizedMessage } from './mailProvider.js';

type AddressedMessage = Pick<
  NormalizedMessage,
  'fromAddress' | 'toAddresses' | 'ccAddresses' | 'replyToAddresses'
>;

type IdentifiedMessage = Pick<NormalizedMessage, 'providerMessageId' | 'rfcMessageId'>;

/**
 * @param message - Addresses as the providers normalize them, already lowercased.
 * @param mailboxAddress - The mailbox's own address, excluded from the counterparties.
 * @param excludedDomains - The org and personal lists merged; empty means nothing excluded.
 */
export function isExcludedMessage(
  message: AddressedMessage,
  mailboxAddress: string,
  excludedDomains: ReadonlySet<string>,
): boolean {
  if (excludedDomains.size === 0) return false;

  const own = normalizeAddress(mailboxAddress);
  const counterparties = [
    message.fromAddress,
    ...message.toAddresses,
    ...message.ccAddresses,
    ...message.replyToAddresses,
  ].filter((address) => normalizeAddress(address) !== own);

  if (counterparties.length === 0) return false;

  return counterparties.every((address) => {
    const domain = domainOfAddress(address);
    // An unparseable address is kept as a counterparty no list can match.
    return domain !== null && excludedDomains.has(domain);
  });
}

/** What a page is filtered against before anything in it is stored. */
export interface PageExclusion {
  mailboxAddress: string;
  /** The org list and the mailbox's own list, merged. */
  domains: ReadonlySet<string>;
}

/** Sent copies an open send intent is waiting to file, by either id. */
export interface ClaimedCopies {
  providerMessageIds: readonly string[];
  rfcMessageIds: readonly string[];
}

/**
 * Drops the messages whose every counterparty is excluded, so they are never stored.
 *
 * A Sent copy an open send intent claims is kept whatever its recipients: the user sent it
 * from MiniCRM on purpose, and the intent's filing expects to find the copy stored.
 */
export function withoutExcludedMessages<T extends AddressedMessage & IdentifiedMessage>(
  messages: readonly T[],
  claimed: ClaimedCopies,
  exclusion: PageExclusion,
): T[] {
  if (exclusion.domains.size === 0) return [...messages];
  const claimedProviderIds = new Set(claimed.providerMessageIds);
  const claimedRfcIds = new Set(claimed.rfcMessageIds);
  return messages.filter(
    (message) =>
      claimedProviderIds.has(message.providerMessageId) ||
      (message.rfcMessageId !== null && claimedRfcIds.has(message.rfcMessageId)) ||
      !isExcludedMessage(message, exclusion.mailboxAddress, exclusion.domains),
  );
}
