# Local SSO Testing

MiniCRM supports OIDC single sign-on. To exercise it locally without an external identity
provider, the repo ships a [Dex](https://dexidp.io/) configuration at `dex/config.yaml`,
run as an optional Compose service behind the `sso` profile.

This is a **development-only** setup: Dex stores everything in memory, its two accounts
share a hardcoded password, and its client is public. Nothing here is suitable for any
deployed environment.

---

## Starting Dex

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile sso up -d
```

Both files are required: `docker-compose.dev.yml` holds override fragments for `server`
and `client` with no `image` or `build` of their own, so it cannot stand alone.

This starts the API and Dex, not the UI — the base file keeps `client` behind the `web`
profile. Run the dev UI with `npm run dev:client` on port 5173.

Dex listens on port 5556. Its discovery document is at
`http://localhost:5556/dex/.well-known/openid-configuration`.

---

## Configuring MiniCRM

As an admin, go to **Settings → Integrations → SSO** and enter:

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Protocol         | OIDC                                                         |
| IdP Metadata URL | `http://localhost:5556/dex/.well-known/openid-configuration` |
| Client ID        | `minicrm-local`                                              |

No client secret is needed: Dex declares this client `public: true`, so it accepts the
code exchange without one. **The flow does not use PKCE** — `ssoService.ts` passes
`pkceCodeVerifier: undefined` and imports no PKCE helpers; replay protection comes from
`state` and `nonce` alone.

Dex accepts exactly one redirect URI: `http://localhost:3001/api/v1/auth/sso/callback`.
MiniCRM builds the URI it sends from `SSO_CALLBACK_BASE_URL`, falling back to
`APP_BASE_URL` and then to `http://localhost:3001`. **Compose defaults that variable to
`http://localhost`** (port 80), which Dex rejects — so set
`SSO_CALLBACK_BASE_URL=http://localhost:3001` in your `.env`, as `.env.example` already
does.

---

## Test accounts

Both use the password `password`:

| Email               | Role in Dex |
| ------------------- | ----------- |
| `admin@example.com` | Admin User  |
| `rep@example.com`   | Rep User    |

Dex's storage is `type: memory`, so every restart resets its state. That is deliberate —
it keeps the local IdP reproducible — but it also means any Dex-side change made while
running is lost on restart.

---

## Related

- [Troubleshooting](troubleshooting.md) — stack and callback failures
- `dex/config.yaml` — the IdP definition this page describes
- `server/src/controllers/ssoController.ts` — the callback endpoints the redirect URI hits
- `server/src/services/ssoService.ts` — the SP side, including the encrypted private key
- `server/src/services/ssoSettingsService.ts` — where IdP settings are stored
