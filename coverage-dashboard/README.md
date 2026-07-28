# Coverage/TIA Dashboard

Standalone reporting UI for MiniCRM's Coverage/TIA (Test Impact Analysis) system —
coverage trends, gap analysis, and test-to-code traceability. A read-only client of
`minicrm-server`'s coverage reporting query API: no shared route table, database
access, or codebase with `minicrm-client`/`minicrm-server` beyond `@shared/schemas`
types. See [`docs/dev/coverage.md`](../docs/dev/coverage.md) for the full
architecture (data model, mapping engine, TIA test selection).

## Running locally

1. Set `COVERAGE_DASHBOARD_NO_AUTH=true` in the repo root's `.env` (see
   `.env.example`'s own comment on this var) so this internal tool doesn't
   require a CRM login (see "Accessing it" below), then start the backend
   (Postgres + server), same as for the CRM client:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   ```

2. Install dependencies (first time, or after a `package.json` change):

   ```bash
   npm install --prefix coverage-dashboard
   ```

3. Start the dashboard's dev server from the repo root. Set
   `VITE_COVERAGE_DASHBOARD_NO_AUTH=true` to match the server-side flag from step 1 —
   the two only take effect together (see "Accessing it" below):

   ```bash
   VITE_COVERAGE_DASHBOARD_NO_AUTH=true npm run dev --workspace=minicrm-coverage-dashboard
   ```

This serves the app at **http://localhost:5174** (not 5173 — `client/`'s dev server
keeps that port; both run simultaneously). The dev server proxies `/api/*` requests to
`minicrm-server` at `http://localhost:3001` by default — override with `API_URL` if
your server runs elsewhere.

**To browse E2E coverage data**, point it at the test stack instead: that data lives in
`minicrm_coverage_e2e`, served by the test server on port 3002 (MINCRM-684).

```bash
API_URL=http://localhost:3002 VITE_COVERAGE_DASHBOARD_NO_AUTH=true \
  npm run dev --workspace=minicrm-coverage-dashboard
```

To override the target for any other reason:

```bash
API_URL=http://localhost:4001 VITE_COVERAGE_DASHBOARD_NO_AUTH=true npm run dev --workspace=minicrm-coverage-dashboard
```

## Accessing it

Open **http://localhost:5174**.

With `COVERAGE_DASHBOARD_NO_AUTH=true` set on the server (step 1) AND
`VITE_COVERAGE_DASHBOARD_NO_AUTH=true` set on this app's own dev server (step 3) —
recommended for local dev — the dashboard requires no login at all: this is a pure
internal engineering tool with no customer-facing surface, and requiring a CRM admin
login just to view test coverage/gap data was unnecessary friction. Both flags are
needed together: the client flag alone still renders the app, but every API call it
makes 401s from the server's own (still-enforced) auth check; the server flag alone
still works for direct API/curl access, but this app's own `ProtectedRoute` keeps
redirecting to its login page since it never learns auth was dropped server-side. The
server enforces `NODE_ENV !== 'production'` before ever honoring its flag, so it can't
accidentally leave reporting data open in a real deployment.

Without both flags set (the default), auth instead reuses `minicrm-server`'s
existing httpOnly session cookie rather than a separate credential store — you
must already be logged in as an **admin** at the CRM client
(`http://localhost:5173`) in the same browser first; otherwise the app
redirects to its login page. Every reporting endpoint is independently
`requireRole('admin')`/`coverage:admin`-gated server-side regardless of what
the client shows.

Reusing the CRM's cookie only works out of the box because both apps run on
`localhost` under `sameSite: 'lax'`. A real cross-origin deployment needs the
server's `CORS_ORIGIN` allowlist to include this app's deployed origin explicitly —
see `server/.env.example`'s `CORS_ORIGIN` comment.

## Other commands

```bash
npm run build --workspace=minicrm-coverage-dashboard      # production build
npm run typecheck --workspace=minicrm-coverage-dashboard
npm test --workspace=minicrm-coverage-dashboard            # vitest run
npm run test:coverage --workspace=minicrm-coverage-dashboard
```
