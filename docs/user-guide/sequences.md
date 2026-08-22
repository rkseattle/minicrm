# Sequences

> **Feature flag:** Sequences can be disabled by your admin. If the Sequences navigation
> item is missing, contact your admin to enable the **Sequencing** feature flag.

Sequences are multi-step cadences that schedule follow-up tasks for a contact
automatically. Each step fires a day or more after the previous one completes, keeping
outreach consistent without manual reminders.

**What sequences can do:**

| Step type           | What it creates                                                  |
| ------------------- | ---------------------------------------------------------------- |
| Send email reminder | Reminds you to send an email with the specified subject and body |
| Log call reminder   | Reminds you to log a call with the specified subject             |
| Create task         | Creates a general task linked to the contact with the subject    |

> Steps create tasks and reminders in MiniCRM — they do not send emails or make calls
> automatically. You complete each step manually, which triggers the next one.

---

## Tutorial: create a sequence and enroll a contact

### Step 1 — Create the sequence

1. Click **Sequences** in the navigation.
2. Click **New sequence**.
3. Enter a **Sequence name** (e.g. "New prospect follow-up") and an optional description.
4. Click **Create sequence**. The sequence detail page opens.

### Step 2 — Add steps

1. On the sequence detail page, click **Add step**.
2. Choose an **Action** type (Send email reminder, Log call reminder, or Create task).
3. Fill in the action details:
   - **Email reminder** — enter a subject and body. Use `{{contact_name}}` to personalise.
   - **Call reminder** — enter a subject and optional notes.
   - **Task** — enter a subject and optional notes.
4. Set **Delay (days)** — the number of days after the previous step completes before
   this step fires. Use `0` to fire immediately after the prior step.
5. Set a **Step #** (sort order) — steps run in ascending order.
6. Click **Save**.

Repeat to add as many steps as you need. A typical prospecting sequence might look like:

| Step | Action         | Delay | Subject                  |
| ---- | -------------- | ----- | ------------------------ |
| 1    | Email reminder | 0     | Introduction email       |
| 2    | Call reminder  | 3     | Follow-up call           |
| 3    | Email reminder | 5     | Check-in email           |
| 4    | Create task    | 7     | Final follow-up decision |

### Step 3 — Check the sequence is enabled

A new sequence starts **enabled**. It cannot be enrolled into until it has at least one
step, so an empty sequence is safe — but it becomes enrollable as soon as the first step is
saved. Use the **Enabled** switch on the sequence detail page (or from the sequences list) to
turn it off while you finish authoring, and back on when the steps are complete.

### Step 4 — Enroll a contact

1. Open the contact's detail page.
2. Scroll to the **Active Sequences** section.
3. Click **Enroll in sequence**.
4. Select the sequence from the dropdown and click **Enroll**.

The contact is now enrolled. The first step fires immediately (or after its configured
delay). Subsequent steps fire automatically as each prior step is completed.

---

## Completing sequence steps

When a sequence step fires, a task appears in the contact's activity timeline and in your
**My Tasks** dashboard section.

1. Complete the task (call the contact, send the email, etc.).
2. Mark the task as complete in MiniCRM.

Marking the step's task complete triggers the next step after its configured delay.

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
| Completed  | All steps have been completed                                |
| Unenrolled | Manually unenrolled before completion; no further steps fire |

### Sequence list columns

| Column           | Meaning                                                      |
| ---------------- | ------------------------------------------------------------ |
| Sequence name    | The name you gave the sequence                               |
| Steps            | Total number of steps in the sequence                        |
| Active Sequences | Number of contacts currently actively enrolled               |
| Enabled          | Whether the sequence is active and accepting new enrollments |

### Deleting a sequence

A sequence can only be deleted if it has no active enrollments. Unenroll all contacts
first, then delete from the sequences list using the **Delete** button.

### Editing steps

You can add, edit, or remove steps at any time. Changes to steps do not affect contacts
who are already enrolled — they continue on the original step schedule.

### Personalisation

In email and call reminder bodies you can use `{{contact_name}}` as a placeholder. It
is replaced with the contact's full name when the step fires.
