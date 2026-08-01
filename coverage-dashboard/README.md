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

3. Set the three env vars this app's endpoints are gated on, in your `.env`, and
   restart the server:

   ```bash
   COVERAGE_REPORTING_QUERY=true
   COVERAGE_MAPPING_QUERY=true
   # The Sessions tab (SessionRecorderPage) calls /admin/coverage/sessions, which
   # has its own gate — omit this and that one tab 404s while the rest works.
   COVERAGE_SESSION_MANAGEMENT=true
   ```

   All three default off — this is developer tooling, meant to stay off in production. They
   gate route **registration** at process boot (MINCRM-663 for
   `COVERAGE_SESSION_MANAGEMENT`, MINCRM-685 for the other two), so a server missing
   one answers **`404`** on every request to that router: the routes do not exist. That is not
   the same as a permission error, and it is why restarting matters — a boot-time gate
   cannot be flipped on a running server.

   `COVERAGE_REPORTING_QUERY` and `COVERAGE_MAPPING_QUERY` replaced the
   `coverage_reporting_query` / `coverage_mapping_query` `feature_flags` rows, which
   migration 163 deleted; `COVERAGE_SESSION_MANAGEMENT` replaced
   `coverage_session_management`, deleted by migration 161. If you are following older notes
   telling you to `UPDATE feature_flags` or toggle these in the CRM's admin Feature
   Flags screen: those rows are gone, and deliberately — internal test infrastructure
   has no business being toggleable from the product's own UI. See
   [docs/dev/coverage.md](../docs/dev/coverage.md).

   `GET /api/v1/admin/coverage/health` reports a `routers` block showing exactly which
   gates were open at boot — the fastest way to confirm this step took effect.

4. Start the dashboard's dev server from the repo root. Set
   `VITE_COVERAGE_DASHBOARD_NO_AUTH=true` to match the `COVERAGE_DASHBOARD_NO_AUTH` flag from step 1 —
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

## Build SHA for manual session recording

The Session Recorder tags every manually recorded coverage session with a commit
SHA, so its coverage can be attributed to a build. `vite.config.ts` resolves that
value and inlines it as `VITE_BUILD_SHA` — for `npm run dev` as well as
`npm run build` — preferring an explicit `GIT_COMMIT_SHA`, then `GITHUB_SHA`,
and otherwise falling back to `git rev-parse HEAD`. Running from a normal
checkout therefore needs no configuration.

An environment with no `.git` available — a container image, most notably — must
pass the SHA in explicitly:

```bash
GIT_COMMIT_SHA=$(git rev-parse HEAD) npm run dev --workspace=minicrm-coverage-dashboard
# ...or the same prefix on `npm run build` for a production bundle.
```

If the value ends up unset, empty, or not a usable SHA, sessions are tagged
`unknown` and the recorder shows an on-screen notice. Recording still works, but
that coverage can never be matched to a commit and will not appear in build-level
reports — see [docs/dev/coverage.md](../docs/dev/coverage.md). Note the value is
resolved when Vite starts and inlined into the served bundle: changing it means
restarting the dev server (or rebuilding), not just re-exporting the variable.

## Accessing it

Open **http://localhost:5174**.

With `COVERAGE_DASHBOARD_NO_AUTH=true` set on the server (step 1) AND
`VITE_COVERAGE_DASHBOARD_NO_AUTH=true` set on this app's own dev server (step 4) —
recommended for local dev — the dashboard requires no login at all: this is a pure
internal engineering tool with no customer-facing surface, and requiring a CRM admin
login just to view test coverage/gap data was unnecessary friction. Both flags are
needed together: the client flag alone still renders the app, but every API call it
makes 401s from the server's own (still-enforced) auth check; the server flag alone
still works for direct API/curl access, but this app's own `ProtectedRoute` keeps
redirecting to its login page since it never learns auth was dropped server-side. The
server enforces `NODE_ENV !== 'production'` before ever honoring its flag, so it can't
accidentally leave reporting data open in a real deployment.

Dropping the login does **not** make unregistered routes appear. The two env vars from
step 3 still apply: without them the routers register nothing, so every request 404s no
matter how auth is configured. MINCRM-694 previously kept an org-wide feature-flag
check alive on this path for the same purpose; MINCRM-685 deleted those rows and the
boot gate took over — harder to defeat than a row an admin could flip, but it needs a
restart rather than a toggle to change.

Without both `*_NO_AUTH` flags set (the default), auth instead reuses `minicrm-server`'s
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
