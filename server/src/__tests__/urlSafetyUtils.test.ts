/**
 * Unit tests for the shared SSRF-prevention utility.
 * webhookService.test.ts covers this logic indirectly via validateWebhookUrl();
 * these tests cover the shared core directly since it's now a standalone utility
 * other services (PDF branding logo fetch) also depend on.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'dns';
import {
  assertHostnameIsSafe,
  assertUrlIsFetchSafe,
  UrlNotSafeError,
} from '../utils/urlSafetyUtils.js';

const MOCK_PUBLIC_IPV4: dns.LookupAddress[] = [{ address: '93.184.216.34', family: 4 }];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('assertUrlIsFetchSafe', () => {
  it('rejects a malformed URL with reason invalid_url', async () => {
    await expect(assertUrlIsFetchSafe('not a url')).rejects.toMatchObject({
      reason: 'invalid_url',
    });
  });

  it('rejects HTTP in production with reason insecure_protocol', async () => {
    const original = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce(MOCK_PUBLIC_IPV4 as never);
      await expect(assertUrlIsFetchSafe('http://example.com/logo.png')).rejects.toMatchObject({
        reason: 'insecure_protocol',
      });
    } finally {
      process.env['NODE_ENV'] = original;
    }
  });

  it('accepts HTTP in non-production environments', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce(MOCK_PUBLIC_IPV4 as never);
    await expect(assertUrlIsFetchSafe('http://example.com/logo.png')).resolves.toBeUndefined();
  });

  it('rejects when DNS resolution fails, with reason unresolvable_hostname', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValueOnce(new Error('ENOTFOUND') as never);
    await expect(
      assertUrlIsFetchSafe('https://no-such-host.invalid/logo.png'),
    ).rejects.toMatchObject({ reason: 'unresolvable_hostname' });
  });

  it('rejects a loopback address with reason blocked_address', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
      { address: '127.0.0.1', family: 4 },
    ] as never);
    await expect(assertUrlIsFetchSafe('https://localhost/logo.png')).rejects.toMatchObject({
      reason: 'blocked_address',
    });
  });

  it('rejects a cloud-metadata address (169.254.169.254) with reason blocked_address', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
      { address: '169.254.169.254', family: 4 },
    ] as never);
    await expect(assertUrlIsFetchSafe('https://evil.internal/logo.png')).rejects.toMatchObject({
      reason: 'blocked_address',
    });
  });

  it('rejects an RFC 1918 private address with reason blocked_address', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
      { address: '10.0.0.5', family: 4 },
    ] as never);
    await expect(assertUrlIsFetchSafe('https://evil.internal/logo.png')).rejects.toMatchObject({
      reason: 'blocked_address',
    });
  });

  it('rejects an IPv6 loopback address with reason blocked_address', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
      { address: '::1', family: 6 },
    ] as never);
    await expect(assertUrlIsFetchSafe('https://evil.internal/logo.png')).rejects.toMatchObject({
      reason: 'blocked_address',
    });
  });

  it('rejects an IPv6 link-local address (fe80::/10) with reason blocked_address', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
      { address: 'fe80::1', family: 6 },
    ] as never);
    await expect(assertUrlIsFetchSafe('https://evil.internal/logo.png')).rejects.toMatchObject({
      reason: 'blocked_address',
    });
  });

  it('accepts a public IPv4 address over HTTPS', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce(MOCK_PUBLIC_IPV4 as never);
    await expect(assertUrlIsFetchSafe('https://example.com/logo.png')).resolves.toBeUndefined();
  });

  it('throws instances of UrlNotSafeError, not a generic Error', async () => {
    await expect(assertUrlIsFetchSafe('not a url')).rejects.toBeInstanceOf(UrlNotSafeError);
  });
});

describe('assertHostnameIsSafe special-purpose ranges', () => {
  /** Every address here must be refused; each names the range a blocklist tends to miss. */
  const REFUSED: ReadonlyArray<[string, 4 | 6, string]> = [
    ['0.0.0.0', 4, 'this host, routed to loopback on Linux'],
    ['100.100.100.200', 4, 'carrier-grade NAT, Alibaba Cloud metadata'],
    ['224.0.0.1', 4, 'multicast'],
    ['255.255.255.255', 4, 'broadcast'],
    ['240.0.0.1', 4, 'reserved'],
    ['::', 6, 'unspecified'],
    ['::ffff:127.0.0.1', 6, 'IPv4-mapped loopback'],
    ['::ffff:10.0.0.5', 6, 'IPv4-mapped RFC 1918'],
    ['::ffff:169.254.169.254', 6, 'IPv4-mapped metadata'],
    ['::ffff:a9fe:a9fe', 6, 'IPv4-mapped metadata, hex form'],
    ['::127.0.0.1', 6, 'IPv4-compatible loopback'],
    ['::169.254.169.254', 6, 'IPv4-compatible metadata'],
    ['64:ff9b::a9fe:a9fe', 6, 'NAT64 metadata'],
    ['64:ff9b:1::a00:5', 6, 'local-use NAT64 RFC 1918'],
    ['2002:a9fe:a9fe::1', 6, '6to4 metadata'],
    ['2001::1', 6, 'teredo'],
    ['fd00:ec2::254', 6, 'unique-local, AWS IPv6 metadata'],
    ['ff02::1', 6, 'multicast'],
    ['fec0::1', 6, 'deprecated site-local'],
  ];

  for (const [address, family, why] of REFUSED) {
    it(`refuses ${address} (${why})`, async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address, family }] as never);
      await expect(assertHostnameIsSafe('evil.example')).rejects.toMatchObject({
        reason: 'blocked_address',
      });
    });
  }

  it('refuses the host when any one of its addresses is refused', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '::ffff:127.0.0.1', family: 6 },
    ] as never);
    await expect(assertHostnameIsSafe('example.com')).rejects.toMatchObject({
      reason: 'blocked_address',
    });
  });

  it('accepts public IPv4, public IPv6, and public IPv4 written as mapped IPv6', async () => {
    for (const [address, family] of [
      ['93.184.216.34', 4],
      ['2606:4700:4700::1111', 6],
      ['::ffff:93.184.216.34', 6],
    ] as const) {
      vi.restoreAllMocks();
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address, family }] as never);
      await expect(assertHostnameIsSafe('example.com')).resolves.toBeUndefined();
    }
  });
});

describe('assertHostnameIsSafe with SSRF_ALLOWED_PRIVATE_HOSTS', () => {
  function resolveTo(address: string, family: 4 | 6): void {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address, family }] as never);
  }

  function allow(list: string, env = 'test'): void {
    vi.stubEnv('NODE_ENV', env);
    vi.stubEnv('SSRF_ALLOWED_PRIVATE_HOSTS', list);
  }

  it('lets a listed host resolve to RFC 1918 and loopback addresses', async () => {
    allow('greenmail, localhost');
    for (const [host, address, family] of [
      ['greenmail', '172.18.0.4', 4],
      ['localhost', '127.0.0.1', 4],
      ['GreenMail', '10.0.0.5', 4],
      ['localhost', '::1', 6],
      ['localhost', '::ffff:127.0.0.1', 6],
    ] as const) {
      vi.restoreAllMocks();
      resolveTo(address, family);
      await expect(assertHostnameIsSafe(host)).resolves.toBeUndefined();
    }
  });

  it('still refuses every metadata-bearing range for a listed host', async () => {
    allow('greenmail');
    for (const [address, family] of [
      ['169.254.169.254', 4],
      ['100.100.100.200', 4],
      ['fe80::1', 6],
      ['fd00:ec2::254', 6],
      ['::ffff:169.254.169.254', 6],
      ['64:ff9b::a9fe:a9fe', 6],
    ] as const) {
      vi.restoreAllMocks();
      resolveTo(address, family);
      await expect(assertHostnameIsSafe('greenmail')).rejects.toMatchObject({
        reason: 'blocked_address',
      });
    }
  });

  it('matches exact names only — no suffix, prefix, subdomain, or trailing dot', async () => {
    allow('greenmail');
    for (const host of [
      'greenmail.evil.example',
      'evil-greenmail',
      'xgreenmail',
      'mail.greenmail',
      'greenmail.',
      '172.18.0.4',
    ]) {
      vi.restoreAllMocks();
      resolveTo('172.18.0.4', 4);
      await expect(assertHostnameIsSafe(host)).rejects.toMatchObject({
        reason: 'blocked_address',
      });
    }
  });

  it('is inert in production, staging, and when unset', async () => {
    for (const [list, env] of [
      ['greenmail', 'production'],
      ['greenmail', 'staging'],
      ['', 'test'],
    ] as const) {
      vi.restoreAllMocks();
      allow(list, env);
      resolveTo('172.18.0.4', 4);
      await expect(assertHostnameIsSafe('greenmail')).rejects.toMatchObject({
        reason: 'blocked_address',
      });
    }
  });
});
