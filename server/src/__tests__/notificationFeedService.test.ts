/**
 * Integration tests for notificationFeedService.
 * Runs against a real PostgreSQL test database.
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import {
  createNotification,
  getNotificationFeed,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/notificationFeedService.js';

const FILE_PREFIX = 'notif-feed-svc';

let userId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const user = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Notification Feed Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  userId = user.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('createNotification / getNotificationFeed', () => {
  it('returns an empty feed with zero unread for a user with no notifications', async () => {
    const feed = await getNotificationFeed(userId);
    expect(feed.notifications).toEqual([]);
    expect(feed.unread_count).toBe(0);
  });

  it('returns created notifications ordered most-recent-first with correct unread count', async () => {
    await createNotification({ userId, type: 'churn_risk_detected', title: 'First' });
    await createNotification({ userId, type: 'churn_risk_detected', title: 'Second' });

    const feed = await getNotificationFeed(userId);
    expect(feed.notifications).toHaveLength(2);
    expect(feed.notifications[0].title).toBe('Second');
    expect(feed.unread_count).toBe(2);
  });

  it('persists optional body and link_path fields', async () => {
    await createNotification({
      userId,
      type: 'churn_risk_detected',
      title: 'Churn risk: Acme Corp',
      body: 'No activity logged in 45 days',
      linkPath: '/accounts/abc123',
    });

    const feed = await getNotificationFeed(userId);
    expect(feed.notifications[0].body).toBe('No activity logged in 45 days');
    expect(feed.notifications[0].link_path).toBe('/accounts/abc123');
  });
});

describe('markNotificationRead', () => {
  it('marks a single notification as read and decrements the unread count', async () => {
    await createNotification({ userId, type: 'churn_risk_detected', title: 'A' });
    await createNotification({ userId, type: 'churn_risk_detected', title: 'B' });

    const before = await getNotificationFeed(userId);
    expect(before.unread_count).toBe(2);

    await markNotificationRead(before.notifications[0].id, userId);

    const after = await getNotificationFeed(userId);
    expect(after.unread_count).toBe(1);
    expect(
      after.notifications.find((n) => n.id === before.notifications[0].id)?.read_at,
    ).not.toBeNull();
  });

  it("does not mark another user's notification as read", async () => {
    const otherUser = await createUser({
      email: `${FILE_PREFIX}-other@example.com`,
      name: 'Other User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder_hash',
      status: 'active',
    });
    await createNotification({
      userId: otherUser.id,
      type: 'churn_risk_detected',
      title: 'Not mine',
    });
    const otherFeed = await getNotificationFeed(otherUser.id);

    await markNotificationRead(otherFeed.notifications[0].id, userId);

    const stillUnread = await getNotificationFeed(otherUser.id);
    expect(stillUnread.unread_count).toBe(1);

    await pool.query('DELETE FROM notifications WHERE user_id = $1', [otherUser.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [otherUser.id]);
  });
});

describe('markAllNotificationsRead', () => {
  it('marks every unread notification as read', async () => {
    await createNotification({ userId, type: 'churn_risk_detected', title: 'A' });
    await createNotification({ userId, type: 'churn_risk_detected', title: 'B' });
    await createNotification({ userId, type: 'churn_risk_detected', title: 'C' });

    await markAllNotificationsRead(userId);

    const feed = await getNotificationFeed(userId);
    expect(feed.unread_count).toBe(0);
  });
});
