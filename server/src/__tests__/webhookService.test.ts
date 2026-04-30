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
import http from 'http';
import type { AddressInfo } from 'net';
import {
  createWebhookSubscription,
  findWebhookSubscriptionById,
  listWebhookSubscriptions,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveryLogs,
  dispatchWebhookEvent,
  signPayload,
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

    const updated = await updateWebhookSubscription(subscription.id, { status: 'disabled' }, adminActor);
    expect(updated?.status).toBe('disabled');
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
});
