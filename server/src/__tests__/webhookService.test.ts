/**
 * Integration tests for webhookService.
 *
 * Runs against a real PostgreSQL test database.
 * A single admin user is created in beforeAll and reused.
 * webhook_subscriptions and webhook_delivery_logs are truncated before each test.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import dns from 'dns';
import http from 'http';
import type { AddressInfo } from 'net';
import { vi } from 'vitest';
import {
  createWebhookSubscription,
  findWebhookSubscriptionById,
  listWebhookSubscriptions,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveryLogs,
  dispatchWebhookEvent,
  signPayload,
  validateWebhookUrl,
  WebhookUrlNotAllowedError,
} from '../services/webhookService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'wh-svc';

const ADMIN_USER = {
  email: `${FILE_PREFIX}-admin@example.com`,
  name: 'Webhook Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let adminId: string;
let adminActor: { id: string; name: string };

/** Public IP returned by default DNS mock so test URLs pass SSRF validation. */
const MOCK_PUBLIC_IPV4: dns.LookupAddress[] = [{ address: '93.184.216.34', family: 4 }];

beforeAll(async () => {
  // Clean up any leftovers from prior runs
  await pool.query(
    `DELETE FROM webhook_subscriptions
     WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`%${FILE_PREFIX}%`],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%${FILE_PREFIX}%`]);

  const admin = await createUser(ADMIN_USER);
  adminId = admin.id;
  adminActor = { id: admin.id, name: admin.name };
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM webhook_subscriptions
     WHERE created_by = $1`,
    [adminId],
  );
  // Default: all DNS lookups return a public IP so CRUD tests aren't blocked by SSRF validation.
  // Individual tests that need specific DNS behaviour call vi.spyOn(...) to override.
  vi.spyOn(dns.promises, 'lookup').mockResolvedValue(MOCK_PUBLIC_IPV4 as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // Delete subscriptions before users (FK constraint)
  await pool.query(
    `DELETE FROM webhook_subscriptions
     WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`%${FILE_PREFIX}%`],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%${FILE_PREFIX}%`]);
  await pool.end();
});

// ── CRUD tests ─────────────────────────────────────────────────────────────────

describe('createWebhookSubscription', () => {
  it('inserts a row and returns plaintextSecret', async () => {
    const { subscription, plaintextSecret } = await createWebhookSubscription(
      {
        url: 'https://example.com/hook',
        events: ['contact.created'],
        created_by: adminId,
      },
      adminActor,
    );

    expect(subscription.id).toBeDefined();
    expect(subscription.url).toBe('https://example.com/hook');
    expect(subscription.events).toEqual(['contact.created']);
    expect(subscription.status).toBe('active');
    expect(plaintextSecret).toHaveLength(64); // 32 bytes hex

    // Secret must be encrypted in storage — not equal to plaintextSecret
    expect(subscription.secret_hash).not.toBe(plaintextSecret);
    // Encrypted format is iv:authTag:ciphertext (three colon-separated parts)
    expect(subscription.secret_hash.split(':').length).toBe(3);
  });
});

describe('findWebhookSubscriptionById', () => {
  it('returns the subscription by ID', async () => {
    const { subscription: created } = await createWebhookSubscription(
      { url: 'https://example.com/hook2', events: ['deal.created'], created_by: adminId },
      adminActor,
    );

    const found = await findWebhookSubscriptionById(created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });

  it('returns null for unknown ID', async () => {
    const found = await findWebhookSubscriptionById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

describe('listWebhookSubscriptions', () => {
  it('returns all created subscriptions', async () => {
    await createWebhookSubscription(
      { url: 'https://a.example.com/hook', events: ['contact.created'], created_by: adminId },
      adminActor,
    );
    await createWebhookSubscription(
      { url: 'https://b.example.com/hook', events: ['deal.won'], created_by: adminId },
      adminActor,
    );

    const subs = await listWebhookSubscriptions();
    const urls = subs.map((s) => s.url);
    expect(urls).toContain('https://a.example.com/hook');
    expect(urls).toContain('https://b.example.com/hook');
  });
});

describe('updateWebhookSubscription', () => {
  it('updates url and events', async () => {
    const { subscription } = await createWebhookSubscription(
      { url: 'https://old.example.com/hook', events: ['contact.created'], created_by: adminId },
      adminActor,
    );

    const updated = await updateWebhookSubscription(
      subscription.id,
      { url: 'https://new.example.com/hook', events: ['deal.won', 'deal.lost'] },
      adminActor,
    );

    expect(updated?.url).toBe('https://new.example.com/hook');
    expect(updated?.events).toEqual(['deal.won', 'deal.lost']);
  });

  it('updates status to disabled', async () => {
    const { subscription } = await createWebhookSubscription(
      { url: 'https://disable.example.com/hook', events: ['contact.created'], created_by: adminId },
      adminActor,
    );

    const updated = await updateWebhookSubscription(
      subscription.id,
      { status: 'disabled' },
      adminActor,
    );
    expect(updated?.status).toBe('disabled');
  });

  it('returns null when no recognized fields are provided (no-op branch)', async () => {
    const result = await updateWebhookSubscription(
      '00000000-0000-0000-0000-000000000000',
      {} as Parameters<typeof updateWebhookSubscription>[1],
      adminActor,
    );
    expect(result).toBeNull();
  });
});

describe('deleteWebhookSubscription', () => {
  it('removes the subscription', async () => {
    const { subscription } = await createWebhookSubscription(
      { url: 'https://delete.example.com/hook', events: ['contact.created'], created_by: adminId },
      adminActor,
    );

    const deleted = await deleteWebhookSubscription(subscription.id, adminActor);
    expect(deleted?.id).toBe(subscription.id);

    const found = await findWebhookSubscriptionById(subscription.id);
    expect(found).toBeNull();
  });
});

describe('listWebhookDeliveryLogs', () => {
  it('returns paginated logs', async () => {
    const { subscription } = await createWebhookSubscription(
      { url: 'https://logs.example.com/hook', events: ['contact.created'], created_by: adminId },
      adminActor,
    );

    // Insert 3 log entries directly
    for (let i = 1; i <= 3; i++) {
      await pool.query(
        `INSERT INTO webhook_delivery_logs
           (subscription_id, event_id, event_type, attempt, status_code, response_ms)
         VALUES ($1, gen_random_uuid(), 'contact.created', $2, 200, 50)`,
        [subscription.id, i],
      );
    }

    const page1 = await listWebhookDeliveryLogs(subscription.id, { page: 1, limit: 2 });
    expect(page1.total).toBe(3);
    expect(page1.data.length).toBe(2);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);

    const page2 = await listWebhookDeliveryLogs(subscription.id, { page: 2, limit: 2 });
    expect(page2.data.length).toBe(1);
  });
});

// ── signPayload ────────────────────────────────────────────────────────────────

describe('signPayload', () => {
  it('produces a consistent HMAC-SHA256 hex digest', () => {
    const secret = 'test-secret-key';
    const body = '{"event":"contact.created"}';
    const sig1 = signPayload(body, secret);
    const sig2 = signPayload(body, secret);

    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/); // 256-bit hex
  });

  it('produces different digests for different secrets', () => {
    const body = '{"event":"contact.created"}';
    expect(signPayload(body, 'secret-a')).not.toBe(signPayload(body, 'secret-b'));
  });
});

// ── validateWebhookUrl ─────────────────────────────────────────────────────────

describe('validateWebhookUrl', () => {
  const blockedCases: Array<{ label: string; url: string; resolves?: dns.LookupAddress[] }> = [
    {
      label: 'localhost (127.0.0.1)',
      url: 'https://localhost/hook',
      resolves: [{ address: '127.0.0.1', family: 4 }],
    },
    {
      label: 'loopback range 127.x',
      url: 'https://evil.internal/hook',
      resolves: [{ address: '127.99.0.1', family: 4 }],
    },
    {
      label: 'AWS metadata 169.254.169.254',
      url: 'https://evil.internal/hook',
      resolves: [{ address: '169.254.169.254', family: 4 }],
    },
    {
      label: 'link-local 169.254.0.1',
      url: 'https://evil.internal/hook',
      resolves: [{ address: '169.254.0.1', family: 4 }],
    },
    {
      label: 'RFC 1918 10.x',
      url: 'https://evil.internal/hook',
      resolves: [{ address: '10.0.0.1', family: 4 }],
    },
    {
      label: 'RFC 1918 172.16.x',
      url: 'https://evil.internal/hook',
      resolves: [{ address: '172.16.0.1', family: 4 }],
    },
    {
      label: 'RFC 1918 172.31.x',
      url: 'https://evil.internal/hook',
      resolves: [{ address: '172.31.255.255', family: 4 }],
    },
    {
      label: 'RFC 1918 192.168.x',
      url: 'https://evil.internal/hook',
      resolves: [{ address: '192.168.1.1', family: 4 }],
    },
    {
      label: 'IPv6 loopback ::1',
      url: 'https://evil.internal/hook',
      resolves: [{ address: '::1', family: 6 }],
    },
    {
      label: 'IPv6 ULA fc00::1',
      url: 'https://evil.internal/hook',
      resolves: [{ address: 'fc00::1', family: 6 }],
    },
    {
      label: 'IPv6 ULA fd00::1',
      url: 'https://evil.internal/hook',
      resolves: [{ address: 'fd00::1', family: 6 }],
    },
  ];

  for (const { label, url, resolves } of blockedCases) {
    it(`rejects ${label}`, async () => {
      if (resolves) {
        vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce(resolves as never);
      }
      await expect(validateWebhookUrl(url)).rejects.toBeInstanceOf(WebhookUrlNotAllowedError);
    });
  }

  it('rejects HTTP URL in production', async () => {
    const original = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce(MOCK_PUBLIC_IPV4 as never);
      await expect(validateWebhookUrl('http://example.com/hook')).rejects.toBeInstanceOf(
        WebhookUrlNotAllowedError,
      );
    } finally {
      process.env['NODE_ENV'] = original;
    }
  });

  it('accepts HTTPS URL with a public IP', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce(MOCK_PUBLIC_IPV4 as never);
    await expect(validateWebhookUrl('https://example.com/hook')).resolves.toBeUndefined();
  });

  it('accepts HTTP URL in non-production environments', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce(MOCK_PUBLIC_IPV4 as never);
    await expect(validateWebhookUrl('http://example.com/hook')).resolves.toBeUndefined();
  });

  it('rejects when DNS resolution fails', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValueOnce(new Error('ENOTFOUND') as never);
    await expect(validateWebhookUrl('https://no-such-host.invalid/hook')).rejects.toBeInstanceOf(
      WebhookUrlNotAllowedError,
    );
  });

  it('rejects createWebhookSubscription with a private URL', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
      { address: '10.0.0.1', family: 4 },
    ] as never);
    await expect(
      createWebhookSubscription(
        {
          url: 'https://internal.example.com/hook',
          events: ['contact.created'],
          created_by: adminId,
        },
        adminActor,
      ),
    ).rejects.toBeInstanceOf(WebhookUrlNotAllowedError);
  });

  it('rejects updateWebhookSubscription with a private URL', async () => {
    // First create a valid subscription (mock DNS to allow it)
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce(MOCK_PUBLIC_IPV4 as never);
    const { subscription } = await createWebhookSubscription(
      { url: 'https://example.com/hook', events: ['contact.created'], created_by: adminId },
      adminActor,
    );

    // Then attempt to update to a private URL
    vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
      { address: '192.168.1.1', family: 4 },
    ] as never);
    await expect(
      updateWebhookSubscription(
        subscription.id,
        { url: 'https://internal.example.com/hook' },
        adminActor,
      ),
    ).rejects.toBeInstanceOf(WebhookUrlNotAllowedError);
  });
});

// ── dispatchWebhookEvent delivery ─────────────────────────────────────────────

describe('dispatchWebhookEvent', () => {
  it('delivers to a local HTTP server and logs the attempt', async () => {
    let receivedBody: string | null = null;
    let receivedSignature: string | null = null;

    // Start a local HTTP server to receive the webhook
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        receivedBody = body;
        receivedSignature = req.headers['x-minicrm-signature'] as string | null;
        res.writeHead(200);
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/hook`;

    // The beforeEach mock already returns MOCK_PUBLIC_IPV4 for all DNS lookups,
    // so the local 127.0.0.1 test server passes SSRF validation throughout the test.

    const { subscription, plaintextSecret } = await createWebhookSubscription(
      { url, events: ['contact.created'], created_by: adminId },
      adminActor,
    );

    // Fire the dispatch
    dispatchWebhookEvent('contact.created', { id: 'test-contact-id', email: 'test@example.com' });

    // Wait for delivery (setImmediate + HTTP round-trip)
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    expect(receivedBody).not.toBeNull();
    const payload = JSON.parse(receivedBody!) as { event: string };
    expect(payload.event).toBe('contact.created');

    // Verify HMAC signature
    const expectedSig = signPayload(receivedBody!, plaintextSecret);
    expect(receivedSignature).toBe(expectedSig);

    // Verify delivery log was written
    const logs = await listWebhookDeliveryLogs(subscription.id, { page: 1, limit: 10 });
    expect(logs.total).toBeGreaterThan(0);
    expect(logs.data[0].status_code).toBe(200);
    expect(logs.data[0].error).toBeNull();

    server.close();
  }, 10_000);

  it('records a redirect response as its raw 3xx status rather than following it (SSRF via redirect)', async () => {
    // fetch() follows redirects by default — without redirect: 'manual' in
    // attemptDelivery(), a subscription's endpoint could 302 to a blocked address
    // and bypass validateWebhookUrl()'s check of the original hostname entirely.
    let redirectTargetHit = false;
    const redirectTarget = http.createServer((_req, res) => {
      redirectTargetHit = true;
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((resolve) => redirectTarget.listen(0, '127.0.0.1', resolve));
    const { port: targetPort } = redirectTarget.address() as AddressInfo;

    const redirectingServer = http.createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/hook` });
      res.end();
    });
    await new Promise<void>((resolve) => redirectingServer.listen(0, '127.0.0.1', resolve));
    const { port } = redirectingServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/hook`;

    const { subscription } = await createWebhookSubscription(
      { url, events: ['contact.created'], created_by: adminId },
      adminActor,
    );

    dispatchWebhookEvent('contact.created', { id: 'test-contact-id', email: 'test@example.com' });
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    const logs = await listWebhookDeliveryLogs(subscription.id, { page: 1, limit: 10 });
    expect(logs.total).toBeGreaterThan(0);
    expect(logs.data[0].status_code).toBe(302);
    expect(redirectTargetHit).toBe(false);

    redirectingServer.close();
    redirectTarget.close();
  }, 10_000);
});

// ── FK ON DELETE SET NULL — user deletion preserves webhook history (MINCRM-505) ──

describe('webhook_subscriptions.created_by FK — ON DELETE SET NULL', () => {
  it('sets created_by to NULL when the owning user is deleted, and preserves the subscription row', async () => {
    const ephemeralUser = await createUser({
      email: `wh-svc-ephemeral@example.com`,
      name: 'Ephemeral Webhook Owner',
      role: 'admin',
      passwordHash: '$2b$12$placeholder_hash',
      status: 'active',
    });

    const { subscription } = await createWebhookSubscription(
      {
        url: 'https://example.com/hook',
        events: ['contact.created'],
        created_by: ephemeralUser.id,
      },
      { id: ephemeralUser.id, name: ephemeralUser.name },
    );

    // Hard-delete the user — this previously raised a FK violation
    await pool.query('DELETE FROM users WHERE id = $1', [ephemeralUser.id]);

    const found = await findWebhookSubscriptionById(subscription.id);
    expect(found).not.toBeNull();
    expect(found!.created_by).toBeNull();

    // Clean up the orphaned subscription (created_by is now NULL so the shared
    // afterAll cleanup query using WHERE created_by IN (...) would miss it)
    await pool.query('DELETE FROM webhook_subscriptions WHERE id = $1', [subscription.id]);
  });
});
