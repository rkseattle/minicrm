# MiniCRM REST API Reference

This document covers authentication, error handling, pagination, and all resource
endpoints exposed by the MiniCRM REST API. It is aimed at developers building
integrations against a MiniCRM instance.

An interactive Swagger UI is available at `/api-docs` on dev and staging instances.

---

## Contents

1. [Authentication](#1-authentication)
2. [Error shape](#2-error-shape)
3. [Pagination](#3-pagination)
4. [Contacts](#4-contacts)
5. [Accounts](#5-accounts)
6. [Deals](#6-deals)
7. [Activities](#7-activities)
8. [Leads](#8-leads)
9. [Notes](#9-notes)
10. [Tags](#10-tags)
11. [Attachments](#11-attachments)
12. [Users](#12-users-admin-only)
13. [Settings](#13-settings)
14. [Audit Log](#14-audit-log)
15. [gRPC / ConnectRPC — AuditService](#15-grpc--connectrpc--auditservice)

---

## 1. Authentication

MiniCRM uses JWT tokens stored in an `httpOnly` cookie. All authenticated endpoints
require this cookie to be present.

### Login flow

```
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "s3cr3t" }
```

On success the server responds with `200 OK` and sets a `minicrm_token` cookie:

```
HTTP/1.1 200 OK
Set-Cookie: minicrm_token=<jwt>; HttpOnly; SameSite=Lax; Max-Age=1800
```

The cookie name is configurable via the `AUTH_COOKIE_NAME` environment variable, so two
stacks on one host can hold independent sessions. All subsequent requests to
authenticated endpoints must include the cookie (browsers do this automatically on
same-origin requests).

### Session lifetime — read this before writing a client

Two separate limits apply, and confusing them is the most common integration mistake:

| Limit        | Value          | Measured from        | Extendable         |
| ------------ | -------------- | -------------------- | ------------------ |
| Idle window  | **30 minutes** | the last token issue | yes, by refreshing |
| Absolute cap | **8 hours**    | original login       | **no**             |

The token itself is valid for 30 minutes. Verifying a request does **not** re-issue it —
a client that never refreshes is rejected 30 minutes after login no matter how many
requests it made in between.

### Keeping a session alive

```
POST /api/v1/auth/refresh
```

Returns `200 { "ok": true }` and sets a new cookie carrying a fresh 30-minute window.
Call it while the session is still valid — the browser client does so on user activity,
a few minutes before expiry.

Refreshing preserves the original `login_at` claim, so it cannot push a session past the
8-hour absolute cap. Once that cap is reached, refresh returns:

```
HTTP/1.1 401 Unauthorized
{ "error": { "code": "AUTH_SESSION_ABSOLUTE_TIMEOUT", "message": "..." } }
```

A server-to-server integration must handle this by logging in again, not by retrying the
refresh.

The cap is evaluated against the token's own issue time, so the last token minted before
the 8-hour mark stays usable until its 30-minute window lapses. Treat 8 hours as the
point after which no _new_ token is issued, not as a hard cutoff on the current one.

### `must_change_password` state

If the user's password was set by an admin they are flagged to change it on first login.
Any authenticated request other than `POST /api/v1/auth/change-password` returns:

```
HTTP/1.1 403 Forbidden
{ "error": { "code": "PASSWORD_CHANGE_REQUIRED", "message": "..." } }
```

### Logout

```
POST /api/v1/auth/logout
```

Clears the cookie. Returns `200 OK`.

### Rate limiting

`POST /api/v1/auth/login` and `POST /api/v1/auth/forgot-password` are rate-limited.
Exceeding the limit returns `429 Too Many Requests`.

---

## 2. Error shape

All error responses use a consistent JSON envelope:

```json
{
  "error": {
    "code": "SCREAMING_SNAKE_CASE_DOMAIN_CODE",
    "message": "Human-readable description"
  }
}
```

### HTTP status to error code mapping

| HTTP status | When used                                                               |
| ----------- | ----------------------------------------------------------------------- |
| `400`       | Validation failure (`VALIDATION_ERROR`) or bad input                    |
| `401`       | Missing or expired JWT                                                  |
| `403`       | Authenticated but forbidden (wrong role, or `PASSWORD_CHANGE_REQUIRED`) |
| `404`       | Record not found                                                        |
| `409`       | Conflict — e.g. duplicate email (`CONTACT_EMAIL_DUPLICATE`)             |
| `422`       | Semantic error — e.g. blocked webhook URL (`WEBHOOK_URL_NOT_ALLOWED`)   |
| `429`       | Rate limit exceeded                                                     |
| `500`       | Unexpected server error                                                 |

### Common error codes

| Code                       | Status | Meaning                                                        |
| -------------------------- | ------ | -------------------------------------------------------------- |
| `VALIDATION_ERROR`         | 400    | Zod validation failed; `message` names the first invalid field |
| `CONTACT_EMAIL_DUPLICATE`  | 409    | A contact with that email already exists                       |
| `DEAL_STAGE_NOT_FOUND`     | 400    | The requested pipeline stage does not exist                    |
| `PIPELINE_STAGE_IN_USE`    | 409    | Cannot delete a stage that has deals in it                     |
| `PIPELINE_STAGE_FIXED`     | 409    | Cannot modify a fixed stage (Closed Won / Closed Lost)         |
| `USER_EMAIL_DUPLICATE`     | 409    | A user with that email already exists                          |
| `WEBHOOK_URL_NOT_ALLOWED`  | 422    | URL resolves to a blocked/private IP range                     |
| `PASSWORD_CHANGE_REQUIRED` | 403    | User must change their password before proceeding              |

---

## 3. Pagination

List endpoints that support pagination accept the following query parameters:

| Parameter | Type    | Default | Notes                                  |
| --------- | ------- | ------- | -------------------------------------- |
| `page`    | integer | `1`     | 1-based page number                    |
| `limit`   | integer | `20`    | Items per page; max varies by endpoint |

Paginated responses always include a wrapper object:

```json
{
  "data": [/* array of items */],
  "total": 143,
  "page": 2,
  "limit": 20
}
```

---

## 4. Contacts

### List contacts

```
GET /api/contacts
```

Query parameters: `page`, `limit`, `search` (name/email substring), `tag`, `owner`,
`sort` (`first_name` | `email` | `created_at`), `dir` (`asc` | `desc`).

Returns a paginated list of contact objects.

### Get a contact

```
GET /api/contacts/:id
```

### Create a contact

```
POST /api/contacts
Content-Type: application/json

{
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "jane@example.com",
  "phone": "+1-555-0100",
  "job_title": "VP Sales",
  "account_id": "<uuid>",
  "owner_id": "<uuid>"
}
```

`first_name` and `email` are required. `email` must be unique. Returns `201 Created`.

### Update a contact

```
PATCH /api/contacts/:id
Content-Type: application/json

{ "job_title": "CRO" }
```

Partial update — only supply the fields you want to change. Ownership enforced:
reps can only update contacts they own; admins can update any.

### Delete a contact

```
DELETE /api/contacts/:id
```

Ownership enforced. Returns `204 No Content`.

### Merge contacts

```
POST /api/contacts/:id/merge
Content-Type: application/json

{
  "loser_id": "<uuid>",
  "field_choices": {
    "email": "winner",
    "phone": "loser"
  }
}
```

Merges two contacts. The contact at `:id` is the winner (survives). `loser_id` is
deleted. `field_choices` controls which record's value is kept for each field
(`"winner"` or `"loser"`). All linked deals, activities, and notes are re-routed
to the winner. Admin only.

### GDPR erasure

```
POST /api/contacts/:id/gdpr-erase
```

Blanks the contact's personal fields and writes an erasure record to the audit log.
Admin only. Irreversible.

---

## 5. Accounts

### List accounts

```
GET /api/accounts
```

Query parameters: `page`, `limit`, `search`, `type`, `owner`, `sort`, `dir`.

### Search accounts

```
GET /api/accounts/search?q=acme
```

Returns a lightweight list (id + name) for use in typeahead/autocomplete widgets.

### Get an account

```
GET /api/accounts/:id
```

### Get child accounts

```
GET /api/accounts/:id/children
```

Returns direct children (subsidiaries) of the account.

### Create an account

```
POST /api/accounts
Content-Type: application/json

{
  "name": "Acme Corp",
  "account_type": "Customer",
  "website": "https://acme.example.com",
  "parent_account_id": "<uuid>"
}
```

`name` is required.

### Update / delete an account

```
PATCH /api/accounts/:id
DELETE /api/accounts/:id
```

Ownership enforced.

---

## 6. Deals

### List deals

```
GET /api/deals
```

Query parameters: `page`, `limit`, `stage`, `owner`, `account_id`, `search`,
`sort`, `dir`.

### Get a deal

```
GET /api/deals/:id
```

### Create a deal

```
POST /api/deals
Content-Type: application/json

{
  "name": "Acme — Enterprise licence",
  "value": 25000,
  "currency": "USD",
  "stage": "Qualification",
  "probability": 30,
  "close_date": "2026-09-30",
  "account_id": "<uuid>",
  "owner_id": "<uuid>",
  "pipeline_id": "<uuid>"
}
```

`name` is required. `stage` must match an existing pipeline stage name. `currency`
defaults to the org's default currency. `probability` defaults to the stage default
if omitted.

### Update a deal

```
PATCH /api/deals/:id
```

Partial update. Moving a deal to _Closed Won_ or _Closed Lost_ forces probability
to 100% or 0% respectively. Ownership enforced.

### Delete a deal

```
DELETE /api/deals/:id
```

### Pipeline board

```
GET /api/deals/board
```

Returns deals grouped by stage, suitable for rendering a Kanban board.

### Move a deal (stage drag-and-drop)

```
PATCH /api/deals/:id/stage
Content-Type: application/json

{ "stage": "Negotiation" }
```

Convenience endpoint for board drag-and-drop. Equivalent to `PATCH /api/deals/:id`
with `{ "stage": "..." }`.

#### Multi-currency notes

- `value` is stored as-is in `deals.currency`.
- Dashboard totals convert all values to the org default currency for display.
- MiniCRM does not fetch live exchange rates; conversion is informational.

---

## 7. Activities

### List activities

```
GET /api/activities
```

Query parameters: `page`, `limit`, `type`, `status`, `contact`, `account`, `deal`,
`owner` (pass `me` to filter to the authenticated user).

### Get an activity

```
GET /api/activities/:id
```

### My tasks

```
GET /api/activities/my-tasks
```

Returns open Task-type activities for the authenticated user. Each item includes
`linked_record_name` and `linked_record_type` joined from the parent record.

### Create an activity

```
POST /api/activities
Content-Type: application/json

{
  "type": "Call",
  "subject": "Discovery call with Jane",
  "status": "complete",
  "direction": "Outbound",
  "outcome": "Positive — moving to proposal",
  "contact_id": "<uuid>",
  "deal_id": "<uuid>",
  "owner_id": "<uuid>",
  "due_date": "2026-06-01"
}
```

At least one of `contact_id`, `account_id`, or `deal_id` is required. `type` must be
one of: `Note`, `Call`, `Email`, `Meeting`, `Task`.

### Update / delete an activity

```
PATCH /api/activities/:id
DELETE /api/activities/:id
```

Ownership enforced.

---

## 8. Leads

### List leads

```
GET /api/leads
```

Query parameters: `page`, `limit`, `status`, `owner`, `search`, `sort`, `dir`.

### Get a lead

```
GET /api/leads/:id
```

### Lead status history

```
GET /api/leads/:id/status-history
```

Returns the full history of status transitions for the lead.

### Create a lead

```
POST /api/leads
Content-Type: application/json

{
  "first_name": "Bob",
  "last_name": "Jones",
  "email": "bob@prospect.com",
  "company_name": "Prospect Inc",
  "lead_source": "Referral",
  "owner_id": "<uuid>"
}
```

`first_name` is required.

### Update a lead

```
PATCH /api/leads/:id
```

Ownership enforced. Setting `status` to `Disqualified` requires a `disqualification_reason`.

### Delete a lead

```
DELETE /api/leads/:id
```

### Convert a lead

```
POST /api/leads/:id/convert
Content-Type: application/json

{
  "contact": {
    "first_name": "Bob",
    "last_name": "Jones",
    "email": "bob@prospect.com"
  },
  "account": {
    "name": "Prospect Inc"
  },
  "deal": {
    "name": "Prospect Inc — Initial",
    "value": 5000,
    "stage": "Prospecting"
  }
}
```

`contact` is required. `account` and `deal` are optional. Returns the IDs of all
created records. The lead's status is set to _Converted_ and locked.

---

## 9. Notes

Notes are polymorphic — they attach to a contact, account, deal, or lead.

```
GET    /api/:entityType/:entityId/notes       — list notes (paginated)
POST   /api/:entityType/:entityId/notes       — create a note
PATCH  /api/:entityType/:entityId/notes/:noteId  — update (author or admin only)
DELETE /api/:entityType/:entityId/notes/:noteId  — delete (author or admin only)
```

`entityType` is one of: `contacts`, `accounts`, `deals`, `leads`.

### Create a note

```
POST /api/contacts/<uuid>/notes
Content-Type: application/json

{
  "body": "Spoke at length about Q3 budget — confirmed $50k available.",
  "visibility": "internal"
}
```

`body` is required. `visibility` is one of `public`, `internal`, `private`
(default: `public`).

---

## 10. Tags

```
GET  /api/tags          — list all tags
POST /api/tags          — create a tag  { "name": "VIP", "color": "#FF0000" }
PATCH /api/tags/:id     — update a tag
DELETE /api/tags/:id    — delete a tag (admin only)
```

Tags are shared across all contacts. `color` is an optional hex string.

---

## 11. Attachments

Attachments are files associated with a contact, account, deal, or lead.

```
POST   /api/attachments/upload            — upload a file (multipart/form-data)
GET    /api/:recordType/:recordId/attachments  — list attachments for a record
DELETE /api/attachments/:id               — delete an attachment
GET    /api/attachments/:id/download      — download a file
```

`recordType` is one of: `contact`, `account`, `deal`, `lead`.

Upload fields: `file` (the binary), `record_type`, `record_id`.

---

## 12. Users (admin only)

All endpoints in this section require admin role.

```
GET    /api/users                      — list all users
GET    /api/users/active               — list active users (lightweight; used in owner pickers)
GET    /api/users/:id                  — get a user
POST   /api/users/invite               — invite a new user
PATCH  /api/users/:id                  — update name, role, status
POST   /api/users/:id/set-password     — set a user's password (forces change on next login)
POST   /api/users/:id/reset-onboarding — reset the user's onboarding checklist
```

### Invite a user

```
POST /api/users/invite
Content-Type: application/json

{ "email": "alice@example.com", "name": "Alice", "role": "rep" }
```

`role` is `admin` or `rep`. Returns `201 Created` with the new user object.

#### Notification preferences (authenticated user)

```
GET   /api/users/me/notification-preferences
PATCH /api/users/me/notification-preferences
```

Body for PATCH: any subset of `{ "notify_overdue_tasks": bool, "notify_assignments": bool, "notify_deal_stage_changes": bool }`.

---

## 13. Settings

Most read settings are public (no auth required); write settings are admin only.

### General

```
GET   /api/settings/default-language      — { language }
PATCH /api/settings/default-language      — { language }  (admin)

GET   /api/settings/nav-layout            — { layout }
PATCH /api/settings/nav-layout            — { layout }    (admin)

GET   /api/settings/default-currency      — { currency }
PATCH /api/settings/default-currency      — { currency }  (admin)
```

### Email notifications

```
GET   /api/settings/email-notifications   — { enabled: bool }
PATCH /api/settings/email-notifications   — { enabled: bool }  (admin)
```

### Pipeline stages

```
GET  /api/settings/pipeline-stages        — { stages: PipelineStageResponse[] }
POST /api/settings/pipeline-stages        — create stage  (admin)
PATCH /api/settings/pipeline-stages/:id   — update stage  (admin)
DELETE /api/settings/pipeline-stages/:id  — delete stage  (admin)
```

Stage object:

```json
{
  "id": "<uuid>",
  "name": "Proposal",
  "sort_order": 3,
  "probability": 50,
  "is_terminal": false,
  "is_fixed": false
}
```

### Branding

```
GET    /api/settings/branding   — current branding config (public)
PUT    /api/settings/branding   — partial merge of branding fields (admin)
DELETE /api/settings/branding   — reset all branding to defaults (admin)
```

### Onboarding

```
GET  /api/settings/onboarding              — { is_first_run, tasks: [...] }
POST /api/settings/onboarding/complete     — mark onboarding completed for current user
```

### Webhooks (admin only)

See [webhooks.md](webhooks.md) for full details.

```
GET    /api/admin/webhooks
POST   /api/admin/webhooks
PATCH  /api/admin/webhooks/:id
DELETE /api/admin/webhooks/:id
GET    /api/admin/webhooks/:id/logs
```

### Automation rules (admin only)

```
GET    /api/admin/automation
POST   /api/admin/automation
PATCH  /api/admin/automation/:id
DELETE /api/admin/automation/:id
GET    /api/admin/automation/:id/logs
```

---

## 14. Audit Log

The audit log is an append-only record of every create, update, and delete across
all user data in MiniCRM. Admin only.

### List audit events (REST)

```
GET /api/audit
```

Query parameters: `page`, `limit`, `record_type`, `record_id`, `event_type`,
`changed_by_id`, `from`, `to` (ISO 8601 timestamps).

Returns a paginated list of audit event objects:

```json
{
  "id": "<uuid>",
  "record_type": "contact",
  "record_id": "<uuid>",
  "record_name": "Jane Smith",
  "event_type": "updated",
  "field_name": "email",
  "old_value": "jane.old@example.com",
  "new_value": "jane@example.com",
  "changed_by_id": "<uuid>",
  "changed_by_name": "Rob Admin",
  "created_at": "2026-05-29T14:23:01.000Z"
}
```

For live streaming of audit events see the gRPC section below.

---

## 15. gRPC / ConnectRPC — AuditService

MiniCRM exposes a ConnectRPC service alongside the REST API on the **same port and
path prefix** (`/api`). No separate gRPC port is required. The transport uses the
Connect protocol (JSON over HTTP/1.1 or HTTP/2), compatible with standard REST
tooling such as `curl`.

### Authentication

- **Same-origin browser requests:** the `httpOnly` JWT cookie is forwarded automatically.
- **Server-to-server / CLI:** pass `Authorization: Bearer <jwt>` in the request header.
  Obtain the JWT by calling `POST /api/v1/auth/login` and extracting the cookie value.

This is a session JWT, so the 30-minute idle window and 8-hour absolute cap from
[§1](#1-authentication) both apply — a long-running client must refresh it. Note the
REST API treats a `Bearer` header differently: there it is a service-account API token,
not a JWT.

### Service: `AuditService`

Defined in `audit.proto`. Two RPCs:

#### `ListAuditEvents` (unary)

Paginated query of the `audit_log` table. This is the only way to read the system-wide
audit list — the REST equivalent was removed, and `/api/v1/audit-log` now serves only
`/record` and `/actors`.

```
POST /api/minicrm.audit.v1.AuditService/ListAuditEvents
Content-Type: application/json

{
  "page": 1,
  "limit": 50,
  "record_type": "deal"
}
```

#### `StreamAuditEvents` (server-streaming)

Live stream of audit events via PostgreSQL `LISTEN/NOTIFY`. The server keeps the
connection open and pushes each new audit log entry as it is written.

```
POST /api/minicrm.audit.v1.AuditService/StreamAuditEvents
Content-Type: application/connect+json

{}
```

The response is a server-sent stream of audit event JSON objects. The stream runs
until the client disconnects or the server shuts down.

### Using `curl`

```bash
# Unary — list recent audit events
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/minicrm.audit.v1.AuditService/ListAuditEvents \
  -d '{"page":1,"limit":10}' | jq .
```
