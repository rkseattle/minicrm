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
3. Scroll to the **GDPR & Privacy** section at the bottom of the page.
4. Click **Erase personal data**.
5. Review the list of fields that will be erased and the note about what will be preserved.
6. Optionally enter a reference note (e.g., the request ticket number or date the request was received).
7. Type `ERASE` in the confirmation field.
8. Click **Erase personal data** to confirm.

After erasure:

- All personal data fields on the record are replaced with `[GDPR deleted]`.
- The email address is replaced with a synthetic non-exposing address (`gdpr-deleted-<id>@gdpr.invalid`).
- Subject and notes on all linked activities are scrubbed.
- Title, body, and body_text on all linked notes are scrubbed.
- All custom field values for the record are deleted.
- The audit log continues to show that events occurred, but old_value and new_value are masked with `[GDPR deleted]`.
- A `gdpr_erasure` entry is added to the audit log recording that the erasure was performed, by whom, and when.
- The record itself (ID, timestamps, owner, stage, deal associations) is preserved so that business data integrity is maintained.

A second erasure request on an already-erased record returns a 409 error.

#### Art. 15 — Right of Access

An admin user can download a complete JSON export of all personal data held for a contact or lead.

##### Step-by-step: how to respond to a Right of Access request

1. Navigate to the contact or lead record.
2. Scroll to the **GDPR & Privacy** section.
3. Click **Download data export**.
4. The browser downloads a JSON file containing: the contact/lead record, all linked activities, all linked deals, all linked notes, all custom field values, and the full audit history for the record (with GDPR masking applied if erasure has occurred).
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

The erasure endpoint accepts an optional body: `{ "notes": "string" }` for recording a reference note in the deletion log.

The export endpoint returns a `Content-Disposition: attachment` JSON file.
