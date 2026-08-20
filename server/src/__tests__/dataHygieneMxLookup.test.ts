/**
 * MX-lookup decision logic. Mocked, unlike the integration tests next door:
 * a real resolver cannot be made to time out or SERVFAIL on demand.
 *
 * Run: npm test (from /server)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const resolveMx = vi.fn();
/**
 * `lookup` is mocked to a public address because assertUrlIsFetchSafe re-resolves the
 * hostname immediately before every fetch (its DNS-rebinding defence). Left unmocked it
 * throws UrlNotSafeError, and checkWebsiteStatus returns 'unreachable' before reaching
 * the classification these tests exist to cover.
 */
const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
vi.mock('dns', () => ({
  default: {
    promises: {
      resolveMx: (...args: unknown[]) => resolveMx(...args),
      // Arguments are irrelevant: every hostname resolves to the same safe address.
      lookup: () => lookup(),
    },
  },
}));

const { resolveMailDomainStatus, checkWebsiteStatus } =
  await import('../services/dataHygieneService.js');

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
    await expect(resolveMailDomainStatus('someone@defunct-domain.co')).resolves.toBe('no-mail');
  });

  it.each([
    'example.com',
    'example.net',
    'example.org',
    'example.edu',
    'test',
    'invalid',
    'localhost',
    'anything.test',
  ])('skips the reserved domain %s without a lookup', async (domain) => {
    await expect(resolveMailDomainStatus(`someone@${domain}`)).resolves.toBe('accepts-mail');
    expect(resolveMx).not.toHaveBeenCalled();
  });

  /**
   * RFC 2606/6761 reserve these names and everything beneath them. Exact-set
   * membership passed the flat cases above while missing every one of these —
   * and `acme-demo.example.com` is what demoService actually seeds, whose real
   * MX lookup answers ENODATA and would therefore flag every demo contact.
   */
  it.each([
    'acme-demo.example.com',
    'globex-demo.example.com',
    'mail.example.net',
    'foo.invalid',
    'foo.localhost',
    'deep.nested.example.org',
  ])('skips %s, a subdomain of a reserved domain, without a lookup', async (domain) => {
    await expect(resolveMailDomainStatus(`someone@${domain}`)).resolves.toBe('accepts-mail');
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it('still looks up a domain that merely contains a reserved name', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mx.notexample.com', priority: 10 }]);
    await expect(resolveMailDomainStatus('someone@notexample.com')).resolves.toBe('accepts-mail');
    expect(resolveMx).toHaveBeenCalledWith('notexample.com');
  });

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

/**
 * The website signal's failure classification. undici reports a refused connection,
 * a TLS failure and a resolver outage all as `TypeError: fetch failed`, separable
 * only by `cause.code` — so a check that branched on the error NAME reported our own
 * network trouble as the customer's site being dead. A DNS blip during the nightly
 * scan would have flagged every account website at once.
 */
describe('checkWebsiteStatus', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Builds the error undici raises for a transport failure: name is always TypeError. */
  function fetchFailed(code: string): Error {
    const err = new TypeError('fetch failed');
    (err as { cause?: NodeJS.ErrnoException }).cause = Object.assign(new Error(code), { code });
    return err;
  }

  it('reports a 200 as reachable', async () => {
    fetchMock.mockResolvedValue({ status: 200 });
    await expect(checkWebsiteStatus('https://live.test-site.co')).resolves.toBe('reachable');
  });

  it('reports a 404 as unreachable', async () => {
    fetchMock.mockResolvedValue({ status: 404 });
    await expect(checkWebsiteStatus('https://gone.test-site.co')).resolves.toBe('unreachable');
  });

  it.each(['ENOTFOUND', 'ENODATA'])(
    'reports %s as unreachable — the name genuinely does not resolve',
    async (code) => {
      fetchMock.mockRejectedValue(fetchFailed(code));
      await expect(checkWebsiteStatus('https://missing.test-site.co')).resolves.toBe('unreachable');
    },
  );

  it.each(['ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'CERT_HAS_EXPIRED'])(
    'reports %s as unknown rather than blaming the site',
    async (code) => {
      fetchMock.mockRejectedValue(fetchFailed(code));
      await expect(checkWebsiteStatus('https://flaky.test-site.co')).resolves.toBe('unknown');
    },
  );

  it('reports a transport failure with no cause code as unknown', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(checkWebsiteStatus('https://opaque.test-site.co')).resolves.toBe('unknown');
  });

  /**
   * assertUrlIsFetchSafe runs BEFORE the fetch and raises UrlNotSafeError for several
   * unrelated conditions. Collapsing them all to 'unreachable' reintroduced the very
   * bug the tri-state fixed, one layer up: 'unresolvable_hostname' is raised for ANY
   * dns.lookup rejection, a transient EAI_AGAIN included.
   */
  it.each(['EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED'])(
    'reports a %s lookup failure as unknown — the resolver may be at fault',
    async (code) => {
      lookup.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
      await expect(checkWebsiteStatus('https://blip.test-site.co')).resolves.toBe('unknown');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  /**
   * The other half of the same boundary. assertUrlIsFetchSafe raises one reason for
   * every lookup failure, so treating that reason as inconclusive wholesale silences
   * the finding this signal exists to produce — a name that genuinely does not exist.
   * The underlying resolver code is what separates the two.
   */
  it.each(['ENOTFOUND', 'ENODATA'])(
    'still reports a %s lookup failure as unreachable — the name is genuinely gone',
    async (code) => {
      lookup.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
      await expect(checkWebsiteStatus('https://gone-for-good.test-site.co')).resolves.toBe(
        'unreachable',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('reports a blocked address as unknown — it describes where the name points', async () => {
    lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(checkWebsiteStatus('https://internal.test-site.co')).resolves.toBe('unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still reports a malformed URL as unreachable — that is a real data defect', async () => {
    await expect(checkWebsiteStatus('not-a-url')).resolves.toBe('unreachable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports our own abort as unknown, not as a broken site', async () => {
    const abort = new Error('This operation was aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValue(abort);
    await expect(checkWebsiteStatus('https://slow.test-site.co')).resolves.toBe('unknown');
  });
});
