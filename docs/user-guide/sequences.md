# Sequences

> **Feature flag:** Sequences require the **Sequencing** feature flag.
>
> **Authoring sequences is an admin task.** The **Sequences** page lives under the admin
> navigation and non-admins cannot reach it — see
> [Admin guide — Sequences](../admin-guide.md#22-sequences) for creating one and adding
> steps. This page covers the half any rep can do: enrolling a contact and following the
> tasks that result.

Sequences are multi-step cadences that schedule follow-up tasks for a contact
automatically. Each step fires a set number of days after the previous one **fired** —
elapsed time, not your progress — so the cadence keeps running whether or not you have
worked the earlier tasks. Every step is owned by the contact's owner, not by whoever
enrolled them.

**What sequences can do:**

| Step type           | What it creates                                                 |
| ------------------- | --------------------------------------------------------------- |
| Send email reminder | An open **Task** on the contact, subject prefixed `Send email:` |
| Log call reminder   | An open **Call** activity on the contact                        |
| Create task         | An open **Task** on the contact                                 |

> Steps create tasks and reminders in MiniCRM — they do not send emails or make calls
> automatically. You do the work yourself; marking a task complete records that you did,
> and does not affect when the next step fires.

---

## Tutorial: enroll a contact

### Step 1 — Open the contact

Open the contact you want to enroll and scroll to the **Active Sequences** section. If it
is missing, ask an admin to enable the **Sequencing** feature flag; viewers and service
accounts do not see it at all.

### Step 2 — Enroll

1. Click **Enroll in sequence**.
2. Pick the sequence from the dropdown and click **Enroll**.

The contact is now enrolled and the first step is scheduled, its delay counted from now —
so a first step with no delay fires on the next quarter-hour tick. A sequence has to be
enabled and have at least one step before it accepts enrollments, and a contact can only
hold one active enrollment per sequence.

> Enrolling is available to every role except viewer and service account. Creating and
> editing the sequences themselves is admin-only.

---

## Completing sequence steps

When a sequence step fires, a task appears in the contact's activity timeline and on your
**My Tasks** page.

1. Complete the task (call the contact, send the email, etc.).
2. Mark the task as complete in MiniCRM.

Marking the task complete records your work; it does not move the sequence along. A
background job advances due enrollments every 15 minutes, and each step's delay is counted
from the moment the previous step fired — so the next task arrives on schedule even if the
last one is still sitting open.

---

## Unenrolling a contact

To stop a sequence before it finishes:

1. Open the contact's detail page.
2. In the **Active Sequences** section, find the sequence.
3. Click **Unenroll** and confirm the dialog.

No further steps will fire. The contact's enrollment record is kept with status
_Unenrolled_ for reference.

---

## Reference

### Enrollment statuses

| Status     | Meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| Active     | The contact is enrolled and steps are still firing           |
| Completed  | Every step has fired; the last task may still be open        |
| Unenrolled | Manually unenrolled before completion; no further steps fire |

### If a sequence stops

An enrollment ends in one of two ways: every step fires, or someone unenrolls the contact.
Nothing the recipient does — replying, bouncing, unsubscribing — affects it, because
MiniCRM never sends the messages itself.

Disabling a sequence does not end its active enrollments; they stop advancing and resume
if it is re-enabled. Unenroll the contact yourself if you need it genuinely stopped.

### Editing a live sequence

Each step's text is read when it comes due, so an admin's edit to a step that has not
fired yet does reach contacts already enrolled. Steps that have already fired are
unaffected, and a step that an enrollment is currently waiting on cannot be deleted at
all.

### Placeholders are not substituted

The step-authoring form suggests `{{contact_name}}` in its example text, but nothing
replaces it — the subject and body reach your task exactly as an admin typed them. Edit
the text yourself before sending, or ask your admin to leave placeholders out of the
sequence.
