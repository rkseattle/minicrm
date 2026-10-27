/**
 * Shared Zod schemas for email sync's excluded-domain lists, personal and org-wide.
 *
 * An entry is a bare domain matched exactly against an address's domain part, the way
 * HubSpot's never-log domains and Salesforce's excluded addresses behave. Subdomains are not
 * implied: excluding `example.com` leaves `mail.example.com` synced.
 *
 * Internationalized domains are entered in their ASCII (punycode) form, `xn--…`, because
 * that is the form providers deliver addresses in; a Unicode spelling would never match.
 */

import { z } from 'zod';

/** Most domains one list may hold; the migration's CHECK on connected_accounts matches it. */
export const MAX_EXCLUDED_DOMAINS = 500;

/** Longest legal hostname, per RFC 1035. */
const MAX_DOMAIN_LENGTH = 253;

// Dot-separated LDH labels of at most 63 characters, none starting or ending with a hyphen,
// ending in a letter TLD or a punycode one.
const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{0,58}[a-z0-9])$/;

export const excludedDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(MAX_DOMAIN_LENGTH)
  .regex(DOMAIN_PATTERN, 'Enter a domain such as example.com, without @ or wildcards');

// Bounds the per-entry regex work before duplicates are removed and the real cap applies.
const MAX_RAW_DOMAIN_ENTRIES = MAX_EXCLUDED_DOMAINS * 2;

/** A list of domains, normalized to lowercase with duplicates removed. */
export const excludedDomainListSchema = z
  .array(excludedDomainSchema)
  .max(MAX_RAW_DOMAIN_ENTRIES)
  .transform((domains) => [...new Set(domains)])
  .pipe(z.array(z.string()).max(MAX_EXCLUDED_DOMAINS));

export type ExcludedDomainList = z.infer<typeof excludedDomainListSchema>;

/**
 * Splits an editor's text into candidate domains, one per line, blank lines dropped; validate
 * the result with excludedDomainListSchema. Shared so the personal and org editors, whose
 * lists merge at sync time, read input identically.
 */
export function parseExcludedDomainLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
