/**
 * Shared SSRF-prevention helpers for any server-side fetch of an admin/user-supplied
 * URL (webhook delivery, PDF branding logo fetch, etc.). Resolves the hostname and
 * checks every returned address against blocked ranges — callers must re-check
 * immediately before each actual fetch, not just at input-validation time, to
 * mitigate DNS rebinding.
 */

import dns from 'dns';
import { isProductionEnv } from './nodeEnv.js';
import ipaddr from 'ipaddr.js';

/**
 * IPv4 CIDR ranges that must never be reachable via a server-initiated fetch of a
 * user-supplied URL. Covers: loopback, link-local/cloud metadata, RFC 1918 private ranges.
 * Using class-specific parseCIDR so match() receives the correct tuple type.
 */
const BLOCKED_IPV4_CIDRS: Array<[ipaddr.IPv4, number]> = [
  ipaddr.IPv4.parseCIDR('127.0.0.0/8'), // loopback
  ipaddr.IPv4.parseCIDR('169.254.0.0/16'), // link-local / cloud metadata
  ipaddr.IPv4.parseCIDR('10.0.0.0/8'), // RFC 1918
  ipaddr.IPv4.parseCIDR('172.16.0.0/12'), // RFC 1918
  ipaddr.IPv4.parseCIDR('192.168.0.0/16'), // RFC 1918
];

/**
 * IPv6 CIDR ranges that must never be reachable via a server-initiated fetch of a
 * user-supplied URL. Covers: loopback (::1/128), link-local (fe80::/10 — the IPv6
 * counterpart to blocked IPv4 169.254.0.0/16, reachable on the adjacent network
 * segment in dual-stack environments), and ULA (fc00::/7).
 */
const BLOCKED_IPV6_CIDRS: Array<[ipaddr.IPv6, number]> = [
  ipaddr.IPv6.parseCIDR('::1/128'), // loopback
  ipaddr.IPv6.parseCIDR('fe80::/10'), // link-local
  ipaddr.IPv6.parseCIDR('fc00::/7'), // ULA
];

/** Reason a URL was rejected by {@link assertUrlIsFetchSafe}. */
export type UrlSafetyRejectionReason =
  'invalid_url' | 'insecure_protocol' | 'unresolvable_hostname' | 'blocked_address';

/** Thrown when a URL fails SSRF safety checks. `reason` lets callers map to a specific error code. */
export class UrlNotSafeError extends Error {
  constructor(
    public readonly reason: UrlSafetyRejectionReason,
    message: string,
    /**
     * The resolver error code behind an `unresolvable_hostname`, when there was one.
     *
     * A name that does not exist (ENOTFOUND/ENODATA) and a resolver that failed to
     * answer (EAI_AGAIN, ETIMEDOUT) both surface as the same reason, but they are not
     * the same fact: the first is evidence about the URL, the second is evidence about
     * our own network. Callers that report findings to users need to tell them apart.
     */
    public readonly dnsCode?: string,
  ) {
    super(message);
    this.name = 'UrlNotSafeError';
  }
}

/**
 * Validates that a URL is safe to fetch from the server: well-formed, HTTPS in
 * production, and resolves only to public (non-blocked) IP addresses. Throws
 * {@link UrlNotSafeError} on any failure — never returns a boolean, so callers
 * can't accidentally ignore a rejection.
 *
 * Call this immediately before every actual fetch (not just once at input-validation
 * time) — re-resolving right before use mitigates DNS rebinding, where a hostname
 * could resolve safely at validation time and to a blocked address at fetch time.
 */
export async function assertUrlIsFetchSafe(urlString: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new UrlNotSafeError('invalid_url', 'Invalid URL');
  }

  if (isProductionEnv() && parsed.protocol !== 'https:') {
    throw new UrlNotSafeError('insecure_protocol', 'URL must use HTTPS in production');
  }

  await assertHostnameIsSafe(parsed.hostname);
}

/**
 * The address half of the check, for destinations that are a bare host rather than a URL
 * — an IMAP or SMTP server, say, where there is no scheme or path to validate.
 *
 * Call it immediately before connecting, never only at input-validation time: a hostname
 * that resolved publicly a moment ago can resolve to loopback on the next lookup.
 *
 * @param hostname - Host to resolve and check against the blocked ranges.
 * @throws UrlNotSafeError when the name cannot resolve or any address is blocked.
 */
export async function assertHostnameIsSafe(hostname: string): Promise<void> {
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err) {
    throw new UrlNotSafeError(
      'unresolvable_hostname',
      `Unable to resolve hostname: ${hostname}`,
      (err as NodeJS.ErrnoException).code,
    );
  }

  for (const { address, family } of addresses) {
    if (family === 4) {
      const ip = ipaddr.IPv4.parse(address);
      for (const cidr of BLOCKED_IPV4_CIDRS) {
        if (ip.match(cidr)) {
          throw new UrlNotSafeError(
            'blocked_address',
            `Hostname resolves to a blocked IP address: ${address}`,
          );
        }
      }
    } else if (family === 6) {
      try {
        const ip = ipaddr.IPv6.parse(address);
        for (const cidr of BLOCKED_IPV6_CIDRS) {
          if (ip.match(cidr)) {
            throw new UrlNotSafeError(
              'blocked_address',
              `Hostname resolves to a blocked IP address: ${address}`,
            );
          }
        }
      } catch {
        // ipaddr.js may not recognise some IPv6 representations; treat as blocked
        throw new UrlNotSafeError(
          'blocked_address',
          `Hostname resolves to an unrecognised IPv6 address: ${address}`,
        );
      }
    }
  }
}
