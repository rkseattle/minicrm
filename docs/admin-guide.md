# MiniCRM Admin Guide

This guide covers everything an administrator needs to set up and operate MiniCRM.
For everyday usage (contacts, deals, activities), see the [User Guide](user-guide/index.md).

---

## Contents

1. [User Management](#1-user-management)
2. [Pipeline Stage Configuration](#2-pipeline-stage-configuration)
3. [System Settings](#3-system-settings)
4. [Branding](#4-branding)
5. [Demo Data](#5-demo-data)
6. [Automation Rules](#6-automation-rules)
7. [Onboarding Checklist](#7-onboarding-checklist)
8. [Feature Flags](#8-feature-flags)

---

## 1. User Management

### Tutorial: invite a new rep, set their password, and transfer records

#### Step 1 — Invite the user

1. Go to **Admin → Users** in the navigation.
2. Click **Invite user**.
3. Enter the new user's **Email address** and **Full name**.
4. Choose their **Role**: _Rep_ (standard user) or _Admin_ (full access).
5. Click **Send invite**.

The user receives an invitation email with a link to set their password.
Their status is shown as _Invited_ until they complete the flow.

> If email notifications are not configured yet, you can set a temporary password
> for the user directly — see Step 2.

#### Step 2 — Set or reset a password (admin-side)

1. On the **Users** list, find the user and click their name.
2. Click **Set password**.
3. Enter a temporary password and click **Save**.
4. The user's status changes to _Active_ and they are flagged to change their password
   on next login.

#### Step 3 — Change a user's role

1. Open the user's profile from the Users list.
2. Click **Edit**.
3. Change the **Role** dropdown.
4. Click **Save**.

#### Step 4 — Deactivate or reactivate a user

Deactivating a user prevents them from logging in without deleting their records.

1. Open the user's profile.
2. Click **Deactivate** (or **Reactivate** if they are already inactive).
3. Confirm the dialog.

> Deactivated users cannot log in. Their existing contacts, deals, and activities
> remain visible and searchable. You can reassign their records to another owner by
> editing each record.

#### Step 5 — Reset a user's onboarding checklist

See [Section 7 — Onboarding Checklist](#7-onboarding-checklist).

---

### Reference

| Status   | Meaning                                              |
| -------- | ---------------------------------------------------- |
| Invited  | Invitation sent; user has not yet set their password |
| Active   | User can log in                                      |
| Inactive | User is deactivated; cannot log in                   |

| Role  | Access level                                                                 |
| ----- | ---------------------------------------------------------------------------- |
| Rep   | Can manage their own contacts, deals, accounts, activities, leads, and notes |
| Admin | Everything a rep can do, plus all admin sections                             |

---

## 2. Pipeline Stage Configuration

### Tutorial: add a custom stage and reorder the pipeline

#### Step 1 — Open pipeline settings

1. Go to **Admin → Settings → Customisation** tab.
2. Find the **Pipeline Stages** section.

#### Step 2 — Add a new stage

1. Click **Add stage**.
2. Enter a **Stage name** (e.g. "Demo Scheduled").
3. Set a **Default probability** (0–100 %). This is the probability shown on deals
   in this stage until manually overridden.
4. Click **Save**.

The new stage appears in the pipeline board and in all stage selectors.

#### Step 3 — Reorder stages

1. In the Pipeline Stages list, drag a stage row up or down to change its position.
2. The pipeline board columns update to match the new order.

#### Step 4 — Rename a stage

1. Click the edit icon next to the stage.
2. Update the name and click **Save**.

> _Closed Won_ and _Closed Lost_ are **fixed stages** — they cannot be renamed or deleted.
> They always appear at the end of the pipeline.

#### Step 5 — Delete a stage

1. Click the delete icon next to the stage.
2. Confirm the dialog.

> You cannot delete a stage that has deals currently in it. Move or close those deals first.

---

### Reference

| Field               | Notes                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Name                | Unique; case-insensitive                                                          |
| Sort order          | Controls column order on the pipeline board                                       |
| Default probability | 0–100 %; applied to new deals entering this stage                                 |
| Fixed               | If yes, the stage cannot be renamed or deleted (_Closed Won_, _Closed Lost_ only) |

**Seed stages (defaults):**

| Stage         | Default probability |
| ------------- | ------------------- |
| Prospecting   | 10%                 |
| Qualification | 25%                 |
| Proposal      | 50%                 |
| Negotiation   | 75%                 |
| Closed Won    | 100% (fixed)        |
| Closed Lost   | 0% (fixed)          |

---

## 3. System Settings

### Tutorial: configure SMTP and set the default currency

#### Step 1 — Configure SMTP (outbound email)

MiniCRM sends email notifications (overdue task digests, assignment alerts, invitations)
via an SMTP relay you configure.

1. Go to **Admin → Settings → Notifications** tab.
2. Fill in:
   - **SMTP host** (e.g. `smtp.sendgrid.net`)
   - **SMTP port** (e.g. `587`)
   - **SMTP username**
   - **SMTP password** (stored encrypted; never shown again after saving)
   - **From address** (e.g. `crm@yourcompany.com`)
3. Toggle **Email notifications enabled** to on.
4. Click **Save**.
5. Use the **Send test email** button to verify delivery.

> The SMTP password is stored AES-256-GCM encrypted. If you need to change it, simply
> type a new value and save — the old one is replaced.

#### Step 2 — Set the default currency

1. Go to **Admin → Settings → General** tab.
2. Choose a **Default currency** from the dropdown.
3. Click **Save**.

New deals default to this currency. Existing deals keep their own currency.

---

### Reference: all system settings

| Setting                                       | Location          | Notes                                                         |
| --------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| Default language                              | General           | Language for all users who have not set a personal preference |
| Nav layout                                    | General           | _Sidebar_ or _Top bar_ navigation style                       |
| Default currency                              | General           | 3-letter currency code (USD, EUR, GBP, etc.)                  |
| Email notifications enabled                   | Notifications     | Master on/off for all outbound email                          |
| SMTP host / port / user / password / from     | Notifications     | Outbound mail relay config                                    |
| File storage endpoint / bucket / key / secret | Files             | S3-compatible storage for attachments                         |
| Branding                                      | Branding tab      | See Section 4                                                 |
| Pipeline stages                               | Customisation tab | See Section 2                                                 |

---

## 4. Branding

### Tutorial: upload a logo and set a brand colour

1. Go to **Admin → Settings → Branding** tab.
2. Click **Upload logo** and choose a PNG or SVG file (recommended: square, at least 256×256 px).
3. In the **Brand colour** field, enter a hex code (e.g. `#4F46E5`) or use the colour picker.
4. Optionally set a **Font** and toggle the **Powered by MiniCRM** badge.
5. Click **Save**.

Changes take effect immediately for all users on next page load.

To remove branding and return to defaults, click **Reset branding** at the bottom of the section.

---

### Reference

| Field            | Notes                                             |
| ---------------- | ------------------------------------------------- |
| Logo             | PNG or SVG; displayed in the navigation header    |
| Brand colour     | Hex code; used for primary buttons and accents    |
| Font             | Optional; overrides the default system font       |
| Powered by badge | Toggle to show/hide the MiniCRM attribution badge |

---

## 5. Demo Data

Demo data lets you populate a fresh MiniCRM instance with realistic sample contacts,
accounts, deals, leads, and activities — useful for onboarding or demos.

### Tutorial: seed demo data and reset it

#### Step 1 — Seed demo data

From the server command line (or via a one-off Docker run):

```bash
npm run seed:demo
```

This creates a set of demo records flagged with `is_demo = true`. They appear in all
lists and the pipeline board exactly like real records.

#### Step 2 — Remove demo data

To delete all demo records:

```bash
npm run seed:demo -- --reset
```

All records where `is_demo = true` are deleted. Real data is not affected.

> Demo records are clearly distinguishable by the `is_demo` flag in the database, but
> they do not carry any visible label in the UI. Consider seeding into a staging
> environment rather than production if you need to preserve a clean dataset.

---

## 6. Automation Rules

Automation rules let you trigger actions automatically when something happens in MiniCRM —
for example, create a follow-up task whenever a deal moves to Negotiation, or send a
notification when a new contact is added.

### Tutorial: create a rule that assigns a task when a deal moves to Negotiation

#### Step 1 — Open Automation

1. Go to **Admin → Automation**.
2. Click **New rule**.

#### Step 2 — Set the trigger

1. Set **Trigger** to _Deal stage changed_.
2. Set **Stage** to _Negotiation_ (or whichever stage you want to react to).

#### Step 3 — Set the action

1. Set **Action** to _Create task_.
2. Fill in:
   - **Task subject** — e.g. "Send final proposal"
   - **Task type** — e.g. _Meeting_
   - **Assignee** — _Owner of the deal_ (to assign to the deal owner) or _Specific user_
   - **Due date offset** — number of days after the trigger to set the due date (e.g. `2`)

#### Step 4 — Enable and save

1. Make sure the **Enabled** toggle is on.
2. Click **Save**.

The rule fires automatically the next time any deal moves to Negotiation.

#### Step 5 — Monitor rule execution

1. Open the rule from the Automation list.
2. Click the **Execution log** tab.
3. Each row shows when the rule fired, which record triggered it, and whether it
   succeeded or failed.

---

### Reference

#### Triggers

| Trigger              | Fires when                                    |
| -------------------- | --------------------------------------------- |
| `deal_stage_changed` | A deal's stage changes to the specified stage |
| `deal_created`       | A new deal is created                         |
| `contact_created`    | A new contact is created                      |

#### Actions

| Action              | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `create_task`       | Creates a Task-type activity linked to the triggering record       |
| `send_notification` | Sends an in-app notification to the deal/contact owner             |
| `send_webhook`      | POSTs a JSON payload to an external URL (single attempt, no retry) |

#### Notes

- Rules fire after the triggering operation commits to the database.
- A failing rule does not roll back the original operation — it is logged and skipped.
- Multiple rules can fire on the same trigger.
- The `send_webhook` automation action is independent of the webhook subscription system
  (see [webhooks.md](webhooks.md)) — it does not use HMAC signing and makes only one attempt.

---

## 7. Onboarding Checklist

The onboarding checklist is a floating widget that appears for each user when they first
log in. It guides them through the key setup steps for their role and disappears once all
tasks are complete.

### What the checklist shows

**Admin checklist** (5 tasks):

| Task                   | Completed when                                                    |
| ---------------------- | ----------------------------------------------------------------- |
| Review pipeline stages | Admin visits the Pipeline Stages settings and marks them reviewed |
| Invite a team member   | At least one active non-admin user exists                         |
| Add your first contact | At least one non-demo contact exists in the system                |
| Create your first deal | At least one non-demo deal exists in the system                   |
| Configure SMTP         | SMTP host is saved in system settings                             |

**Rep checklist** (4 tasks):

| Task                      | Completed when                                      |
| ------------------------- | --------------------------------------------------- |
| Add your first contact    | At least one non-demo contact exists in the system  |
| Create your first account | At least one non-demo account exists in the system  |
| Create your first deal    | At least one non-demo deal exists in the system     |
| Log your first activity   | At least one non-demo activity exists in the system |

Tasks are checked automatically — users do not manually tick them off.

### Tutorial: reset a user's checklist

Resetting the checklist makes the widget reappear for that user on their next page load.
It does **not** un-complete tasks that are backed by real data (for example, if a contact
already exists, the "Add your first contact" task will still show as complete immediately).

1. Go to **Admin → Users**.
2. Click the user whose checklist you want to reset.
3. Click **Reset onboarding checklist**.
4. Confirm the dialog.

The user's checklist will reappear the next time they load the app.

### Dismissing the checklist

Any user can dismiss the checklist by:

- Clicking the **×** button on the widget, or
- Completing all tasks (the widget auto-dismisses after a short delay).

Once dismissed the widget does not reappear unless an admin resets it.

---

## 8. Feature Flags

Feature flags let administrators enable or disable individual product features without
a code deployment. The **Features** tab under **Admin Settings** shows all available flags.

### What feature flags control

Each flag corresponds to a named feature in the system. When a flag is disabled, the
associated API endpoints return `403 Forbidden` and the UI hides the relevant navigation
items or sections. Re-enabling a flag restores full access immediately — no restart required.

Flags are grouped by category (e.g. _Core CRM_, _Data_, _Integrations_). Each flag shows:

| Column             | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| **Label**          | Human-readable feature name                                         |
| **Status**         | Toggle showing whether the flag is currently on or off              |
| **Active users**   | Number of users who have used this feature in the last 30 days      |
| **Role overrides** | Per-role on/off state (shown when the flag has role-level controls) |

### Tutorial: disable a feature

1. Go to **Admin Settings → Features**.
2. Find the flag you want to disable.
3. Click its toggle.
4. A confirmation dialog appears — review the warning (it will show how many active users
   will be affected) and click **Confirm**.

The flag is disabled immediately. Users who are currently using that feature will receive
a `403` error on their next request to a guarded endpoint.

### Tutorial: re-enable a feature

1. Go to **Admin Settings → Features**.
2. Find the disabled flag (marked **OFF**).
3. Click its toggle and confirm.

Access is restored immediately for all users.

### Role overrides

Some flags support per-role configuration. When role overrides are shown, you can
independently enable or disable a feature for _Admin_ and _Rep_ roles. The flag's
top-level enabled state acts as the master switch: if the flag is disabled, role overrides
have no effect.

### Audit trail

Every flag change is written to the audit log with the name of the admin who made the
change, the previous value, and the new value. You can review this history in
**Admin Settings → Data → Audit Log**.

### Notes

- Disabling a flag does not delete any data — it only gates access to the feature.
- The **Active users** count reflects usage in the trailing 30-day window and updates
  automatically as users interact with the system.
- System flags (marked with a lock icon) cannot be deleted, but they can be toggled off.
