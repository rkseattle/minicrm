# Dependency Management

How this repo keeps its dependency tree patched, why it pins the way it does, and which
tool covers which half of the problem.

---

## The recurring failure

Advisories are published against versions **already in the lockfile**. A tree that nobody
touched goes from clean to vulnerable with no commit at all. That is not a hypothetical:
in two consecutive days the audit gate went red twice — five high advisories in one batch,
then `smol-toml` overnight — with no dependency change on either side.

This shapes everything below. The problem is not that dependencies drift forward too
fast; it is that **published knowledge about the versions we already have** drifts, and
nothing tells us until a gate fails.

---

## Why `overrides` exists

The root `package.json` `overrides` block pins transitive dependencies. It is an escape
hatch, not a version policy: every entry exists because a package we do not control
declares a dependency on a version we cannot accept.

`markdownlint-cli2` declares `smol-toml: "1.7.0"` — an exact pin — and 1.7.0 carries a
high advisory. The options are override it, fork the package, or drop the tool. npm
provides no fourth choice.

### Why not just take the latest of everything

- **npm `overrides` has no floating syntax.** `"^4.13.5"` resolves once at install time
  and freezes in the lockfile. A caret override goes stale exactly like an exact one,
  with a wider initial window and less clarity about what is actually installed.
- **The lockfile is the point.** It is what makes CI, a developer machine, and the Docker
  images install an identical tree. A tree that drifts silently means a green CI run
  proves nothing about what ships.
- **Unannounced bumps land on the wrong PR.** A clean re-resolve moved Playwright
  1.62.1 → 1.63.0, whose new `--add-reporter` flag broke a guard. That break was caught
  on the PR that caused it. Under auto-latest, the same bump arrives on an unrelated PR
  whose author has no context for the failure.

### Reading the block

Nested entries scope a pin to one dependent:

```jsonc
"overrides": {
  "sharp": "0.35.4",                    // every sharp in the tree
  "promptfoo": { "hono": "4.13.5" }     // only hono underneath promptfoo
}
```

A pin is not automatically a problem to be removed. Some are held deliberately, and the
`adm-zip` entry is the worked example — see below.

---

## Three tools, three different halves

| Tool                          | Covers                                          | Blocking? |
| ----------------------------- | ----------------------------------------------- | --------- |
| `npm audit` gate              | Any high/critical advisory in the resolved tree | **Yes**   |
| Dependabot (`github-actions`) | Action version upgrades                         | No        |
| Dependabot (`npm`, security)  | Advisories against **declared** dependencies    | No        |
| `scripts/check-pin-drift.mjs` | Newer patches for **override** pins             | No        |

### Dependabot: npm is security-only, on purpose

`.github/dependabot.yml` sets `open-pull-requests-limit: 0` for npm. That disables
scheduled **version** updates while leaving **security** PRs enabled — Dependabot raises
those regardless of the limit.

Routine version bumps are excluded because Dependabot regenerates the lockfile and does
not reliably reapply the root `overrides` block. A bump that quietly re-resolves a pinned
transitive reintroduces the advisory the pin exists to suppress. The blocking audit gate
would catch it, but as a red PR needing manual re-resolution.

### The gap neither Dependabot nor the audit gate closes

Dependabot bumps **declared** dependencies. An override pins a package nothing in this
repo declares, so there is no manifest entry to raise a PR against. Meanwhile the audit
gate only fires once an advisory is **published** — by which point the pin is already
vulnerable.

`scripts/check-pin-drift.mjs` fills that space: it reports override pins with a newer
same-major version published, before an advisory forces the issue. It runs in
`security-audit.yml` and is **advisory only** — a newer patch existing is not a defect,
and making it blocking would make "silence the check" the honest response.

```bash
node scripts/check-pin-drift.mjs            # human-readable
node scripts/check-pin-drift.mjs --json     # machine-readable
node scripts/check-pin-drift.mjs --self-test
```

Same-major only: crossing a major is a compatibility decision needing a human and a
changelog. npm's own `fixAvailable` has twice suggested a major **downgrade** here
(`markdownlint-cli2` 0.23.2 → 0.21.0, `minio` → 7.1.3).

---

## Changing a pin

**Always re-resolve cleanly.** An incremental install will not reconsider overrides for
transitive dependencies — `npm install`, `--package-lock-only`, and deleting only the
lockfile all report "up to date" and silently leave the old version in place.

```bash
rm -rf node_modules package-lock.json && npm install
npm audit                       # expect 0 high, 0 critical
```

Then verify the consumer still works. A pin change is a dependency change for whatever
sits on top of it: after moving `smol-toml`, run `markdownlint-cli2`; after moving
`sharp`, build the client.

---

## Worked example: why `adm-zip` stays at 0.6.0

`adm-zip` carries **two** advisories:

| Advisory              | Severity | Range             |
| --------------------- | -------- | ----------------- |
| `GHSA-xcpc-8h2w-3j85` | high     | `<0.6.0`          |
| `GHSA-vwc7-r8mq-g2x9` | moderate | `>=0.5.9 <=0.6.0` |

The pin sits **inside** the moderate's range, which makes it look useless — and 0.6.0 is
the newest published version, so that moderate has no fix at all. It is nonetheless the
exact floor that clears the **high**.

Removing the pin was tried. npm resolved lower, the high returned through
`onnxruntime-node` → `@huggingface/transformers` → `promptfoo`, and the audit went from
0 to 4 highs. The pin is the best available position, and `check-pin-drift.mjs` stays
correctly quiet about it because nothing newer exists.

**The lesson generalizes:** read every advisory on a package before concluding a pin is
pointless. A pin sitting inside one vulnerable range may be escaping a worse one.

---

## Worked example: the `undici` pin violates a declared range

`undici` is pinned to a version that satisfies none of its consumers cleanly:

| Consumer                              | Declares      |
| ------------------------------------- | ------------- |
| `@connectrpc/connect-node`            | `^5.28.4`     |
| `@ai-sdk/provider-utils`              | `^6.28.0`     |
| `@apidevtools/json-schema-ref-parser` | `^6.28.0`     |
| `jsdom`                               | `^7.25.0`     |
| `promptfoo`                           | `>=7.28.0 <8` |

All five are served one hoisted copy. The `^5.28.4` violation is real and `npm ls` marks
it `invalid`, but it is safe for a specific, verified reason: connect-node's only use of
`undici` is `node-headers-polyfill.js`, which assigns `globalThis.Headers` behind a
`major < 18` check. This repo's floor is Node 24, so the branch never executes. The
module-level `require("undici")` still runs, so the package must resolve and load — only
the `Headers` export is ever touched.

**This is the fragile shape**, and worth knowing about: a pin that contradicts a declared
range is safe only as long as the consumer's usage stays what it was when someone checked.
An upgrade to `@connectrpc/connect-node` that starts using `undici` for real would break
silently. If that pin can ever be retired, it should be.

Note the constraint on moving it: `promptfoo` declares `>=7.28.0 <8`, which 8.x would
break — and unlike connect-node's, that range is currently **satisfied**. Staying on the
7.x line is deliberate, not neglect.

---

## Related

- [CI Pipeline](ci.md) — where the audit gate runs and what it blocks
- [Contributing](contributing.md) — what to run before a commit and a push
- `.github/dependabot.yml` — the configuration, with its reasoning inline
- `.github/workflows/security-audit.yml` — the daily scheduled audit
