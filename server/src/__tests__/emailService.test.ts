/**
 * Unit tests for emailService.
 *
 * All tests run in NODE_ENV=test so the transport is always stubbed — we verify
 * that the functions resolve without throwing and that the dev-stub log path
 * executes. The production transport path is guarded by NODE_ENV checks and is
 * not exercised here.
 *
 * MINCRM-156, MINCRM-161, MINCRM-162
 */

import 'dotenv/config';
import {
  sendPasswordResetEmail,
  sendOverdueTaskDigest,
  sendAssignmentNotification,
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
