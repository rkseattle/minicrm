# My Tasks

> **Feature flag:** The **Activities** flag governs this page too — see
> [Activities](activities.md) for what happens when it is off.

**My Tasks** in the navigation opens a list of the Task-type activities assigned to you.
It is where you work your day: everything you owe someone, with the overdue ones called
out, and a way to tick them off without opening each record.

Tasks themselves are created from a contact, account, or deal — see
[Activities](activities.md). This page is only for working the ones you already own.

---

## Tutorial: work through your tasks

### Step 1 — Open your list

Click **My Tasks** in the navigation. You see the open tasks from the current page,
earliest due date first, with undated ones at the end. Completed tasks are hidden rather
than excluded — see [Counts can look wrong, and why](#counts-can-look-wrong-and-why).

Each row shows the task's **Subject**, **Type**, **Due date**, and the **Record** it is
linked to. Click the record name to open the contact, account, or deal it belongs to. A
task linked to nothing shows a dash.

### Step 2 — Spot what is overdue

A task is overdue when its due date has passed and it is still open. Those rows show the
date in red, followed by an **Overdue** badge.

For everyone except admins, the dashboard's **Overdue tasks** card links straight here
with the overdue filter applied. In that mode a red **Filtering: Overdue** chip replaces
the show/hide control, and you see only overdue tasks.

To get back to the full list, click **My Tasks** in the navigation again.
A **Clear filters** button appears only when the filter matches nothing at all, so it is
not there in the usual case where you arrived because you do have overdue tasks.

### Step 3 — Mark a task complete

Click **Mark complete** on the row. The button reads _Marking…_ while it saves, and the
row switches to struck-through text once it is done. Completed tasks drop out of the
list, because the list shows open tasks by default.

### Step 4 — Review what you have finished

Click **Show completed** to include completed tasks in the list. The button then reads
**Hide completed**. If you have none on the current page, a line reads _No completed
tasks._

---

## Reference

### Columns

| Column   | Notes                                                            |
| -------- | ---------------------------------------------------------------- |
| Subject  | The task's title                                                 |
| Type     | Always _Task_ — other activity types live on the record timeline |
| Due date | Red with an **Overdue** badge once it has passed                 |
| Record   | The linked contact, account, or deal; a dash when there is none  |
| Actions  | **Mark complete**, on open tasks only                            |

**No column on this page sorts.** The order is fixed: due date first, earliest to latest,
with undated tasks last, and oldest-created first among tasks sharing a due date. To slice
tasks another way, use [Reports](reports.md).

### Counts can look wrong, and why

The page fetches one page of tasks at a time and then hides the completed ones. Two
consequences are worth knowing, because both look like bugs:

- **The total counts completed tasks.** "Showing 1–25 of 60" counts every task you own,
  open and completed. Hiding the completed ones does not change that total.
- **A page can show fewer rows than its size.** With a page size of 25, a page holding
  ten completed tasks displays fifteen rows.

The same applies to the overdue filter: it filters the page you are on, so with more than
one page of tasks the count here can be lower than the dashboard's **Overdue tasks** card,
which counts them all.

### Empty states

An empty state replaces the list only while **Show completed** is off. With it on and
nothing to display, you get an empty area with no rows and no message — apart from the
separate _No completed tasks._ line below it.

| What you see                  | When                                                           |
| ----------------------------- | -------------------------------------------------------------- |
| _No open tasks_               | Nothing open on this page, and **Show completed** is off       |
| _No tasks match your filters_ | The overdue filter is on and nothing on this page is overdue   |
| _No completed tasks._         | **Show completed** is on and this page holds no completed ones |

### Deleting several tasks at once

Selecting rows with the checkboxes reveals a **Delete** action. This is available to
admins and managers only; if you do not see checkboxes, you do not have it.

Deletion is permanent, and the confirmation dialog says how many records it will remove.
Selection covers the page you are on, and it clears whenever the rows change underneath
it: moving to another page, changing **Rows per page**, or toggling **Show completed**.

### Overdue email digests

If your admin has enabled email notifications, you also receive a daily digest listing
your overdue tasks. Turn it off under **Profile Settings** → **Email Notifications**.
