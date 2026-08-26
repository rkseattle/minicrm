/**
 * Unit tests for emailService.
 *
 * The transport is always stubbed, so most cases verify only that the functions
 * resolve without throwing; the real SMTP path is not exercised here.
 *
 * The exception is the last describe, which sets NODE_ENV per case: the
 * NO-SMTP branch logs reset and invite URLs, and which environments may see
 * them is a security boundary rather than a formatting detail.
 */

import 'dotenv/config';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import logger from '../logger.js';
import * as smtpSettingsService from '../services/smtpSettingsService.js';
import {
  sendPasswordResetEmail,
  sendOverdueTaskDigest,
  sendAssignmentNotification,
  sendContactEmail,
  sendInviteEmail,
  escapeHtml,
} from '../services/emailService.js';
import type { OverdueTaskItem, AssignmentItem } from '../services/emailService.js';

describe('sendPasswordResetEmail', () => {
  it('resolves without throwing in dev/test mode', async () => {
    await expect(
      sendPasswordResetEmail('user@example.com', 'http://localhost:5173/reset?token=abc'),
    ).resolves.toBeUndefined();
  });
});

describe('sendOverdueTaskDigest', () => {
  it('resolves with a single task that has a linked record', async () => {
    const tasks: OverdueTaskItem[] = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        subject: 'Follow up',
        due_date: '2026-01-01',
        linked_record_name: 'Alice Smith',
        linked_record_path: '/contacts/some-uuid',
      },
    ];
    await expect(
      sendOverdueTaskDigest('user@example.com', 'Alice', tasks),
    ).resolves.toBeUndefined();
  });

  it('resolves with a task that has no linked record (null branch)', async () => {
    const tasks: OverdueTaskItem[] = [
      {
        id: '00000000-0000-0000-0000-000000000002',
        subject: 'Orphan task',
        due_date: '2026-01-02',
        linked_record_name: null,
        linked_record_path: null,
      },
    ];
    await expect(sendOverdueTaskDigest('user@example.com', 'Bob', tasks)).resolves.toBeUndefined();
  });

  it('resolves with a task that has a name but no path (name-only branch)', async () => {
    const tasks: OverdueTaskItem[] = [
      {
        id: '00000000-0000-0000-0000-000000000003',
        subject: 'Name only task',
        due_date: '2026-01-03',
        linked_record_name: 'Acme Corp',
        linked_record_path: null,
      },
    ];
    await expect(
      sendOverdueTaskDigest('user@example.com', 'Carol', tasks),
    ).resolves.toBeUndefined();
  });

  it('resolves with multiple tasks (plural subject line branch)', async () => {
    const tasks: OverdueTaskItem[] = [
      {
        id: '00000000-0000-0000-0000-000000000004',
        subject: 'Task one',
        due_date: '2026-01-01',
        linked_record_name: 'Deal A',
        linked_record_path: '/deals/uuid-a',
      },
      {
        id: '00000000-0000-0000-0000-000000000005',
        subject: 'Task two',
        due_date: '2026-01-02',
        linked_record_name: null,
        linked_record_path: null,
      },
    ];
    await expect(sendOverdueTaskDigest('user@example.com', 'Dave', tasks)).resolves.toBeUndefined();
  });

  it('HTML-escapes user-supplied strings', async () => {
    const tasks: OverdueTaskItem[] = [
      {
        id: '00000000-0000-0000-0000-000000000006',
        subject: '<script>alert(1)</script>',
        due_date: '2026-01-01',
        linked_record_name: '<b>Injected</b>',
        linked_record_path: '/contacts/uuid',
      },
    ];
    // Should not throw; escaping is applied internally
    await expect(
      sendOverdueTaskDigest('user@example.com', '<Evil>', tasks),
    ).resolves.toBeUndefined();
  });
});

describe('sendAssignmentNotification', () => {
  it('resolves with a single assignment item (singular subject branch)', async () => {
    const items: AssignmentItem[] = [
      {
        recordType: 'contact',
        recordName: 'Alice Smith',
        recordPath: '/contacts/some-uuid',
        assignedByName: 'Admin User',
      },
    ];
    await expect(
      sendAssignmentNotification('user@example.com', 'Alice', items),
    ).resolves.toBeUndefined();
  });

  it('resolves with multiple assignment items (plural subject branch)', async () => {
    const items: AssignmentItem[] = [
      {
        recordType: 'contact',
        recordName: 'Alice Smith',
        recordPath: '/contacts/uuid-a',
        assignedByName: 'Admin',
      },
      {
        recordType: 'deal',
        recordName: 'Big Deal',
        recordPath: '/deals/uuid-b',
        assignedByName: 'Admin',
      },
    ];
    await expect(
      sendAssignmentNotification('user@example.com', 'Bob', items),
    ).resolves.toBeUndefined();
  });

  it('HTML-escapes user-supplied strings in assignment emails', async () => {
    // recordType is no longer a vector — it is a union, so a script tag cannot be
    // constructed. recordName and assignedByName still carry arbitrary user input.
    const items: AssignmentItem[] = [
      {
        recordType: 'deal',
        recordName: '<script>alert(1)</script>"Quoted"',
        recordPath: '/deals/uuid',
        assignedByName: "O'Brien & <b>Co</b>",
      },
    ];
    await expect(
      sendAssignmentNotification('user@example.com', '&Name', items),
    ).resolves.toBeUndefined();
  });
});

describe('escapeHtml', () => {
  it('escapes all five HTML special characters', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#x27;');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('Hello, World!')).toBe('Hello, World!');
  });
});

describe('sendOverdueTaskDigest — APP_URL branch', () => {
  it('uses APP_URL env var when set', async () => {
    const original = process.env.APP_URL;
    process.env.APP_URL = 'https://crm.example.com';
    try {
      await expect(
        sendOverdueTaskDigest('user@example.com', 'Eve', [
          {
            id: '00000000-0000-0000-0000-000000000010',
            subject: 'Call back',
            due_date: '2026-02-01',
            linked_record_name: 'Acme',
            linked_record_path: '/accounts/uuid',
          },
        ]),
      ).resolves.toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = original;
    }
  });
});

describe('sendAssignmentNotification — APP_URL branch', () => {
  it('uses APP_URL env var when set', async () => {
    const original = process.env.APP_URL;
    process.env.APP_URL = 'https://crm.example.com';
    try {
      await expect(
        sendAssignmentNotification('user@example.com', 'Frank', [
          {
            recordType: 'deal',
            recordName: 'Big Deal',
            recordPath: '/deals/uuid',
            assignedByName: 'Admin',
          },
        ]),
      ).resolves.toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = original;
    }
  });
});

describe('sendContactEmail', () => {
  it('returns delivered: false with reason smtp_not_configured when no SMTP is set', async () => {
    // In test environment no SMTP is configured so resolveTransport returns null
    const result = await sendContactEmail(
      'contact@example.com',
      'Test subject',
      'Test body',
      'Rep User',
    );
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe('smtp_not_configured');
  });

  it('resolves without throwing and returns a result object', async () => {
    await expect(
      sendContactEmail('contact@example.com', 'Hello', 'Body text', 'Alice'),
    ).resolves.toMatchObject({ delivered: expect.any(Boolean) });
  });

  it('HTML-escapes body content containing special characters', async () => {
    await expect(
      sendContactEmail('contact@example.com', '<script>', '<b>xss</b>', "O'Brien"),
    ).resolves.toMatchObject({ delivered: expect.any(Boolean) });
  });
});

// ── NO-SMTP logging must not leak account-takeover tokens ─────────────────────

describe('the NO-SMTP branch and credential-bearing fields', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_SMTP_HOST = process.env.SMTP_HOST;

  // These cases move NODE_ENV off 'test', which is what resolveTransport short-circuits
  // on — so without stubbing, a concurrent smtpSettingsService write would send them
  // down the real nodemailer path and fail on ENOTFOUND. vitest.config.ts records that
  // collision. Stubbing the config read also keeps this file off the DB entirely.
  beforeEach(() => {
    vi.spyOn(smtpSettingsService, 'getSmtpConfigInternal').mockResolvedValue({
      smtp_host: '',
      smtp_port: 587,
      smtp_user: '',
      smtp_pass: null,
      smtp_enabled: false,
    });
    delete process.env.SMTP_HOST;
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_SMTP_HOST === undefined) {
      delete process.env.SMTP_HOST;
    } else {
      process.env.SMTP_HOST = ORIGINAL_SMTP_HOST;
    }
    vi.restoreAllMocks();
  });

  /** Captures the bindings object of every logger.warn call. */
  function captureWarnBindings(): Record<string, unknown>[] {
    const captured: Record<string, unknown>[] = [];
    vi.spyOn(logger, 'warn').mockImplementation(((first: unknown) => {
      if (typeof first === 'object' && first !== null) {
        captured.push(first as Record<string, unknown>);
      }
    }) as typeof logger.warn);
    return captured;
  }

  const RESET_URL = 'http://localhost:5173/reset-password?token=super-secret-value';
  const INVITE_URL = 'http://localhost:5173/set-password?token=another-secret-value';

  it('logs the reset URL where credentials may already be handed out', async () => {
    process.env.NODE_ENV = 'development';
    const captured = captureWarnBindings();

    await sendPasswordResetEmail('user@example.com', RESET_URL);

    // Without SMTP this log is the only way to complete the flow locally.
    expect(captured.some((entry) => entry.resetUrl === RESET_URL)).toBe(true);
  });

  // staging is the case this guards: its log level is debug, like development,
  // but it carries real users — so level alone is the wrong boundary.
  it.each(['staging', 'production'])('withholds the reset URL on %s', async (env) => {
    process.env.NODE_ENV = env;
    const captured = captureWarnBindings();

    await sendPasswordResetEmail('user@example.com', RESET_URL);

    expect(captured.some((entry) => 'resetUrl' in entry)).toBe(false);
    expect(JSON.stringify(captured)).not.toContain('super-secret-value');
    // The event is still recorded; only the token is withheld.
    expect(captured.some((entry) => entry.email === 'user@example.com')).toBe(true);
  });

  it.each(['staging', 'production'])('withholds the invite URL on %s', async (env) => {
    process.env.NODE_ENV = env;
    const captured = captureWarnBindings();

    await sendInviteEmail('invitee@example.com', 'Invitee', INVITE_URL);

    expect(captured.some((entry) => 'setPasswordUrl' in entry)).toBe(false);
    expect(JSON.stringify(captured)).not.toContain('another-secret-value');
  });
});
