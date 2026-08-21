# MiniCRM Webhook Integration Guide

MiniCRM can notify your systems of CRM events in real time via outbound webhooks.
When a contact is created, a deal stage changes, or any other supported event fires,
MiniCRM POSTs a signed JSON payload to the URL(s) you register.

This guide is for developers building systems that consume MiniCRM events.

---

## Contents

1. [Overview](#1-overview)
2. [Subscription management](#2-subscription-management)
3. [Available event types](#3-available-event-types)
4. [Payload structure](#4-payload-structure)
5. [Payload verification (HMAC-SHA256)](#5-payload-verification-hmac-sha256)
6. [Delivery and retries](#6-delivery-and-retries)
7. [Failure handling](#7-failure-handling)
8. [Delivery logs](#8-delivery-logs)
9. [Example receiver (Node.js / Express)](#9-example-receiver-nodejs--express)

---

## 1. Overview

- MiniCRM sends an HTTP **POST** request to your endpoint URL when a subscribed event fires.
- The request body is a **JSON** payload describing the event and the affected record.
- Every delivery is signed with **HMAC-SHA256** so your receiver can verify the payload
  came from MiniCRM and was not tampered with in transit.
- Failed deliveries are retried on a fixed schedule, up to 5 attempts total. Pending
  retries are held **in memory** and are lost if the server restarts — see
  [Delivery and retries](#6-delivery-and-retries).
- All webhook management endpoints are **admin-only**.

---

## 2. Subscription management

### Create a subscription

```
POST /api/v1/admin/webhooks
Authorization: (admin JWT cookie or Bearer token)
Content-Type: application/json

{
  "url": "https://yourapp.example.com/webhooks/minicrm",
  "events": ["contact.created", "deal.stage_changed"]
}
```

#### Response

```json
{
  "id": "a1b2c3d4-...",
  "url": "https://yourapp.example.com/webhooks/minicrm",
  "events": ["contact.created", "deal.stage_changed"],
  "status": "active",
  "created_by": "<user-uuid>",
  "created_at": "2026-05-29T10:00:00.000Z",
  "plaintextSecret": "4f9a2c..."
}
```

> **Save `plaintextSecret` immediately.** It is returned **only once** at creation
> time and cannot be retrieved later. Store it securely (e.g. in your secrets manager).
> It is used to verify webhook signatures.

### List subscriptions

```
GET /api/v1/admin/webhooks
```

Returns all subscriptions. The `plaintextSecret` is never included in list or get responses.

### Update a subscription

```
PATCH /api/v1/admin/webhooks/:id
Content-Type: application/json

{
  "url": "https://yourapp.example.com/webhooks/minicrm-v2",
  "events": ["contact.created", "contact.updated"],
  "status": "disabled"
}
```

All fields are optional. `status` accepts `"active"` or `"disabled"` — setting it to
`"failed"` is not allowed (that status is set automatically by the system).

### Delete a subscription

```
DELETE /api/v1/admin/webhooks/:id
```

Returns `204 No Content`. All delivery logs for the subscription are also deleted.

---

## 3. Available event types

| Event type           | Fires when                                     |
| -------------------- | ---------------------------------------------- |
| `contact.created`    | A new contact is created                       |
| `contact.updated`    | A contact's fields are changed                 |
| `contact.deleted`    | A contact is deleted                           |
| `account.created`    | A new account is created                       |
| `account.updated`    | An account's fields are changed                |
| `account.deleted`    | An account is deleted                          |
| `deal.created`       | A new deal is created                          |
| `deal.updated`       | A deal's fields are changed (other than stage) |
| `deal.stage_changed` | A deal's stage changes                         |
| `deal.won`           | A deal is moved to _Closed Won_                |
| `deal.lost`          | A deal is moved to _Closed Lost_               |
| `deal.deleted`       | A deal is deleted                              |
| `activity.created`   | A new activity is logged                       |
| `activity.completed` | An activity's status is set to _complete_      |
| `user.invited`       | A new user is invited                          |
| `user.activated`     | A user's status becomes _active_               |
| `user.deactivated`   | A user's status becomes _inactive_             |

A single action can fire multiple events. For example, moving a deal to _Closed Won_
fires `deal.stage_changed`, `deal.won`, and `deal.updated` if other fields changed.

**Bulk operations almost never fire events.** The table above describes single-record
changes. A bulk edit or bulk delete — of contacts, accounts, users, activities, leads, or
deals — emits nothing, with one exception: a bulk deal-stage change fires
`deal.stage_changed`, and `deal.won` / `deal.lost` where they apply. It does not fire
`deal.updated`.

So a bulk delete of 500 contacts produces no `contact.deleted` events at all, and a
subscriber listening only for `deal.updated` misses every stage move made in bulk. If
your integration must observe every change, reconcile against the REST API rather than
relying on the event stream alone.

---

## 4. Payload structure

Every webhook POST body follows this envelope:

```json
{
  "event": "contact.created",
  "event_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "timestamp": "2026-05-29T14:23:01.123Z",
  "delivery_attempt": 1,
  "data": {/* full current state of the affected record */}
}
```

For `*.updated` and `deal.stage_changed` events a `previous_data` key is also present:

```json
{
  "event": "deal.stage_changed",
  "event_id": "...",
  "timestamp": "...",
  "delivery_attempt": 1,
  "data": {
    "id": "...",
    "name": "Acme — Enterprise licence",
    "stage": "Negotiation",
    "value": 25000,
    "currency": "USD",
    "owner_id": "...",
    "...": "..."
  },
  "previous_data": {
    "id": "...",
    "name": "Acme — Enterprise licence",
    "stage": "Qualification",
    "value": 25000,
    "currency": "USD",
    "owner_id": "...",
    "...": "..."
  }
}
```

### `contact.created` example

```json
{
  "event": "contact.created",
  "event_id": "a1b2c3d4-0000-0000-0000-000000000001",
  "timestamp": "2026-05-29T09:00:00.000Z",
  "delivery_attempt": 1,
  "data": {
    "id": "c1000000-0000-0000-0000-000000000001",
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@example.com",
    "phone": "+1-555-0100",
    "job_title": "VP Sales",
    "account_id": null,
    "owner_id": "u1000000-0000-0000-0000-000000000001",
    "created_at": "2026-05-29T09:00:00.000Z",
    "updated_at": "2026-05-29T09:00:00.000Z"
  }
}
```

#### `deal.won` example

```json
{
  "event": "deal.won",
  "event_id": "a1b2c3d4-0000-0000-0000-000000000002",
  "timestamp": "2026-05-29T15:00:00.000Z",
  "delivery_attempt": 1,
  "data": {
    "id": "d1000000-0000-0000-0000-000000000001",
    "name": "Acme — Enterprise licence",
    "stage": "Closed Won",
    "value": "25000.00",
    "currency": "USD",
    "probability": 100,
    "close_date": "2026-05-29",
    "account_id": "acc00000-0000-0000-0000-000000000001",
    "owner_id": "u1000000-0000-0000-0000-000000000001",
    "created_at": "2026-04-01T10:00:00.000Z",
    "updated_at": "2026-05-29T15:00:00.000Z"
  }
}
```

---

## 5. Payload verification (HMAC-SHA256)

Every delivery includes an `X-MiniCRM-Signature` header containing the HMAC-SHA256
hex digest of the raw request body, signed with your subscription's secret.

### How to verify

1. Read the raw request body **as bytes** — do not parse JSON first.
2. Compute `HMAC-SHA256(rawBody, secret)` using your subscription's `plaintextSecret`.
3. Compare your computed digest with the value in `X-MiniCRM-Signature`.
4. **Use constant-time comparison** to prevent timing attacks (see example below).
5. Reject the request if the digests do not match.

### Why constant-time comparison?

A naive string comparison (`===`) can leak timing information: it short-circuits on
the first non-matching byte. An attacker could use the response time difference to
brute-force the signature one byte at a time. `crypto.timingSafeEqual` prevents this
by always comparing every byte regardless of where the mismatch occurs.

---

## 6. Delivery and retries

MiniCRM considers a delivery **successful** when your endpoint returns a `2xx` HTTP
status code within 10 seconds.

Any other outcome — non-2xx response, timeout, or network error — is treated as a
failure and triggers the retry schedule:

| Attempt     | Delay after previous attempt |
| ----------- | ---------------------------- |
| 1 (initial) | Immediately                  |
| 2           | 5 minutes                    |
| 3           | 30 minutes                   |
| 4           | 2 hours                      |
| 5           | 6 hours                      |

After 5 failed attempts the subscription is automatically set to `failed` status and
no further deliveries are made.

### Retries are held in memory, and a restart drops them

**Pending retries do not survive a server restart or crash.** They are scheduled with an
in-process timer; nothing about a waiting retry is persisted, and there is no recovery
pass on startup. A deploy during the retry window silently abandons every attempt still
queued — and because the schedule spans up to 8 hours 35 minutes from the first attempt,
that window is wide.

What the drop looks like from your side:

- Each attempt **is** logged as it happens, so the event's last delivery-log row shows
  the failure that scheduled the doomed retry.
- No row is ever written for the abandoned attempt, so the event simply stops — the log
  ends mid-schedule with no terminal entry.
- The subscription stays `active`. It is only set to `failed` after a fifth attempt
  actually runs, which in this case never happens.

Why this has not been fixed, and what fixing it would involve, is recorded in
[ADR-004](adr/004-webhook-retries-in-memory.md).

**Do not rely on the retry schedule as a delivery guarantee.** Reconcile from your side:
poll `GET /api/v1/admin/webhooks/:id/logs` (see [Delivery logs](#8-delivery-logs)) and
treat an event whose most recent attempt failed, with no later attempt and no `failed`
status on the subscription, as one you need to re-request from the REST API.

### Receiver requirements

- Respond with a `2xx` status code as quickly as possible — ideally before doing any
  processing. Enqueue the payload for async handling if your processing takes time.
- If you cannot process a payload, respond with `2xx` anyway and discard it — returning
  a non-2xx will cause unnecessary retries.
- Your endpoint must respond within **10 seconds** to avoid a timeout.

---

## 7. Failure handling

When a subscription enters `failed` status:

- No further events are delivered to that URL.
- The subscription remains visible in `GET /api/v1/admin/webhooks` with `"status": "failed"`.
- To re-enable it, send:

```
PATCH /api/v1/admin/webhooks/:id
Content-Type: application/json

{ "status": "active" }
```

Once re-enabled, new events are delivered normally. Events that fired while the
subscription was failed are **not** replayed.

### Temporarily disabling a subscription

To pause delivery without triggering the failure state (e.g. for planned maintenance):

```
PATCH /api/v1/admin/webhooks/:id
Content-Type: application/json

{ "status": "disabled" }
```

Re-enable with `{ "status": "active" }` when ready. Events fired while disabled are
not replayed.

---

## 8. Delivery logs

```
GET /api/v1/admin/webhooks/:id/logs?page=1&limit=20
```

Returns a paginated list of delivery attempts for the subscription, most recent first.

```json
{
  "data": [
    {
      "id": "<uuid>",
      "subscription_id": "<uuid>",
      "event_id": "<uuid>",
      "event_type": "contact.created",
      "attempt": 1,
      "status_code": 200,
      "response_ms": 142,
      "error": null,
      "delivered_at": "2026-05-29T14:23:01.500Z"
    },
    {
      "id": "<uuid>",
      "subscription_id": "<uuid>",
      "event_id": "<uuid>",
      "event_type": "deal.updated",
      "attempt": 2,
      "status_code": null,
      "response_ms": 10001,
      "error": "Request timeout",
      "delivered_at": "2026-05-29T13:00:00.000Z"
    }
  ],
  "total": 47,
  "page": 1,
  "limit": 20
}
```

`error` is non-null when the attempt failed due to a network error or timeout.
`status_code` is null when no HTTP response was received.

---

## 9. Example receiver (Node.js / Express)

A minimal Express server that verifies the signature and acknowledges the event:

```js
import express from 'express';
import crypto from 'crypto';

const app = express();
const WEBHOOK_SECRET = process.env.MINICRM_WEBHOOK_SECRET; // your plaintextSecret

// Parse the raw body so we can verify the signature before JSON.parse
app.use('/webhooks/minicrm', express.raw({ type: 'application/json' }));

app.post('/webhooks/minicrm', (req, res) => {
  const signature = req.headers['x-minicrm-signature'];

  if (!signature || !WEBHOOK_SECRET) {
    return res.status(401).send('Missing signature');
  }

  // Compute expected signature
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(req.body) // req.body is a Buffer when using express.raw()
    .digest('hex');

  // Constant-time comparison — prevents timing attacks
  const sigBuffer = Buffer.from(signature, 'hex');
  const expBuffer = Buffer.from(expected, 'hex');

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return res.status(401).send('Invalid signature');
  }

  // Signature verified — safe to parse and process
  const event = JSON.parse(req.body.toString());
  console.log('Received event:', event.event, 'id:', event.event_id);

  // Acknowledge immediately; process asynchronously
  res.status(200).send('OK');

  // TODO: enqueue event for processing
});

app.listen(3001, () => console.log('Webhook receiver listening on port 3001'));
```

Key points:

- Use `express.raw()` (not `express.json()`) so `req.body` is the unmodified buffer
  needed for signature verification.
- Respond `200 OK` before doing any heavy processing. If processing fails, you can
  log or retry internally — returning a non-2xx will cause MiniCRM to retry delivery.
- Store `MINICRM_WEBHOOK_SECRET` in an environment variable or secrets manager,
  never hard-coded.
