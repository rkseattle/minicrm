# GDPR & Privacy Compliance

This document covers how MiniCRM handles personal data, how operators should respond to data subject requests, and which responsibilities belong to MiniCRM vs. to the operator.

---

## What personal data MiniCRM stores and why

MiniCRM is a CRM — its core function is to store information about contacts and leads so that sales representatives can manage relationships. The following personal data is stored:

### Contacts

- Identifying information: first name, last name, email address, phone number
- Professional context: job title, department, linked account
- Address: address lines, city, state/region, postal code, country
- Social profiles: LinkedIn URL, Twitter/X URL, other URL
- Linked activities (calls, emails, meetings, tasks): subject, notes
- Notes authored against the contact record

### Leads

- Identifying information: first name, last name, email address, phone number
- Company context: company name
- Notes field on the lead record
- Notes authored against the lead record

### What is not personal data (and is therefore retained after erasure)

- Record IDs and internal timestamps
- Owner assignments, stage values, deal amounts
- Pipeline metadata and deal structure
- The audit trail structure (that events occurred — not the personal values in those events)

---

## Data subject rights under GDPR

GDPR grants data subjects eight rights. MiniCRM provides software features for three of them. The remaining five are the operator's responsibility.

### Rights handled by MiniCRM features

#### Art. 17 — Right to Erasure ("Right to be Forgotten")

An admin user can erase all personal data fields for a contact or lead while preserving the record structure and audit history.

##### Step-by-step: how to respond to a Right to Erasure request

1. Log in as an admin user.
2. Navigate to the contact or lead record for the data subject.
3. Scroll down to the **GDPR & Privacy** section, below **Change History**.
4. Click **Erase personal data**.
5. Review the list of fields that will be erased and the note about what will be preserved.
6. Optionally enter a reference note (e.g., the request ticket number or date the request was received).
7. Type `ERASE` in the confirmation field.
8. Click **Erase personal data** to confirm.

After erasure:

- All personal data fields on the record are replaced with `[GDPR deleted]`.
- The email address is replaced with a synthetic non-exposing address (`gdpr-deleted-<id>@gdpr.invalid`).
- Subject and notes on all linked activities are scrubbed.
- Title, body, and body_text on all linked notes are scrubbed, including notes that were
  already deleted — the row still holds the data until it is scrubbed.
- All custom field values for the record are deleted.
- The audit log continues to show that events occurred, but old_value and new_value are masked with `[GDPR deleted]`.
- A `gdpr_erasure` entry is added to the audit log recording that the erasure was performed, by whom, and when.
- The record itself (ID, timestamps, owner, stage, deal associations) is preserved so that business data integrity is maintained.

A second erasure request on an already-erased record returns a 409 error.

#### AI data cascade

Erasing a contact or a lead also redacts that person from AI chat data. This runs as a
separate step after the erasure commits, so its outcome is recorded separately from the
erasure itself.

What it touches, searching for the erased name and email — plus, for a lead, the
company name and notes the erasure also scrubs:

- `ai_messages.content` — matching text is replaced with `[redacted]`
- `ai_messages.pending_action` — cleared when it references the erased person
- `ai_sessions.name` — replaced with `[GDPR deleted]`
- `user_ai_context` — matching entries are deleted outright

Matching is on whole words, so erasing a contact named "Ann" does not rewrite the word
"annual".

**Every search term is capped at 200 characters — the name and email included.** A lead's
free-text fields, its company name and notes, carry a minimum of 12 as well.

The maximum exists because all the terms share one search pattern, so a single oversized
value would make the pattern fail and abort the cascade for every term at once. It is a
deliberate margin, not the point at which that happens. The minimum exists because a
short free-text value is as likely to be a common phrase as an identifier: a lead whose
notes read "Follow up" would otherwise have that phrase redacted from every user's chat
history.

**A value outside those bounds is not searched**, so references to it may remain in chat
history after an erasure that reports success. In practice that means a short company
name such as "Acme Corp", a notes field longer than a couple of sentences, and — rarely,
since lead names have no length limit of their own — an unusually long name or email.

Each skipped value is logged as `gdpr: cascade skipped identifiers outside the searchable
length bounds` with a count, so an incomplete erasure is identifiable from the server log
even though the cascade row still reads `completed`.

> **There is no API remedy for this case.** The re-run endpoint requires the identifiers
> a _failed_ cascade stored, and a cascade that skipped a term still completed, so it has
> no failed row and the re-run returns `409`. Purging the residual references means
> reaching the AI tables directly, outside the product.

A cascade can also fail outright, which is a different situation with a different remedy.

> **Warning — a successful erasure does not prove the cascade succeeded.** The cascade
> cannot fail the erasure that triggered it: errors are caught and logged, never
> propagated. So the erasure returns success, and the manual re-run endpoint returns
> `202 Accepted`, regardless of the cascade's outcome. Before certifying an Art. 17
> request as complete, confirm the cascade separately.

##### Verifying a cascade completed

`GET /api/v1/gdpr/contacts/:id/ai-cascade` (or `.../leads/:id/...`) returns the log for
that record, newest first. A `status` of `completed` means the cascade's transaction
committed; `failed` means it did not, and `error_detail` carries the reason.

Two limits are worth knowing when signing off:

- **The counts are partial.** `messages_redacted` and `context_entries_removed` are
  recorded, but the `ai_sessions.name` redaction has no count. A `completed` row tells
  you the transaction committed, not how much it touched.
- **No log row at all** means either that the cascade has not finished yet — it runs
  asynchronously, typically within seconds — or that it failed and could not even record
  the failure. The server log carries `gdpr: AI cascade failure could not be recorded` in
  that second case, alongside `gdpr: AI cascade failed`.

If a cascade failed, `POST` to the same path to re-run it. A re-run searches on the name
and email recovered from the failed row; for a lead, the company name and notes are not
recovered, because the erasure has already cleared them from the record.

A re-run is possible only while a failed row still holds those identifiers. If none does
— no cascade has failed, or a later one succeeded and cleared them — the endpoint returns
`409 GDPR_CASCADE_PII_UNAVAILABLE` rather than running a search with nothing to search
for, which would record a completed cascade that purged nothing.

The log keeps every attempt, so after a successful re-run the earlier `failed` row is
still there. The newest row is the current state.

##### Retained identifiers on a failed cascade

A failed cascade stores the erased person's real name and email on its log row, so a
re-run can find the same records. A successful cascade clears them immediately.

This means a **permanently failing** cascade leaves that name and email in
`ai_gdpr_cascade_log` indefinitely. They are never returned by the API — the endpoint
above omits those columns — but they are in the database, and an Art. 17 request is not
fully satisfied while they remain. Re-run the cascade until it succeeds, which clears
them.

#### Art. 15 — Right of Access

An admin user can download a complete JSON export of all personal data held for a contact or lead.

##### Step-by-step: how to respond to a Right of Access request

1. Navigate to the contact or lead record.
2. Scroll to the **GDPR & Privacy** section.
3. Click **Download data export**.
4. The browser downloads a JSON file containing: the contact/lead record, all linked activities, all linked deals, all linked notes (private ones included — see below), all custom field values, and the full audit history for the record (with GDPR masking applied if erasure has occurred).
5. Provide this file to the data subject.

#### Art. 20 — Right to Data Portability

The JSON export described above also satisfies Art. 20. The export is machine-readable structured data (JSON) and can be processed by other systems.

---

### Rights that are the operator's responsibility

These rights do not require specific software features — they are process or documentation obligations:

| Right                                          | Article    | Operator responsibility                                                                                     |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| Right to be informed                           | Art. 13/14 | Publish a privacy notice explaining what you collect, why, and how long you retain it.                      |
| Right of rectification                         | Art. 16    | Admin or rep users can edit contact/lead fields at any time via the standard edit form.                     |
| Right to restrict processing                   | Art. 18    | Implement an operational procedure (e.g., a "do not contact" tag or a rep note) to flag restricted records. |
| Right to object                                | Art. 21    | Implement an operational procedure to flag and honour objections.                                           |
| Right not to be subject to automated decisions | Art. 22    | MiniCRM's automation rules do not make legally significant automated decisions.                             |
| Records of processing activities               | Art. 30    | Maintain your own Art. 30 register documenting the purposes and lawful basis for processing in MiniCRM.     |

---

### The erasure log

Every erasure writes one row to `gdpr_deletion_log`, retained indefinitely by design: it
is the record that the request was honored.

> **Warning — keep personal data out of `notes`.** The optional note on an erasure is
> free text, stored verbatim, retained with the row forever, and returned by both
> `GET /api/v1/gdpr/deletions` and the status endpoint. A note naming the data subject
> — "request from jane.doe@example.com" — leaves their personal data in a table the
> erasure was performed to clear. Reference the request by ticket number.

Two columns matter when auditing one:

- **`erasure_scope`** — the fields the erasure overwrote, recorded at the time it ran, so
  a later change to what counts as personal data does not rewrite history. Note it lists
  the fields cleared by name and omits `email`, which is always replaced with the
  synthetic address whatever the scope says.
- **`completed_at`** — `NULL` until every write in the erasure has succeeded. Because the
  whole erasure is one transaction, a row visible with `completed_at` still `NULL` means
  the erasure did not commit. It also drives the audit-log masking: only records with a
  completed erasure have their `old_value` and `new_value` replaced with
  `[GDPR deleted]` in exports.

`GET /api/v1/gdpr/deletions` lists these rows; `GET /api/v1/gdpr/status/:recordType/:recordId`
returns the one for a single record.

## Recommended retention policy template

GDPR requires that personal data is not kept longer than necessary. As a starting point:

- **Active contacts and leads:** Retain while there is an active business relationship or a legitimate interest.
- **Inactive contacts (no activity in N years):** Review periodically and erase if there is no remaining lawful basis for retention. A typical retention window is 3–5 years of inactivity.
- **Erased records:** The anonymised record shell and audit history are retained indefinitely for business data integrity.

Document your chosen retention period in your Art. 30 register.

---

## Operator responsibilities summary

| Area                                 | MiniCRM provides       | Operator provides                                           |
| ------------------------------------ | ---------------------- | ----------------------------------------------------------- |
| Erasure tool                         | Yes — admin UI and API | Operational procedure for receiving and tracking requests   |
| Access / portability export          | Yes — JSON download    | Delivery of the export to the data subject                  |
| Lawful basis for processing          | No                     | Document in your Art. 30 register                           |
| Consent management                   | No                     | Implement separately if consent is your lawful basis        |
| Privacy notice                       | No                     | Publish a privacy notice for your end users                 |
| Data breach notification             | No                     | Implement a breach response procedure                       |
| DPA / controller-processor agreement | No                     | Sign a DPA if you are a processor on behalf of a controller |

---

## API reference

All GDPR endpoints require admin authentication.

| Method | Path                                        | Description                               |
| ------ | ------------------------------------------- | ----------------------------------------- |
| `POST` | `/api/v1/contacts/:id/gdpr-erase`           | Erase personal data for a contact         |
| `GET`  | `/api/v1/contacts/:id/gdpr-export`          | Download full data export for a contact   |
| `POST` | `/api/v1/leads/:id/gdpr-erase`              | Erase personal data for a lead            |
| `GET`  | `/api/v1/leads/:id/gdpr-export`             | Download full data export for a lead      |
| `GET`  | `/api/v1/gdpr/deletions`                    | Paginated list of all erasure log entries |
| `GET`  | `/api/v1/gdpr/status/:recordType/:recordId` | Check erasure status for a record         |
| `POST` | `/api/v1/gdpr/contacts/:id/ai-cascade`      | Re-run the AI cascade for a contact       |
| `GET`  | `/api/v1/gdpr/contacts/:id/ai-cascade`      | Read the AI cascade log for a contact     |
| `POST` | `/api/v1/gdpr/leads/:id/ai-cascade`         | Re-run the AI cascade for a lead          |
| `GET`  | `/api/v1/gdpr/leads/:id/ai-cascade`         | Read the AI cascade log for a lead        |

The erasure endpoint accepts an optional body: `{ "notes": "string" }` for recording a reference note in the deletion log.

The export endpoint returns a `Content-Disposition: attachment` JSON file.
