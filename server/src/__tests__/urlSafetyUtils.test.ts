/**
 * Unit tests for the shared SSRF-prevention utility. (MINCRM-656)
 * webhookService.test.ts covers this logic indirectly via validateWebhookUrl();
 * these tests cover the shared core directly since it's now a standalone utility
 * other services (PDF branding logo fetch) also depend on.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'dns';
import { assertUrlIsFetchSafe, UrlNotSafeError } from '../utils/urlSafetyUtils.js';

const MOCK_PUBLIC_IPV4: dns.LookupAddress[] = [{ address: '93.184.216.34', family: 4 }];

afterEach(() => {
  vi.restoreAllMocks();
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

  it('accepts a public IPv4 address over HTTPS', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce(MOCK_PUBLIC_IPV4 as never);
    await expect(assertUrlIsFetchSafe('https://example.com/logo.png')).resolves.toBeUndefined();
  });

  it('throws instances of UrlNotSafeError, not a generic Error', async () => {
    await expect(assertUrlIsFetchSafe('not a url')).rejects.toBeInstanceOf(UrlNotSafeError);
  });
});
