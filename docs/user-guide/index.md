# MiniCRM User Guide

Welcome to MiniCRM — a lightweight sales CRM for managing contacts, accounts, deals,
activities, leads, and notes in one place.

---

## Who this guide is for

This guide is written for everyday users (sales reps and managers). No technical knowledge
is required. If you are an admin setting up the system, see the
[Admin Guide](../admin-guide.md).

---

## Pages in this guide

| Page                                      | What it covers                                                                                                                                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Contacts](contacts.md)                   | Creating and managing contact records, tagging, file attachments, GDPR erasure, AI Champion/Blocker badge, AI contact enrichment, AI Draft Email, AI duplicate explanation, AI sentiment tracking, AI warm introduction paths, AI smart follow-up timing suggestions |
| [Accounts](accounts.md)                   | Company records, account types, parent/child hierarchy, AI churn/expansion detection, AI duplicate explanation, AI sentiment tracking, AI relationship health scoring, notifications                                                                                 |
| [Deals](deals.md)                         | Pipeline board, moving deals through stages, currency, probability, AI deal health, stage advancement, champion/blocker detection, proposal drafts                                                                                                                   |
| [Activities](activities.md)               | Logging calls, emails, meetings, and tasks, AI objection pattern matching, AI call/note summarizer, AI follow-up task suggestions, AI pre-meeting brief                                                                                                              |
| [Leads](leads.md)                         | Capturing prospects, qualifying them, and converting to contacts/deals, AI lead score and narrative explanation                                                                                                                                                      |
| [My Tasks](my-tasks.md)                   | Working the tasks assigned to you — overdue chips, mark complete, page-scoped counts                                                                                                                                                                                 |
| [Profile Settings](profile.md)            | Your language, email notification preferences, and two-factor authentication                                                                                                                                                                                         |
| [Data Hygiene](data-hygiene.md)           | The nightly data-quality queue for records you own — update, merge, archive, dismiss                                                                                                                                                                                 |
| [Notes](notes.md)                         | Adding contextual notes with visibility controls                                                                                                                                                                                                                     |
| [Dashboard](dashboard.md)                 | Reading the stat cards, the pipeline-by-stage table, and the recent activity feed                                                                                                                                                                                    |
| [Coaching Insights](coaching-insights.md) | Comparing reps against team averages — managers and admins only                                                                                                                                                                                                      |
| [Reports](reports.md)                     | Win/Loss, Activity Volume, Pipeline Stage Trend, Custom Reports, AI Win/Loss Pattern Insights                                                                                                                                                                        |
| [Sequences](sequences.md)                 | Enrolling contacts in follow-up cadences (authoring them is an admin task)                                                                                                                                                                                           |
| [AI Assistant](ai-assistant.md)           | Conversational AI for querying CRM data and drafting content (flag-gated)                                                                                                                                                                                            |

---

## Logging in

1. Open MiniCRM in your browser (your admin will give you the URL).
2. Enter your email address and password, then click **Sign In**.
3. If this is your first login you may be prompted to set a new password before continuing.

---

## Navigation

Use the sidebar (or top navigation, depending on your admin's layout setting) to move
between sections. The active section is highlighted. On smaller screens the sidebar
collapses into a menu icon at the top.

---

## Searching

The **Search** box in the header searches across your records. Type at least two
characters — below that it prompts you rather than searching.

Results are grouped under **Contacts**, **Accounts**, **Deals**, and **Leads**, with up
to ten matches in each group. You see only records you own; admins see everything.

Those four groups are what the dropdown shows, but the search itself looks wider than
that. A record surfaces when the text matches any of:

- Names, email addresses, phone numbers, job titles, and departments
- Postal addresses, down to the city and country
- Note text on the record, excluding private notes belonging to someone else
- Tag names — matching a tag surfaces everything carrying it
- The subject, notes, and outcome of logged activities, which surface the contact,
  account, or deal the activity belongs to
- A deal's value, with or without a leading `$` and thousands separators, so `120000`,
  `120,000`, and `$120,000` all find the same deal

Because activity and tag matches are appended after direct matches and the list is then
cut to ten, a record found only through its tag or its activity history can be pushed
out of a full result set. If you expect something and do not see it, narrow the search
rather than scrolling.

---

## Working with lists

### Sorting

Only some columns sort, and which ones differ by page:

| Page       | Sortable columns                         |
| ---------- | ---------------------------------------- |
| Contacts   | Name, Email                              |
| Deals      | Name, Close date (list view)             |
| Accounts   | Name only — clicking flips direction     |
| Leads      | None                                     |
| Activities | None                                     |
| My Tasks   | None — fixed to due date, earliest first |

Clicking a new column sorts ascending; clicking the active one flips the direction.
Either way you are returned to the first page.

### Pagination

Every list shows **Showing 1–25 of 60** style counts with **Previous** and **Next**
buttons. Most also have a **Rows per page** control offering 10, 25, 50, and 100; the
default is 25, and changing it returns you to the first page. Activities is the
exception — it pages at a fixed size with no control.

### Bulk actions

Selecting rows with the checkboxes reveals a bar showing how many are selected and the
actions available:

| Page       | Actions                                          |
| ---------- | ------------------------------------------------ |
| Contacts   | **Reassign owner**, **Delete**                   |
| Leads      | **Reassign owner**, **Delete**                   |
| Deals      | **Reassign owner**, **Change stage**, **Delete** |
| Activities | **Reassign owner**, **Delete**                   |
| Accounts   | **Reassign owner**, **Delete**                   |
| My Tasks   | **Delete**                                       |

Bulk actions are for admins and managers on every page except Accounts, where anyone who
can edit records — reps included — gets them. If you do not see checkboxes, you do not
have bulk actions on that page.

**Select all selects the page you are on**, not the whole filtered result set. The
selection clears whenever the rows change underneath it — changing page, changing the
page size, or changing a filter.

A single action covers at most 500 records. There is no warning as you approach it; a
larger selection is simply refused by the server. Since select-all is page-scoped and
the largest page size is 100, reaching that cap takes deliberate accumulation across
pages.

If some records succeed and others fail, the bar reports both counts and narrows your
selection to just the failures, so clicking the action again retries only those.
**See details** lists the reason for each one.

> Accounts is the exception. Its bulk actions use an older endpoint that reports only
> how many records were affected — no per-record failures, no **See details**, and no
> 500-record cap.

---

## Getting help

If you encounter an error message you do not understand, note the error code shown in
the message (e.g. `CONTACT_EMAIL_DUPLICATE`) and share it with your admin.
