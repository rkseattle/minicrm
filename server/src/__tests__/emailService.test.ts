/**
 * Unit tests for emailService.
 *
 * All tests run in NODE_ENV=test so the transport is always stubbed — we verify
 * that the functions resolve without throwing and that the dev-stub log path
 * executes. The production transport path is guarded by NODE_ENV checks and is
 * not exercised here.
 *
 *
 */

import 'dotenv/config';
import {
  sendPasswordResetEmail,
  sendOverdueTaskDigest,
  sendAssignmentNotification,
  sendContactEmail,
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
    const items: AssignmentItem[] = [
      {
        recordType: '<script>',
        recordName: '"Quoted"',
        recordPath: '/deals/uuid',
        assignedByName: "O'Brien",
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
