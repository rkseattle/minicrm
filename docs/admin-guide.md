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
9. [AI Configuration](#9-ai-configuration)
10. [AI Token Budgets](#10-ai-token-budgets)
11. [AI Role-Based Feature Access](#11-ai-role-based-feature-access)
12. [Data Visibility Scoping](#12-data-visibility-scoping)
13. [Roles and Capabilities](#13-roles-and-capabilities)

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

---

## 9. AI Configuration

> **Feature flag:** `ai_features`
>
> The AI configuration page is always visible to administrators. The **AI Features** flag
> in **Admin Settings → Features** is the master gate for AI-powered features shown to
> _all users_. The admin configuration page itself is not gated by this flag — you need
> to reach it to enable AI in the first place.

MiniCRM can integrate with an AI provider to power future AI-assisted features. The
**AI** tab under **Admin Settings** lets you configure the provider, model, API key,
deployment mode, and data processing agreement status.

### Tutorial: enable AI and connect to Anthropic

#### Step 1 — Open the AI settings tab

Go to **Admin Settings → AI**.

#### Step 2 — Configure the provider and model

1. Select **Provider** — currently only _Anthropic_ is supported.
2. Select a **Model** from the available list (e.g. _Claude Sonnet 4_).
3. Under **Deployment mode**, choose one of:
   - **Cloud API** — calls go to Anthropic's public API (default).
   - **Private endpoint** — calls go to a custom HTTPS base URL (enter it in the
     **Base URL** field that appears).
   - **Self-hosted** — your own on-premises deployment.

#### Step 3 — Enter the API key

Paste your Anthropic API key into the **API key** field. Once saved, the key is stored
encrypted at rest and is never displayed again. You can update it at any time by clicking
**Change**.

#### Step 4 — Test the connection

Click **Test connection** to verify that the key and model can reach the provider. A
success or failure message will appear beneath the button.

#### Step 5 — Acknowledge the data processing agreement

For _Cloud API_ and _Private endpoint_ modes, you must acknowledge your organisation's
data processing agreement (DPA) with Anthropic before the data posture indicator turns
green.

1. Review the [Anthropic DPA](https://www.anthropic.com/legal/data-processing-agreement)
   (the link is shown on the page).
2. If your organisation has a custom DPA on file, paste the URL in the **Custom DPA URL**
   field.
3. Tick the **I acknowledge the data processing agreement** checkbox.

Acknowledgment is recorded with your name and timestamp in the audit log. If you later
switch providers, the DPA status resets and you must re-acknowledge for the new provider.

Self-hosted deployments do not require a DPA acknowledgment (the green data posture is
granted automatically because data never leaves your infrastructure).

#### Step 6 — Enable AI globally

Click **Save** to persist the configuration, then use the **AI enabled** master toggle
at the top of the page to turn AI features on. A confirmation dialog will appear before
the state is changed.

### Reference

#### Data posture indicator

The data posture badge summarises the current risk classification:

| Badge | Meaning                                                                         |
| ----- | ------------------------------------------------------------------------------- |
| Green | AI is disabled, self-hosted mode is active, or DPA is fully acknowledged        |
| Amber | AI is configured but the DPA has not been acknowledged                          |
| Red   | DPA was acknowledged for a different provider than the one currently configured |

#### DPA status values

| Status           | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| Not acknowledged | No DPA acknowledgment on record                                      |
| Acknowledged     | DPA acknowledged for the current provider                            |
| Provider changed | Provider changed since the DPA was last acknowledged; re-acknowledge |

#### Available models (Anthropic)

| Model ID                    | Display name                 |
| --------------------------- | ---------------------------- |
| `claude-opus-4-8`           | Claude Opus 4.8              |
| `claude-sonnet-4-6`         | Claude Sonnet 4.6            |
| `claude-sonnet-4-20250514`  | Claude Sonnet 4 (2025-05-14) |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5             |

The model list is curated for stable production use. Contact support if you need access
to a model not listed here.

#### Audit trail

Every change to AI configuration is written to the audit log under the `ai_settings`
record type. This includes enabling/disabling AI, changing the provider or model, rotating
the API key (logged as `[redacted]`), and acknowledging or clearing the DPA.

#### Notes

- The API key is encrypted at rest using AES-256-GCM. It is never returned by the API —
  only an `api_key_set` boolean indicator is exposed.
- Changing the provider resets the DPA acknowledgment. You must re-acknowledge for the
  new provider before the data posture indicator turns green.
- The master toggle and configuration are separate operations. You can configure AI
  without enabling it globally, which is useful for staging your setup before rollout.

---

## 10. AI Token Budgets

> **Feature flags:** `ai_features`

Token budgets let you control how many AI tokens are consumed per user per month. All
counts are approximate (±5% due to provider-side rounding). Budgets reset automatically
at the start of each calendar month — no manual intervention is required.

### How limits work

| Limit value | Behaviour                                                    |
| ----------- | ------------------------------------------------------------ |
| `0`         | Unlimited — no enforcement. Default for new installations.   |
| `> 0`       | Monthly cap (input + output tokens combined) for that scope. |

**Org limit:** a shared cap applied to every Rep who does not have a personal override.
Admins are exempt from per-user enforcement and are never blocked, but their usage is
counted in org-wide totals.

**Per-user override:** when set, the per-user value replaces the org default for that
specific Rep. Set to **Org default** (null) to remove the override and fall back to the
org limit.

### Status thresholds

| Status       | Condition                              |
| ------------ | -------------------------------------- |
| **OK**       | Usage is below 80% of the limit        |
| **Warning**  | Usage is at or above 80% of the limit  |
| **Exceeded** | Usage is at or above 100% of the limit |

When a Rep's budget is **Exceeded**, their next AI request returns a `429` error with the
code `AI_BUDGET_EXCEEDED`. A red banner is shown at the top of every page until the budget
resets at the start of the next month.

When a Rep's budget is in **Warning**, an amber banner appears prompting them to contact
their admin.

### Tutorial: set the org monthly token limit

1. Go to **Admin Settings → AI → Token Budgets**.
2. Enter the desired monthly limit in the **Org Monthly Limit** field (e.g. `500000`).
   Enter `0` to remove the limit.
3. Click **Save Org Limit**.

All Reps without a personal override will now be subject to this limit.

### Tutorial: set a per-user token limit

1. Go to **Admin Settings → AI → Token Budgets**.
2. Locate the user in the **Current Month Usage** table.
3. Enter a value in the **Override** column and click **Save**, or click **Remove** to
   delete an existing override and return the user to the org default.

### Audit trail

Every change to token budgets is written to the audit log under the `ai_settings` record
type, with the old and new values. You can review this history in
**Admin Settings → Data → Audit Log**.

---

## 11. AI Role-Based Feature Access

> **Feature flags:** `ai_nli_page`, `ai_activity_summarizer`, `ai_email_draft`,
> `ai_task_suggestions`, `ai_contact_enrichment`, `ai_duplicate_explanation`,
> `ai_lead_score_narrative`, `ai_deal_health_check`, `ai_stage_advancement`

Individual AI sub-features can be enabled or disabled per role. This lets you roll out
specific AI capabilities to admins first, or restrict certain features to admins only,
without disabling AI entirely.

### Available AI sub-features

| Flag key                   | Feature                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `ai_nli_page`              | Natural-language query page (ask questions in plain text)  |
| `ai_activity_summarizer`   | Summarize recent activities on a contact, deal, or account |
| `ai_email_draft`           | Draft outbound emails from a prompt                        |
| `ai_task_suggestions`      | Suggest follow-up tasks after an activity                  |
| `ai_contact_enrichment`    | Enrich contact profiles with public data                   |
| `ai_duplicate_explanation` | Explain why two records were flagged as duplicates         |
| `ai_lead_score_narrative`  | Narrative explanation of a lead's score                    |
| `ai_deal_health_check`     | Health assessment and risk flags for a deal                |
| `ai_stage_advancement`     | Suggested next pipeline stage and supporting rationale     |

### How role overrides interact with the master toggle

1. The `ai_features` master flag must be **on** for any AI feature to function.
2. Each sub-feature flag has its own on/off toggle. When off, the feature is hidden from
   all users regardless of role overrides.
3. When a sub-feature flag is on, role overrides determine which roles can access it.
   If the **Admin** checkbox is unchecked, admins lose access to that sub-feature too.

> **Note:** By default all AI sub-features are enabled for both Admin and Rep. Changes
> take effect on the user's next page load (sub-feature access is checked at login).

### Tutorial: restrict an AI sub-feature to admins only

1. Go to **Admin Settings → Features**.
2. Locate the AI sub-feature flag (e.g. _Natural-language query page_).
3. In the **Role overrides** column, uncheck **Rep**.
4. The checkbox saves immediately — no confirmation dialog.

Reps will no longer see that feature on their next page load. Their existing data is not
affected.

---

## 12. Data Visibility Scoping

Controls which records each role can see when listing contacts, deals, and activities.
(MINCRM-534, MINCRM-538)

### How it works

Each object type (contacts, deals, activities) has an independently configurable **policy**:

| Policy    | Who can see a record                                                                  |
| --------- | ------------------------------------------------------------------------------------- |
| `org`     | All authenticated users (default)                                                     |
| `team`    | Only users who share at least one team with the record owner, or the owner themselves |
| `private` | Only the record's owner                                                               |

**Role overrides** — regardless of the active policy:

- **Admin** and **Viewer** always see all records org-wide (policy is ignored).
- **Manager** always sees team-scoped records for all teams they manage, including sub-teams. If the manager belongs to no team, they see only their own records.
- **Rep** follows the active policy for their own role.

### Reassignment restrictions for managers

When a manager changes the `owner` field on a contact or deal, the new owner must belong to one of the manager's teams. Attempting to assign ownership to a user outside the team returns a 403 error. Admins and reps are not subject to this restriction.

### Tutorial: restrict contacts to team visibility

1. Go to **Admin Settings → Visibility**.
2. In the **Contacts** row, change the policy from _Org_ to _Team_.
3. Click **Save**.

Reps will now only see contacts owned by members of their team. Contacts outside their team are filtered from list results. Existing records are not deleted — only their visibility in list views is affected.

### Tutorial: revert to org-wide visibility

1. Go to **Admin Settings → Visibility**.
2. Change the policy back to _Org_ for the relevant object type.
3. Click **Save**.

All users immediately regain access to all records of that type.

### Audit trail

Every visibility policy change is recorded in the **Audit Log** under record type
`org_visibility_settings`, including the previous value, the new value, and the admin who made the change.

---

## 13. Roles and Capabilities

MiniCRM uses capability-based access control (RBAC). Every user's permissions are determined
by the union of all capabilities granted across their assigned roles. Custom roles let you
define precise permission sets beyond the five built-in roles.

### Built-in roles

| Role            | Description                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| admin           | Full access to all capabilities                                               |
| manager         | Team-scoped record access; can edit deals, contacts, and activities they own  |
| rep             | Standard sales rep — create and edit their own records                        |
| viewer          | Read-only access across the organisation; cannot create or edit               |
| service_account | Machine-to-machine API access via bearer token; blocked from all UI endpoints |

Built-in roles cannot be renamed or deleted.

### Capability groups

Capabilities are grouped by domain. The full list is visible in **Admin → Settings → Roles**.

| Group         | Capabilities                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contacts      | `contacts:view`, `contacts:create`, `contacts:edit`, `contacts:delete`, `contacts:export`                                                                      |
| Deals         | `deals:view`, `deals:create`, `deals:edit`, `deals:delete`, `deals:reassign`                                                                                   |
| Activities    | `activities:view`, `activities:create`, `activities:edit`, `activities:delete`                                                                                 |
| Pipelines     | `pipelines:view`, `pipelines:manage`                                                                                                                           |
| Reports       | `reports:view`, `reports:create`, `reports:edit`, `reports:delete`, `reports:export`, `reports:schedule`                                                       |
| Data          | `data:import`, `data:export`                                                                                                                                   |
| Users & Admin | `users:view`, `users:create`, `users:edit`, `users:delete`, `teams:manage`, `integrations:manage`, `settings:manage`, `feature_flags:manage`, `audit_log:view` |
| API           | `api:access`                                                                                                                                                   |

Capabilities marked as **admin-only** (`contacts:delete`, `deals:delete`, `activities:delete`)
are not included in the built-in `rep` or `manager` roles and should only be granted to custom
roles used by trusted personnel.

### Tutorial: create a custom role and assign it to a user

#### Step 1 — Create the role

1. Go to **Admin → Settings → Roles** tab.
2. Click **New role**.
3. Enter a **Name** (max 100 characters) and an optional **Description**.
4. In the capability picker, check each capability the role should grant. Use the group-level
   checkbox to select or deselect an entire domain at once.
5. Click **Save**.

The new role appears in the list immediately.

#### Step 2 — Assign the role to a user

Custom role assignment is done via the API (UI-based assignment is coming in a future release):

```bash
curl -X POST https://<your-crm>/api/v1/users/<userId>/roles \
  -H "Content-Type: application/json" \
  -b "token=<admin-jwt>" \
  -d '{"roleId":"<roleId>"}'
```

A user's effective capabilities are the union of all capabilities from all their assigned roles.
If a user has no custom role assignments, their capabilities fall back to the built-in role
corresponding to their `role` field (`admin`, `rep`, etc.).

#### Step 3 — Remove a role assignment

```bash
curl -X DELETE https://<your-crm>/api/v1/users/<userId>/roles/<roleId> \
  -b "token=<admin-jwt>"
```

Removal is idempotent — deleting a role the user was not assigned is a no-op.

### Reference

| Endpoint                          | Method | Description                                     |
| --------------------------------- | ------ | ----------------------------------------------- |
| `/api/v1/custom-roles`            | GET    | List all roles (built-in and custom)            |
| `/api/v1/custom-roles`            | POST   | Create a new custom role                        |
| `/api/v1/custom-roles/:id`        | GET    | Get a single role                               |
| `/api/v1/custom-roles/:id`        | PUT    | Update name, description, or capabilities       |
| `/api/v1/custom-roles/:id`        | DELETE | Delete a custom role (fails if assignees exist) |
| `/api/v1/users/:id/roles`         | GET    | List roles assigned to a user                   |
| `/api/v1/users/:id/roles`         | POST   | Assign a role to a user (idempotent)            |
| `/api/v1/users/:id/roles/:roleId` | DELETE | Remove a role assignment (idempotent)           |

All endpoints require `settings:manage` capability. Deleting a role that has active assignees
returns `409 CUSTOM_ROLE_HAS_ASSIGNEES` — reassign or remove those users first.

### Audit trail

Every role create, update, and delete is recorded in the **Audit Log** under record type
`custom_role`. User role assignments and removals are recorded under record type `user`
with field names `custom_role_assigned` and `custom_role_removed`.
