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
   provider-specific parsing.
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
5. Bound anything that reaches an indexed column. `thread_id` and `provider_message_id`
   both carry btree indexes, which reject an entry over roughly a third of a page.

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

**No message body is fetched.** Turning a raw MIME document into text needs a parser this
service does not carry; that work is its own ticket.

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

There is no IMAP server in the test stack — MailHog speaks SMTP only — so the provider is
tested against a hand-written fake `ImapFlow` injected as a client factory.

**That fake is the load-bearing risk in this area.** Several defects here were invisible
because the fake disagreed with the real library rather than because the provider was
wrong: it reported `name` as the whole path where imapflow reports the leaf, it yielded
messages in array order where a real server may use any, and it synthesized a special-use
source that made a fallback branch unreachable. Audit it field by field against
`FetchMessageObject` and `ListResponse` before trusting a new assertion built on it.

Run server tests from `server/`, not the repo root — from the root every test errors with
`describe is not defined` before the file loads, which during mutation testing looks
exactly like a caught mutation and proves nothing.

`feature_flags` is one global row with no per-file isolation, and several suites toggle
the same keys. A test that depends on a flag must set it explicitly rather than assert on
the ambient value.

## Not covered here

- **Message bodies and snippets** — needs a MIME parser; its own ticket.
- **Gmail and Microsoft Graph providers** — the seam exists; the drivers do not.
- **Matching messages to CRM records, and any read API or UI** — this engine writes rows
  nothing yet reads. `is_private` ships defaulted to `false` with no writer.
- **GDPR erasure for synced mail, and the backfill window as an admin setting** — the
  window is a module constant until that lands.
- **Validation against a real IMAP server** — two behaviors here are reasoned from RFC
  3501 rather than observed: `UIDNEXT` as a lower bound, and `bodyStructure`-derived
  `has_attachments`.
