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

`markdownlint-cli2` 0.23 declared `smol-toml: "1.7.0"` — an exact pin — and 1.7.0 carried a
high advisory. The options were override it, fork the package, or drop the tool. npm
provides no fourth choice. (0.24 moved its own pins forward, and that override was retired.)

### Why the lockfile, not the range, decides what installs

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
  "sharp": "0.35.5",                    // every sharp in the tree
  "promptfoo": { "hono": "4.13.5" }     // only hono underneath promptfoo
}
```

A pin is not automatically a problem to be removed. Some are held deliberately — the
`adm-zip` and `undici` examples below show why.

---

## Version policy: current and pinned

The rule: take every release of a direct dependency, and record a reason under **Held**
for anything left behind — `npm outdated` lists what is. Staying behind is how a routine
advisory becomes a forced, multi-major emergency.

- **`.npmrc` sets `save-exact=true`**, so `npm install <pkg>` writes `1.2.3`, never `^1.2.3`.
- **`node scripts/check-exact-pins.mjs`** fails on any range in a manifest's dependency
  sections (root `overrides` pin transitive packages and are `check-pin-drift`'s). CI's
  lint-and-typecheck job runs it, and its `--self-test`, whenever a manifest changes.
- **What is behind** is `npm outdated --workspaces --include-workspace-root`. Nothing runs
  it on a schedule or raises it to a person yet; that is an update bot's job (Renovate's
  dependency dashboard is the usual one), and choosing one is open.

A major moves in its own commit, after its vendor's migration guide, with the tests that
cover it. So does a 0.x minor whose changelog marks it breaking.

### Held

| Package       | Held at | Why                                                                                                                            |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `typescript`  | 6.x     | 7.x: `@typescript-eslint/parser` (latest, 8.72.1) declares `typescript <6.1.0`                                                 |
| `eslint`      | 9.x     | 10.x: the newest ESLint `eslint-plugin-react` 7.37.5 accepts is `^9.7`, and `eslint-plugin-jsx-a11y` 6.10.2 `^9` (both latest) |
| `@types/node` | 24.x    | DefinitelyTyped versions it by Node major, and the runtime is Node 24 (`.nvmrc`, the images); 26.x declares APIs 24 lacks      |

### Types that lag their runtime

`@types/pdfkit` 0.17.7 is DefinitelyTyped's latest, and pdfkit (0.20.2 here) ships no types
of its own, so the declarations describe 0.17. Check pdfkit's changelog, not the types,
before using an API the 0.18–0.20 releases changed.

### Exact pins

Each `package.json` pins an exact version (`1.2.3`, no `^` or `~`), as Renovate's pinning
guide recommends for applications: the manifest says what is installed, and a bump is
always a visible diff rather than a lockfile-only change. The one exception is a workspace
reference, such as server's `"@minicrm/shared": "*"`, which names a sibling, not a release.

---

## The tools, and which half each covers

| Tool                           | Covers                                       | Blocking? |
| ------------------------------ | -------------------------------------------- | --------- |
| `npm audit` gate               | High/critical advisories, less the allowlist | **Yes**   |
| Dependabot (`github-actions`)  | Action version upgrades                      | No        |
| Dependabot (`npm`, security)   | Advisories against **declared** dependencies | No        |
| `scripts/check-pin-drift.mjs`  | Newer patches for **override** pins          | No        |
| `scripts/check-exact-pins.mjs` | A range in any workspace manifest            | **Yes**   |

The gate has one escape: `ALLOWLISTED_ADVISORIES` in `scripts/npm-audit-gate.sh`, for an
advisory with **no patched release** that only dev tooling reaches. The gate enforces the
second half: it also audits with `--omit=dev`, and an allowlisted advisory found there
blocks. Each entry names the
upstream fix it is waiting on, and the gate warns once an entry's advisory stops being
reported so it gets deleted. It judges advisories, not the package counts in npm's
summary — one `braces` advisory makes `micromatch`, `chokidar`, `tailwindcss` and
`markdownlint-cli2` all count as high, and the allowlist must clear those too.

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
bash scripts/npm-audit-gate.sh  # expect a pass; raw npm audit also counts the allowlist
```

The clean re-resolve also keeps every platform's native bindings in the lockfile. An
incremental install over an existing `node_modules` can drop the Linux and musl ones
(npm/cli#4828, still open), and CI and the client image install from this lockfile alone,
so that shows up there as a missing native binding.

Then verify the consumer still works. A pin change is a dependency change for whatever
sits on top of it: after moving `basic-ftp`, run the promptfoo evals; after moving
`sharp`, build the client.

---

## Worked example: why `adm-zip` was held at 0.6.0

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

`adm-zip` 0.6.1 later fixed both advisories, and promptfoo 0.124 then dropped
`onnxruntime-node` altogether, so the pin was deleted. The lesson outlived it.

**The lesson generalizes:** read every advisory on a package before concluding a pin is
pointless. A pin sitting inside one vulnerable range may be escaping a worse one.

---

## Worked example: the `undici` pin violates a declared range

`undici` is pinned to a version that violates two of its five consumers' declared ranges:

| Consumer                   | Declares      |
| -------------------------- | ------------- |
| `@connectrpc/connect-node` | `^5.28.4`     |
| `@ai-sdk/provider-utils`   | `^6.28.0`     |
| `jsdom`                    | `^7.25.0`     |
| `openai` (peer)            | `>=5 <9`      |
| `promptfoo`                | `>=7.30.1 <8` |

All five are served one hoisted copy. Two violations are real and `npm ls` marks them
`invalid`, each safe for a specific, verified reason:

- connect-node's only use of `undici` is `node-headers-polyfill.js`, which assigns
  `globalThis.Headers` behind a `major < 18` check. This repo's floor is Node 24, so the
  branch never executes. The module-level `require("undici")` still runs, so the package
  must resolve and load — only the `Headers` export is ever touched.
- `@ai-sdk/provider-utils` (dev only, under promptfoo) calls `new Agent({ connect: { lookup } })`
  and `fetch`. 7.x keeps both: its connector options still pass Node's `lookup` through.

**This is the fragile shape**, and worth knowing about: a pin that contradicts a declared
range is safe only as long as the consumer's usage stays what it was when someone checked.
An upgrade to `@connectrpc/connect-node` that starts using `undici` for real would break
silently. If that pin can ever be retired, it should be.

Note the constraint on moving it: `promptfoo` declares `>=7.30.1 <8`, which 8.x would
break — and unlike connect-node's, that range is currently **satisfied**. Staying on the
7.x line is deliberate, not neglect.

---

## Worked example: the `basic-ftp` pin crosses a major

`basic-ftp` is pinned to 6.x, past the `^5.3.1` that its only consumer, `get-uri`, declares
(`promptfoo` → `proxy-agent` → `pac-proxy-agent` → `get-uri`). No 5.x release fixes
`GHSA-c475-qrg2-pj4r`. `npm ls` marks it `invalid`.

Safe for a verified reason: `get-uri` imports only `Client`, and 6.0.0's sole breaking change
is refusing a separate FTP transfer host by default — a bounce-attack hardening, not an API
change. Retire the pin once `get-uri` declares `^6`.

---

## Worked example: the `@azure/msal-node` pin crosses a major

`@azure/msal-node` is pinned to 7.x under `@azure/identity`, past the `^6.0.0` it declares
(`promptfoo` → `@azure/identity`, dev only). No 6.x release fixes `GHSA-xcx6-jx8p-x3h5`.

Safe for a verified reason: 7.0.0's sole breaking change removes `responseMode` from
`acquireTokenInteractive`, and `@azure/identity` never passes it. Retire the pin once
`@azure/identity` declares `^7`.

---

## Related

- [CI Pipeline](ci.md) — where the audit gate runs and what it blocks
- [Contributing](contributing.md) — what to run before a commit and a push
- `.github/dependabot.yml` — the configuration, with its reasoning inline
- `.github/workflows/security-audit.yml` — the daily scheduled audit
