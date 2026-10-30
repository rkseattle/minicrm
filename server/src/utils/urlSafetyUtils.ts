/**
 * Shared SSRF-prevention helpers for any server-side fetch of an admin/user-supplied
 * URL (webhook delivery, PDF branding logo fetch, etc.). Resolves the hostname and
 * admits it only if every returned address is public unicast — callers must re-check
 * immediately before each actual fetch, not just at input-validation time, to
 * mitigate DNS rebinding.
 */

import dns from 'dns';
import { isProductionEnv } from './nodeEnv.js';
import { nonProductionSeam } from './nonProductionSeams.js';
import ipaddr from 'ipaddr.js';
import { thrownCode } from './errorCode.js';

/**
 * The one range a server-initiated fetch of a user-supplied URL may reach: public unicast.
 *
 * Allowing a single range rather than blocking a list of others is what closes the
 * special-purpose prefixes a blocklist forgets — IPv4 written as NAT64, 6to4 or teredo,
 * carrier-grade NAT, multicast, reserved space. ipaddr.js classifies every one.
 */
const PUBLIC_RANGE = 'unicast';

/** What an allowlisted host may resolve into besides public space: this machine and RFC 1918. */
const ALLOWLISTED_EXTRA_RANGES: ReadonlySet<string> = new Set(['loopback', 'private']);

/**
 * True when SSRF_ALLOWED_PRIVATE_HOSTS names this host exactly, ignoring case.
 *
 * Exact names only: a suffix or pattern would let any subdomain an attacker can register
 * under it through. The seam is honored only outside production.
 */
function isAllowlistedPrivateHost(hostname: string): boolean {
  const list = nonProductionSeam('SSRF_ALLOWED_PRIVATE_HOSTS');
  if (list === undefined) return false;
  const name = hostname.toLowerCase();
  return list.split(',').some((entry) => entry.trim().toLowerCase() === name);
}

/**
 * True when the address may be dialed.
 *
 * `process` unwraps an IPv4 address written as IPv4-mapped or IPv4-compatible IPv6 first,
 * so `::ffff:169.254.169.254` is judged as the metadata address it is.
 */
function isPermittedAddress(address: string, allowlisted: boolean): boolean {
  let range: string;
  try {
    range = ipaddr.process(address).range();
  } catch {
    return false;
  }
  return range === PUBLIC_RANGE || (allowlisted && ALLOWLISTED_EXTRA_RANGES.has(range));
}

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
 * A host named in SSRF_ALLOWED_PRIVATE_HOSTS, outside production, may also resolve to a
 * loopback or RFC 1918 address, so an E2E stack can reach its own fake mail servers.
 *
 * @param hostname - Host to resolve and admit only if every address it resolves to is permitted.
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
      thrownCode(err),
    );
  }

  const allowlisted = isAllowlistedPrivateHost(hostname);
  for (const { address } of addresses) {
    if (!isPermittedAddress(address, allowlisted)) {
      throw new UrlNotSafeError(
        'blocked_address',
        `Hostname resolves to a blocked IP address: ${address}`,
      );
    }
  }
}
