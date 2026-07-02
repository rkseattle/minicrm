/**
 * HTTP contract tests for the notification feed endpoints. (MINCRM-469)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createNotification } from '../services/notificationFeedService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'notif-feed-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let repCookie: string;
let repId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Notification Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
});

beforeEach(async () => {
  await pool.query('DELETE FROM notifications WHERE user_id = $1', [repId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM notifications WHERE user_id = $1', [repId]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('GET /api/v1/notifications', () => {
  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/notifications').expect(401);
  });

  it('returns the feed for an authenticated user', async () => {
    await createNotification({ userId: repId, type: 'churn_risk_detected', title: 'Test' });
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.unread_count).toBe(1);
  });
});

describe('POST /api/v1/notifications/:id/read', () => {
  it('marks a notification as read', async () => {
    await createNotification({ userId: repId, type: 'churn_risk_detected', title: 'Test' });
    const feedRes = await request(app)
      .get('/api/v1/notifications')
      .set('Cookie', repCookie)
      .expect(200);
    const notificationId = feedRes.body.notifications[0].id;

    const res = await request(app)
      .post(`/api/v1/notifications/${notificationId}/read`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.unread_count).toBe(0);
  });
});

describe('POST /api/v1/notifications/read-all', () => {
  it('marks all notifications as read', async () => {
    await createNotification({ userId: repId, type: 'churn_risk_detected', title: 'A' });
    await createNotification({ userId: repId, type: 'churn_risk_detected', title: 'B' });

    const res = await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.unread_count).toBe(0);
  });
});
