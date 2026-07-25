# Coverage/TIA Dashboard

Standalone reporting UI for MiniCRM's Coverage/TIA (Test Impact Analysis) system —
coverage trends, gap analysis, and test-to-code traceability. A read-only client of
`minicrm-server`'s coverage reporting query API: no shared route table, database
access, or codebase with `minicrm-client`/`minicrm-server` beyond `@shared/schemas`
types. See [`docs/dev/coverage.md`](../docs/dev/coverage.md) for the full
architecture (data model, mapping engine, TIA test selection).

## Running locally

1. Start the backend (Postgres + server), same as for the CRM client:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   ```

2. Install dependencies (first time, or after a `package.json` change):

   ```bash
   npm install --prefix coverage-dashboard
   ```

3. Start the dashboard's dev server from the repo root:

   ```bash
   npm run dev --workspace=minicrm-coverage-dashboard
   ```

This serves the app at **http://localhost:5174** (not 5173 — `client/`'s dev server
keeps that port; both run simultaneously). The dev server proxies `/api/*` requests to
`minicrm-server` at `http://localhost:3001` by default — override with `API_URL` if
your server runs elsewhere:

```bash
API_URL=http://localhost:4001 npm run dev --workspace=minicrm-coverage-dashboard
```

## Accessing it

Open **http://localhost:5174**. Auth reuses `minicrm-server`'s existing
httpOnly session cookie rather than a separate credential store — you must already be
logged in as an **admin** at the CRM client (`http://localhost:5173`) in the same
browser first; otherwise the app redirects to its login page. Every reporting endpoint
is independently `requireRole('admin')`-gated server-side regardless of what the
client shows.

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
