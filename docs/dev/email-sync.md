# Email Sync

How connected mailboxes are read into `email_messages`, and what a new provider must
implement.

---

## The provider seam

`server/src/services/mail/mailProvider.ts` defines the whole contract:

```ts
fetchSince(auth, cursor, since): Promise<ProviderPage>
```

The engine owns the database, the cursor, and the retry decision. A provider owns only
"given a cursor, hand me the next messages and a new cursor". That split is what lets Gmail
and Microsoft Graph arrive as implementations rather than as branches threaded through the
engine.

A `ProviderPage` carries four things:

| Field           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `messages`      | Normalized messages, in no particular order.                             |
| `cursor`        | Where the next fetch resumes. Null exactly when `cursorInvalid` is true. |
| `cursorInvalid` | The stored cursor no longer means anything to the provider.              |
| `hasMore`       | More history is waiting; the engine decides whether to keep going.       |

### Writing a second provider

1. Implement `MailProvider`. Return `NormalizedMessage` values — the engine does no
   provider-specific parsing. Its `bodyText`, `bodyHtml`, and `snippet` are yours to
   fill: Gmail and Graph return body parts as JSON fields, so neither needs a MIME parser,
   though a driver that gets only HTML still needs `html-to-text` as IMAP's does. Match
   the rules IMAP follows, or one mailbox reads differently depending on which driver
   synced it — plain text preferred over HTML, HTML converted when it is the only part,
   `snippet` derived from the stored text with whitespace collapsed, and all three null
   when a body is unavailable rather than empty. `messageBody.ts` exports `snippetOf` and
   `storable` — use both rather than reimplementing them, since `storable` also strips
   NUL, which Postgres rejects outright, and bounds a decoded body the column does not.
   The columns are `message_`-prefixed for the reason [schema.md](schema.md) gives: the
   AI PII filter matches bare column names at every depth, and `notes.body_text` is a
   live column the note tools deliberately surface.
2. Choose your own cursor encoding. It is an opaque string to everything but you; the
   engine stores it verbatim and hands it back. Use a format that round-trips every value
   your provider can produce — IMAP's uses JSON because a mailbox path may contain any
   character, and a delimited encoding silently split paths containing `:` or `|`.
3. Set `cursorInvalid` when the stored position stops being meaningful — a renumbered
   mailbox, an expired history id, a rejected delta link. The engine responds with a
   bounded re-backfill, not a full resync.
4. Add the provider to `IMPLEMENTED_SYNC_PROVIDERS` in `connectedAccountService.ts`. Until
   it is there the scheduler never claims that provider's accounts, so a mailbox connected
   before its driver shipped simply does not sync rather than failing repeatedly.
5. Bound anything that reaches an indexed column, by hashing on overflow rather than
   truncating. `thread_id` and `provider_message_id` both carry btree indexes, which
   reject an entry over roughly a third of a page. Truncation is not a safe way to get
   under that: an id built by qualifying a value with a prefix loses the distinguishing
   suffix first, so two distinct messages collapse onto one key and the ingest's
   `ON CONFLICT` silently overwrites one with the other. `boundIndexedId` in
   `imapProvider.ts` is the shape to reuse — identity while the value fits, a digest of
   the whole value once it does not. Assert distinctness, not just length: a
   length-only test passes against the truncating version.

## The IMAP provider

Syncs two mailboxes: INBOX, and Sent where one can be identified.

**Finding Sent** takes three routes, in order. A `\Sent` special-use flag is trusted only
when `specialUseSource` is `extension` or `user` — imapflow also derives `specialUse` from
its own localized leaf-name index when the server advertises no RFC 6154 SPECIAL-USE, and
when several folders share a leaf name it awards the flag by `path.localeCompare`, so
`Archive/2019/Sent` beats the live `Sent`. Failing that, the whole path is matched against
a short list of common names. Failing that, a name-derived flag is accepted from a
top-level folder. Paths under an `INBOX.` namespace count as top-level: that layout is the
most common among servers reporting no special-use.

Failing all three logs a warning rather than syncing INBOX silently.

**Direction** compares the sender against the mailbox's own address rather than trusting
the folder. A sent copy can land in INBOX, and an inbound message can be filed into Sent.

**The cursor** is JSON, one `UIDVALIDITY`/`UIDNEXT` pair per mailbox. A mailbox absent from
a stored cursor is treated as never-synced, which is what lets Sent be added to an account
already syncing INBOX without a migration. `UIDVALIDITY` is kept as a string: it is a
32-bit unsigned value imapflow reports as a bigint, and a `Number` round-trip loses
precision at the top of that range.

`UIDVALIDITY` changing means the server renumbered every UID, so the stored positions now
name different messages. That sets `cursorInvalid`.

**Paging** requests everything from the cursor to the mailbox's top and caps the _result_,
not the range. Bounding the request by UID width instead makes a sparse mailbox — ten live
messages atop a million-UID range — cost one round trip per empty span. The cap keeps the
lowest UIDs rather than the first to arrive, because RFC 3501 puts no ordering on untagged
FETCH responses: taking arrival order would strand everything below the cut, since the
cursor advances past them and they are never requested again.

**The body is read in a second fetch.** The cap above applies to what the first fetch
returns, not to what it asks for, and on a never-synced mailbox that request spans the
whole backfill window — so asking for bodies there would download all of it to keep two
hundred messages. Once the delivered set is known, a second fetch asks for `source` over
exactly those UIDs, skipping any message the server sized above `MAX_MESSAGE_SOURCE_BYTES`
and bounding the request by the same figure for a server that reports no size.

`mailparser` turns each document into text and HTML. The whole document goes to it rather
than this code selecting parts out of `bodyStructure`: a part selector needs its own
correct rule for excluding attachment-dispositioned text parts, for stopping at a
`message/rfc822` boundary, and for the single-part case, and each is a place to store the
wrong text for a well-formed message.

A message with only an HTML part still gets text: `mailparser` derives one itself, but
only for a single-part `text/html` message, so the conversion is applied explicitly and a
body does not depend on whether the sender used a multipart wrapper. Bodies are stripped
of NUL, which a `text` column cannot hold and which would otherwise fail the whole page.

Every body failure degrades to a null body rather than propagating — a parse error, a
refused fetch, an oversized message. The message stores its headers and the cursor
advances past it, so the ordinary path does not fetch that body again. It is not beyond
recovery: a mailbox whose page is discarded keeps its stored cursor and is re-read, and
the upsert COALESCEs the body columns, so a later read fills what the first left null. A
UIDVALIDITY re-backfill does not, since it renumbers every UID and the message arrives
under a new `provider_message_id`.

Degrading is still right, because the alternative is worse. `fetchSince` catches per
mailbox and restores that mailbox's stored cursor, so an escaping body error would discard
every header the page had already read and re-read them all next tick — repeatedly, for
as long as the message that threw stays in range.

## The Gmail provider

Reads the REST API directly — no SDK. `googleapis` would pull a large transitive tree to
wrap four endpoints, and the auth layer that is its main draw already exists in
`connectedAccountService`. `revokeProviderTokens` is the precedent: raw `fetch`, a
hardcoded URL, an `AbortController` for the timeout.

**The cursor is JSON carrying an explicit phase**, not a bare `historyId`. The engine feeds
each backfill page's cursor straight back into `fetchSince`, so a driver that routed on the
presence of a history id would switch to the incremental endpoint on page two and abandon
the rest of the window permanently.

**The backfill's anchor is read once**, from `users.getProfile`, before the first page — not
from the newest listed message as Google's sync guide suggests. That value is read _after_
the listing, so a message arriving while the listing ran is never seen again. A mailbox whose
profile returns no `historyId` keeps paging under a placeholder anchor while the listing has
pages left, and stores no cursor once it is exhausted — a null cursor is what routes the next
tick back through the backfill job, where a stored one would take the incremental path and
lose the page budget.

**Every ref a history page reports is delivered**, however many that is. `maxResults` bounds
history _records_, not the messages inside them, so one record set can exceed it — but the
API offers no way to resume inside a page, so a client-side cap could only discard the
remainder while the cursor advanced past it. An oversized page is recoverable; dropped refs
are not.

**Bodies come from `format=RAW`** and the same `parseMessage` the IMAP driver uses, so a
message reads identically whichever driver synced it. Walking Gmail's own `payload.parts[]`
would mean a second rule for part selection, HTML-only conversion, and attachment
disposition, kept in agreement with IMAP's forever. A document over
`MAX_MESSAGE_SOURCE_BYTES` stores its headers with no body rather than being dropped —
unlike IMAP this cannot avoid the download, since RAW carries the whole document and its
size is only known once it has arrived.

**Scope is checked when the provider is built**, not when it fetches. The engine constructs
the driver before it decrypts and refreshes credentials, so refusing at construction is what
stops an under-scoped mailbox from spending a locked token refresh every tick. The required
scope is one constant shared with the consent flow; two copies drifting apart is the
silent-sync-nothing failure the check exists to prevent.

**A 403 is only a credential failure when its body says so.** Quota exhaustion arrives the
same way, and `status_detail` reaches the user — telling a rep to reconnect a mailbox does
nothing for a limit that resets in a minute.

## Threading

IMAP has no native thread id, so one is derived from RFC 5322 headers: the first entry of
`References`, else `In-Reply-To`, else the message's own `Message-ID`. The first entry of
`References` is the conversation root, which is what makes every reply in a chain agree on
one id regardless of where in the chain it arrives.

Two parsing details matter and both were bugs first:

- A FETCH of `HEADER.FIELDS (REFERENCES)` returns a header **block**, not a bare value, and
  some servers ignore the field filter entirely. The field is extracted by name — otherwise
  a `Return-Path: <bounce-…>` line ahead of it becomes the conversation's identity.
- Parenthesised comments are stripped before ids are extracted. They are legal between ids
  and may contain a bracketed address, which would otherwise win.

A message carrying none of the three headers threads on its own UID, unqualified by
mailbox so a message filed in both INBOX and Sent lands in one thread.

## The engine

`emailSyncService.ts` runs one tick over every mailbox that is due.

**Claiming** is a write, not a lock. `claimAccountsDueForSync` pushes
`sync_next_attempt_at` forward in the same statement that returns the rows, so the claim
outlives the transaction — a row lock would release the moment the statement ended, and a
sync runs for minutes. `SKIP LOCKED` still matters on the inner select so two instances
racing on one batch do not serialize.

**Storing** is idempotent. Messages, cursor, and `last_sync_at` move in one transaction: a
cursor advanced without its messages stored would skip that mail permanently. The insert
uses `ON CONFLICT DO UPDATE` so a provider's correction is not ignored, with `is_private`
deliberately excluded — that is a user's own decision and nothing upstream may overwrite
it. Duplicate ids within one page are collapsed before the insert, because `ON CONFLICT DO
UPDATE` refuses a statement that would touch one conflict row twice.

**Backfill** is the path for a mailbox with no usable cursor — never synced, or one whose
cursor was just invalidated. It runs as an `email_sync_jobs` row, bounded by a 90-day
window and by a per-tick page budget. The budget is what keeps one large mailbox from
starving the rest: without it a first backfill outlasts the sync interval, and
`skipWhileRunning` then suppresses every other account's tick until it finishes. The cursor
is persisted per page, so stopping mid-history is safe and the next tick resumes exactly
where the last one stopped.

**Failure** is per account. One dead server must not end the tick for everyone else.
Each failure sets `status='error'` with a detail, reports to Sentry, and schedules the next
attempt at `base * 2^failures` with jitter and a ceiling — jitter because otherwise every
mailbox that failed during one outage retries in the same instant when the server returns.

Past `MAX_SYNC_FAILURES` the mailbox stops being claimed and waits for the user. That
crossing is audited; failures below it are not, following the line
`connectedAccountService` already draws — a transient failure records what a remote server
answered, not a change anyone made. The way back is `POST /api/v1/connected-accounts/:id/test`,
which clears the counter and the timestamp, putting the mailbox straight back in the
schedule.

**Feature flags** are checked at two levels: the org-wide `email_sync` kill switch once per
tick, then `isFlagEnabledForUser` per account. Both are needed — a per-user `force_enabled`
override beats every downstream targeting rule, so only the org-wide check can stop a
rollout wholesale.

## Configuration

| Variable                      | Default | Meaning                      |
| ----------------------------- | ------- | ---------------------------- |
| `EMAIL_SYNC_INTERVAL_MINUTES` | 15      | Minutes between ticks, 1-59. |

Resolved once at boot. A value outside that range falls back to the default rather than
producing an invalid cron expression.

## Testing

Most IMAP specs drive a hand-written fake `ImapFlow` injected as a client factory, because
a fake is the only way to reach an error path a real server will not produce on demand.

**That fake is the load-bearing risk in this area.** Several defects here were invisible
because the fake disagreed with the real library rather than because the provider was
wrong: it accepted any fetch query rather than the sequence set the body pass sends, turning a
wrong query shape into every body arriving null, it reported `name` as the whole path
where imapflow reports the leaf, it yielded
messages in array order where a real server may use any, and it synthesized a special-use
source that made a fallback branch unreachable. Audit it field by field against
`FetchMessageObject` and `ListResponse` before trusting a new assertion built on it.

`imapProviderLive.test.ts` closes part of that gap by running the provider against
GreenMail, a real IMAP server in the test stack (IMAP 3143, SMTP 3025). It is a server
test rather than an E2E spec: nothing triggers a sync over HTTP, there is no read API for
stored messages, and CI never invokes Compose. It stubs `assertHostSafe`, which the SSRF
guard's own seam sanctions, because GreenMail sits on a private address.

**Now observed rather than reasoned:** that bodies and subjects survive a real `source`
fetch, that a real attachment sets `has_attachments`, that the cursor advances so a re-sync
returns nothing new, and that a `uidValidity` mismatch invalidates a cursor. GreenMail
reports RFC 6154 special-use for both `\Inbox` and `\Sent` — measured, not assumed — and
`name` is the leaf while `path` carries the full `INBOX.Sent`, which is the fake's second
defect above, directly confirmed.

**Still reasoned, not observed:** every error and timeout path, which is why the fake stays.
The suite skips when GreenMail is unreachable, so a developer who has not started the test
stack gets a skip rather than a red build — which also means a broken GreenMail service
would go quiet rather than loud. Check that it reports 4 passed, not 4 skipped, when you
depend on it.

The mailbox login is `rep`, **not** `rep@example.com`: GreenMail reads
`-Dgreenmail.users=rep:secret-pass-12@example.com` as user `rep`, password
`secret-pass-12`, domain `example.com`.

### The Gmail fake and Google's Discovery Document

Gmail has no sandbox, so `gmailProvider.test.ts` drives a fake — and its failure mode is
agreeing with us rather than with Google. Every 2xx body it returns is validated against a
vendored copy of the Discovery Document
(`server/src/__tests__/__fixtures__/gmail-discovery.json`).

Discovery is not JSON Schema: nothing in the published document carries `required` or
`additionalProperties`, so `gmailSchema.ts` injects both. `required` lists only fields the
driver dereferences unguarded — `Message.threadId` is deliberately absent, because the RFC
5322 fallback exists for a message that arrives without one.

To refresh it, re-run the transitive closure rather than hand-adding a schema — the fixture
holds the schemas the driver reads plus everything they `$ref`, and a dangling reference
fails at compile time inside an unrelated test:

```bash
curl -s 'https://gmail.googleapis.com/$discovery/rest?version=v1' > /tmp/discovery.json
# then re-derive the closure from Message, Profile, ListMessagesResponse, ListHistoryResponse
```

No test fetches it: a green build must not depend on Google being reachable. The revision
is recorded in the fixture, and the suite asserts it is present — which catches a copy
pasted in without provenance, not a fabricated one.

Run server tests from `server/`, not the repo root — from the root every test errors with
`describe is not defined` before the file loads, which during mutation testing looks
exactly like a caught mutation and proves nothing.

`feature_flags` is one global row with no per-file isolation, and several suites toggle
the same keys. A test that depends on a flag must set it explicitly rather than assert on
the ambient value.

## Not covered here

- **The Microsoft Graph provider** — the seam exists; the driver does not.
- **Matching messages to CRM records, and any read API or UI** — this engine writes rows
  nothing yet reads. `is_private` ships defaulted to `false` with no writer.
- **GDPR erasure for synced mail, and the backfill window as an admin setting** — the
  window is a module constant until that lands.
- **Validation against a real IMAP server** — three behaviors here are reasoned from RFC
  3501 and imapflow's own source rather than observed: `UIDNEXT` as a lower bound,
  `bodyStructure`-derived `has_attachments`, and the body pass's `source` fetch over a
  comma-separated UID set.
