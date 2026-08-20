/**
 * MX-lookup decision logic. Mocked, unlike the integration tests next door:
 * a real resolver cannot be made to time out or SERVFAIL on demand.
 *
 * Run: npm test (from /server)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const resolveMx = vi.fn();
vi.mock('dns', () => ({
  default: { promises: { resolveMx: (...args: unknown[]) => resolveMx(...args) } },
}));

const { resolveMailDomainStatus } = await import('../services/dataHygieneService.js');

/** Builds a DNS error the way node's resolver surfaces one, with a `code`. */
function dnsError(code: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`queryMx ${code}`);
  err.code = code;
  return err;
}

describe('resolveMailDomainStatus', () => {
  beforeEach(() => {
    resolveMx.mockReset();
  });

  it('reports a domain with real MX records as accepting mail', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mx1.example.net', priority: 10 }]);
    await expect(resolveMailDomainStatus('someone@example.net')).resolves.toBe('accepts-mail');
  });

  it('treats an RFC 7505 null MX as accepting no mail', async () => {
    resolveMx.mockResolvedValue([{ exchange: '', priority: 0 }]);
    await expect(resolveMailDomainStatus('someone@defunct.test.invalid')).resolves.toBe('no-mail');
  });

  it.each(['example.com', 'example.net', 'example.org', 'localhost', 'anything.test'])(
    'skips the reserved documentation domain %s without a lookup',
    async (domain) => {
      await expect(resolveMailDomainStatus(`someone@${domain}`)).resolves.toBe('accepts-mail');
      expect(resolveMx).not.toHaveBeenCalled();
    },
  );

  it('treats an empty record set as accepting no mail', async () => {
    resolveMx.mockResolvedValue([]);
    await expect(resolveMailDomainStatus('someone@nomx.example')).resolves.toBe('no-mail');
  });

  it.each(['ENOTFOUND', 'ENODATA'])(
    'treats %s as definite evidence the domain accepts no mail',
    async (code) => {
      resolveMx.mockRejectedValue(dnsError(code));
      await expect(resolveMailDomainStatus('someone@gone.example')).resolves.toBe('no-mail');
    },
  );

  it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EAI_AGAIN'])(
    'treats %s as unknown rather than evidence',
    async (code) => {
      resolveMx.mockRejectedValue(dnsError(code));
      await expect(resolveMailDomainStatus('someone@intermittent.example')).resolves.toBe(
        'unknown',
      );
    },
  );

  it('treats an error with no code as unknown', async () => {
    resolveMx.mockRejectedValue(new Error('something unexpected'));
    await expect(resolveMailDomainStatus('someone@weird.example')).resolves.toBe('unknown');
  });

  it('treats a hung lookup as unknown rather than waiting indefinitely', async () => {
    resolveMx.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const pending = resolveMailDomainStatus('someone@blackhole.example');
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toBe('unknown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats an address with no domain part as accepting no mail', async () => {
    await expect(resolveMailDomainStatus('malformed-address')).resolves.toBe('no-mail');
    expect(resolveMx).not.toHaveBeenCalled();
  });
});
