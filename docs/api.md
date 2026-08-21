# MiniCRM REST API Reference

This document covers the cross-cutting rules of the MiniCRM REST API — authentication,
session lifetime, versioning, error shape, and pagination. It is aimed at developers
building integrations against a MiniCRM instance.

**The per-endpoint reference is generated from the code, not written here.** Every route
carries an `@openapi` annotation that a lint rule requires, so an endpoint cannot be added
without appearing in the spec — the way a hand-written catalogue silently fell behind. See
[Reading the endpoint reference](#4-reading-the-endpoint-reference).

---

## Contents

1. [Authentication](#1-authentication)
2. [Error shape](#2-error-shape)
3. [Pagination](#3-pagination)
4. [Reading the endpoint reference](#4-reading-the-endpoint-reference)
5. [Versioning](#5-versioning)
6. [gRPC / ConnectRPC — AuditService](#6-grpc--connectrpc--auditservice)

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

Clears the cookie. Returns `200 OK`, or `401` if the session has already lapsed — treat
that as already logged out rather than as a failure to clean up.

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

## 4. Reading the endpoint reference

Every endpoint is described by the generated OpenAPI 3.0 document, built from `@openapi`
annotations in the route files by [swagger-jsdoc](https://github.com/Surnet/swagger-jsdoc).
A repo-local ESLint rule (`local-openapi/require-openapi-tag`) fails the build when a
route is added without one, and CI validates the generated document on every pull
request, so it stays in step with the code.

**On a development or staging instance** the interactive UI is served at `/api-docs`, and
the raw document at `/api-docs.json`.

**In production both are disabled**, so generate the document from a checkout instead:

```bash
npm run generate-spec --workspace=minicrm-server
# writes server/openapi.json
```

That file is the input to any OpenAPI client generator. See
[API Documentation](../README.md#api-documentation) for how the pipeline is wired.

---

## 5. Versioning

All resource endpoints are served under **`/api/v1/`**. `GET /api/health` is deliberately
unversioned — it is an infrastructure endpoint, not part of the resource API.

`docs/operations.md` holds the [versioning policy](operations.md#api-versioning-policy):
the scheme, what counts as a breaking change, and how a future `v2` would be introduced.
The integrator-facing details are below.

### The legacy unversioned paths

Requests to the pre-v1 paths are redirected to their `/api/v1/` equivalent with a
**`308 Permanent Redirect`**, which preserves the method and body — a `301` would let a
client rewrite a `POST` to `GET` and drop the payload.

Eighteen prefixes are covered:

```
/api/auth       /api/users      /api/contacts   /api/accounts
/api/deals      /api/activities /api/dashboard  /api/reports
/api/settings   /api/automation /api/admin      /api/search
/api/attachments /api/audit-log /api/leads      /api/tags
/api/custom-fields              /api/gdpr
```

**Anything else is not redirected at all.** `teams`, `insights`, `duplicates`,
`data-hygiene`, `notifications`, `pipelines`, `sequences`, `sequence-enrollments`, and
`custom-roles` have no legacy alias — they were added after the prefix was introduced, so
an unversioned request to one reaches no route and returns `404`.

Two families are covered only in part. `feature-flags` and `ai` are mounted twice, and
only the admin mount has an alias: `/api/admin/feature-flags` and `/api/admin/ai` redirect
via the `/api/admin` prefix, while the user-facing `/api/feature-flags` and `/api/ai`
`404`. Note that `feature-flags` is one router mounted at both `/api/v1/feature-flags` and
`/api/v1/admin/feature-flags`, so every one of its routes answers on either prefix even
though the spec documents each under a single one. Notes are not affected — they mount beneath their parent entity
(`/api/v1/{entityType}/{entityId}/notes`), so `/api/contacts/{id}/notes` redirects on the
`/api/contacts` prefix like any other nested path.

Two further traps. `/api/automation` redirects to `/api/v1/automation`, but the router
mounts at `/api/v1/automation/rules`, so only the suffixed form resolves. And
`/api/admin/automation` was never a route at any version.

Note that a `/api/v1/` path with no matching route answers `401`, not `404`: an
authenticated router is mounted at the bare `/api/v1` prefix, so its auth check runs
before the not-found handler. Treat `401` on an unfamiliar path as "wrong path or no
session", not as proof the path exists.

**These redirects will be removed.** Treat them as a migration aid, not an interface —
send `/api/v1/` directly.

---

## 6. gRPC / ConnectRPC — AuditService

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
