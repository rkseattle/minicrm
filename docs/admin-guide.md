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
11. [AI Usage & Cost Dashboard](#11-ai-usage--cost-dashboard)
12. [AI Role-Based Feature Access](#12-ai-role-based-feature-access)
13. [Data Visibility Scoping](#13-data-visibility-scoping)
14. [Roles and Capabilities](#14-roles-and-capabilities)
15. [Email Templates](#15-email-templates)
16. [Two-Factor Authentication](#16-two-factor-authentication)
17. [Single Sign-On (SSO)](#17-single-sign-on-sso)
18. [SCIM Provisioning](#18-scim-provisioning)
19. [Teams](#19-teams)

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

### Default timezone

> **Feature dependency:** used to display
> [AI follow-up timing suggestions](user-guide/contacts.md#ai-smart-follow-up-timing-suggestions)
> in local terms. MiniCRM does not store a timezone per contact or per user — this is
> the single org-wide display timezone.

1. Go to **Admin → Settings → General** tab.
2. Choose a **Default timezone** from the dropdown (any valid IANA timezone, e.g.
   `America/Los_Angeles`, `Europe/London`).
3. Click **Save**.

Changing this setting only affects how times are _displayed_ going forward — it never
rewrites any stored timestamp, so historical records and the audit trail are unaffected.

---

### Reference: all system settings

| Setting                                       | Location          | Notes                                                         |
| --------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| Default language                              | General           | Language for all users who have not set a personal preference |
| Nav layout                                    | General           | _Sidebar_ or _Top bar_ navigation style                       |
| Default currency                              | General           | 3-letter currency code (USD, EUR, GBP, etc.)                  |
| Default timezone                              | General           | IANA timezone; see above                                      |
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

### Scheduled enablement

You can schedule a disabled flag to automatically enable at a specific date and time — no
manual action required at the scheduled moment.

When a flag has a scheduled enable time:

- A **Scheduled** badge replaces the **Off** badge next to the flag name.
- A note shows the planned enable date/time (displayed in your local timezone).
- The flag remains off for all users until the scheduled moment arrives.

**To set a schedule:**

1. Make sure the flag is disabled (toggle is off).
2. A date-and-time picker appears below the flag. Choose the future date and time when
   the flag should automatically enable.
3. The schedule is saved immediately — no confirmation step.

**To clear a schedule:**

1. Click **Clear schedule** next to the picker. The flag reverts to simply **Off** with no
   automatic enablement planned.

> **How it works:** The server caches flag state for 60 seconds. When a scheduled enable
> time exists, the cache is shortened to expire exactly when `enable_at` arrives, so the
> flag activates within one server-side cache cycle (at most a few seconds late).

### Flag groups

Flag groups let you cluster related feature flags under a single on/off gate. When a
group is disabled, all member flags are blocked for every user who is not in the
group's own beta list — regardless of each flag's individual enabled state. This makes
a group the fastest way to shut down an entire feature area in one action.

> **Evaluation order:** A per-user force override always wins — even over a disabled group
> gate. Next comes the per-team override, which applies only to AI Lead Routing Suggestion
> (see [Section 19 — Teams](#19-teams)). After that, the group gate fires, then flag-level
> beta enrollment and rollout bucketing, and finally the flag's own role settings and
> enabled state. For any AI sub-feature, a disabled `ai_features` master toggle denies
> before any of this is consulted.

#### Managing groups

Groups are managed in the **Groups** section at the top of the **Admin Settings → Features**
page. From there you can:

- **Create a group** — give it a unique key, a label, and an optional description.
- **Toggle a group** — click the group's toggle to enable or disable the gate for all
  member flags at once.
- **Schedule a group enable** — set an `Enable at` date/time; the group gate lifts
  automatically at that moment (same mechanism as flag-level scheduling).
- **Delete a group** — only allowed when no flags are assigned to it. Deleting a group
  does not delete the flags themselves; they become ungrouped.

#### Group beta list

Each group has its own beta list, separate from per-flag beta lists. A user in the
group's beta list bypasses the group gate even while the group is disabled — useful for
testing a feature area with a small set of users before a broader rollout.

To manage group beta users, use the API endpoints under
`/api/v1/admin/feature-flags/groups/:groupKey/beta-users`.

#### Assigning flags to a group

Assign a flag to a group by setting `group_key` on the flag via the API
(`PATCH /api/v1/admin/feature-flags/:key`). A flag can belong to at most one group.
Removing a flag from a group sets `group_key` to `null`; the flag then evaluates
independently.

### Beta users

Each flag has a **Beta Users** panel that lets you grant individual users access to a
_disabled_ feature. Beta enrollment bypasses the org-wide disabled state — the enrolled
user sees the feature as enabled even while it is off for everyone else.

**To enroll a user in beta:**

1. Open the **Beta Users** panel under a flag (always visible, below the flag row).
2. Type the user's name in the search box.
3. Select them from the dropdown. They are enrolled immediately.

**To remove a user from beta:**

1. Find the user in the enrolled list under the flag.
2. Click **Remove** next to their name.

> **Note:** Beta enrollment does not affect users when the flag is globally enabled —
> enrollment is only meaningful for disabled flags.

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

Once enabled, the **AI Assistant** tab becomes visible in the navigation for all users.
Users can start conversations, ask questions about CRM data, and manage their own sessions.
See the [AI Assistant user guide](user-guide/ai-assistant.md) for end-user instructions.

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
- **AI meeting brief news hook:** `ai_configuration.web_search_enabled` (default off)
  gates the optional "recent news about this company" section of the AI pre-meeting
  brief (see [Activities — AI pre-meeting brief](user-guide/activities.md#ai-pre-meeting-brief)).
  Not yet exposed as a toggle in the AI settings UI — enable it directly in the database
  if you want this section available, following the same not-yet-UI-exposed precedent as
  `champion_blocker_deal_value_threshold` and `churn_expansion_confidence_threshold`.

### AI PII data minimization

MiniCRM applies a server-side data minimization pass to every tool call result before it
is transmitted to the AI provider. This means sensitive fields are never included in the
data sent to the external API, regardless of what is stored in the CRM database.

The **Data Minimization** section under **Admin Settings → AI** shows the full effective
exclusion list — always-excluded defaults, admin-configurable standard fields, and
currently-excluded custom fields — in one place.

#### Fields always excluded (hardcoded, cannot be changed)

The following field types are stripped from AI payloads regardless of admin configuration.
They are shown as locked entries in the Data Minimization section and cannot be re-enabled:

| Category                   | Fields stripped                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal system secrets    | `password_hash`, `password_reset_token`, `api_key_encrypted`, `mfa_secret`, `otp_backup_codes`, `secret_hash`, `service_account_token`, `refresh_token`, `access_token`           |
| Financial / government IDs | `ssn`, `social_security_number`, `tax_id`, `tax_identification_number`, `ein`, `vat_number`, `bank_account`, `bank_account_number`, `routing_number`, `credit_card_number`, `cvv` |

These fields are never transmitted to the AI provider even if they appear in search results
or entity payloads.

#### Admin-configurable standard fields

Beyond the always-excluded defaults, admins can exclude additional standard (non-custom)
fields per entity type — for example, `department` on contacts or `loss_reason` on deals.

To exclude a standard field:

1. Go to **Admin Settings → AI → Data Minimization**.
2. Find the field in the **Standard fields** table.
3. Check the **Excluded** box for that field.

The change takes effect on the user's next AI message — no restart is required. Each
change is written to the audit log under the `ai_field_exclusion` record type.

#### PII-excluded custom fields

When a custom field definition is marked **PII-excluded** in **Admin → Settings → Customisation
→ Custom Fields** (the `pii_excluded` toggle on the field's edit form), the _value_ of that
field is stripped from AI payloads. The field name and metadata remain so the AI knows the
field exists but cannot read its content.

To mark a custom field as PII-excluded:

1. Go to **Admin → Settings → Customisation → Custom Fields**.
2. Click **Edit** on the field you want to protect.
3. Enable the **AI Excluded** checkbox.
4. Save.

The current state of every custom field's PII exclusion is also shown read-only in
**Admin Settings → AI → Data Minimization**, with a link back to Custom Fields to make changes.

The change takes effect on the user's next AI message — no restart is required.

#### Audit logging

Every AI API call that strips at least one field emits a structured server log entry
containing the session ID, the tool name, and the list of stripped field names (never
their values). These entries appear in the server log under the tag
`NLI PII minimization` and can be used for compliance auditing. Admin-configurable
exclusion toggles (standard fields and custom field PII flags) are additionally recorded
as structured audit log entries.

---

### AI session retention

AI conversation sessions and messages are automatically purged after a configurable
retention window. This is separate from the AI configuration described above and lives in
the **Session Retention** section under **Admin Settings → AI**.

#### Configuring the retention window

1. Go to **Admin Settings → AI → Session Retention**.
2. Enter the desired **Retention window (days)** — minimum 30, default 90.
3. Click **Save**.

The current count of sessions and messages currently stored is shown alongside the input,
so you can gauge the impact of a change before it takes effect.

Changes take effect on the **next nightly purge** (02:00 server time), not immediately:

- If you **shorten** the window (e.g. 90 → 60 days), the next nightly purge immediately
  deletes any sessions older than the new window.
- If you **extend** the window, there is no immediate effect — sessions simply persist
  longer going forward.

#### Triggering an immediate purge

Click **Purge now** to run the purge outside the nightly schedule. This uses the exact
same purge logic as the nightly job and immediately deletes any sessions older than the
currently configured retention window. A confirmation dialog appears first, since this
action cannot be undone.

#### Audit logging

Both the retention window value and any manual purge trigger are recorded in the audit
log under the `ai_settings` record type. The purge job itself also records a summary
entry (`ai_sessions` record type) noting how many sessions were deleted and the window
that was applied.

#### What is not covered by this policy

Per-user AI context (personalization preferences shown under **My Context** on the AI
Assistant page) is explicitly excluded from this retention policy — it is persistent
configuration, not conversation history, and is only removed via GDPR erasure or when the
user deletes an entry directly.

Users can see their current retention window on the AI Assistant page itself
("Your conversation history is retained for X days").

---

### AI deal-intelligence thresholds

Several of the AI deal-intelligence features introduced alongside win/loss insights,
champion/blocker detection, and churn/expansion detection read admin-tunable threshold
values from the AI configuration:

| Threshold                             | Default | Feature                       | What it controls                                                                                                            |
| ------------------------------------- | ------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Win/loss minimum closed deals         | 20      | AI Win/Loss Pattern Analysis  | Total closed (Won + Lost) deals required org-wide before any win/loss patterns are surfaced at all.                         |
| Win/loss minimum sample size          | 5       | AI Win/Loss Pattern Analysis  | Minimum number of supporting deals a specific behavioral pattern must have before it is shown.                              |
| Champion/blocker deal-value threshold | $10,000 | AI Champion/Blocker Detection | Deal value above which the single-threaded-risk warning appears when only one contact is linked.                            |
| Churn/expansion confidence threshold  | 0.70    | AI Churn/Expansion Detection  | Minimum AI-reported confidence (0–1) for a churn-risk or expansion signal to be surfaced; signals below this are discarded. |

> **Current limitation:** these four values are set by database migration default and
> are not yet exposed in the **Admin Settings → AI** UI — there is no screen to change
> them today. Changing them currently requires a direct database update. Contact
> engineering if your organisation needs different values.

### AI deal-intelligence nightly jobs

Two of the AI deal-intelligence features run as nightly background jobs rather than
on demand:

| Job                          | Schedule                 | What it does                                                                                                                                                                                   |
| ---------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI Win/Loss Pattern Analysis | Daily, 03:00 server time | Recomputes win/loss behavioral patterns from all closed deals and refreshes `/insights/win-loss`. No-ops if AI is disabled or the org has fewer closed deals than the minimum threshold above. |
| AI Churn/Expansion Detection | Daily, 04:00 server time | Rescans closed-won accounts with activity history for churn-risk or expansion signals and refreshes `/insights/churn-expansion`. No-ops if AI is disabled.                                     |

Both jobs run automatically — there is no manual "run now" trigger for either, unlike
the AI session retention purge above. A failed run leaves the previous night's results
in place until the next successful run.

---

### AI relationship health scoring configuration

The weights and thresholds behind
[relationship health scoring](user-guide/accounts.md#ai-relationship-health-scoring) are
admin-tunable via `GET`/`PATCH /api/v1/settings/relationship-health-config`
(admin role required):

| Setting                                         | Default           | What it controls                                                                  |
| ----------------------------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| Frequency weight                                | 0.25              | Contribution of recent communication frequency to the composite score.            |
| Recency weight                                  | 0.25              | Contribution of how recently the account was last contacted.                      |
| Seniority weight                                | 0.15              | Contribution of the seniority of engaged contacts.                                |
| Sentiment weight                                | 0.20              | Contribution of the account's sentiment trend.                                    |
| Breadth weight                                  | 0.15              | Contribution of how many distinct contacts are engaged.                           |
| Strong / Healthy / Cooling / At Risk thresholds | 80 / 60 / 40 / 20 | Score cutoffs (0–100) separating each state; scores below the lowest are Dormant. |
| Minimum logged activities                       | 3                 | Below this, no score is shown for the account (insufficient data).                |
| Recency window (days)                           | 90                | Lookback window for frequency/recency scoring.                                    |
| Single-threaded risk window (days)              | 90                | Lookback window used to flag single-threaded risk.                                |

> **Current limitation:** these values are exposed via the API but not yet surfaced in
> the **Admin Settings → AI** UI — there is no dedicated screen to change them today.
> The five weight fields must sum to 1.0 and the four thresholds must be strictly
> descending (Strong > Healthy > Cooling > At Risk); the API rejects any update that
> violates either constraint.

### AI relationship health / follow-up timing nightly jobs

| Job                             | Schedule                 | What it does                                                                                     |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| AI Relationship Health Scoring  | Daily, 05:00 server time | Recomputes the health score for every account with at least the minimum logged activities above. |
| AI Follow-Up Timing Suggestions | Daily, 05:30 server time | Recomputes the best-time-to-contact suggestion for every contact with 5+ logged interactions.    |

Both jobs run automatically with no manual trigger. The follow-up timing suggestion
also recomputes lazily on read if new interaction data has accumulated since the last
nightly run, so a contact's suggestion stays current without waiting for the next
scheduled run.

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

## 11. AI Usage & Cost Dashboard

> **Route:** `/admin/ai/usage` (standalone page, not part of Admin Settings)

The AI Usage & Cost Dashboard gives admins visibility into token consumption and
estimated spend across the organization, broken down by user and by feature.

### Tutorial: reviewing usage and exporting data

1. Go to **Admin Settings → AI → Token Budgets** and click **View usage & cost
   dashboard**, or navigate directly to `/admin/ai/usage`.
2. Select a date range: **Current month**, **Last month**, **Last 3 months**, or
   **Custom range** (pick explicit start/end dates).
3. Review the summary cards: total tokens, estimated cost, and trend vs. the prior
   equivalent-length period.
4. Scroll down for the **Usage by User** and **Usage by Feature** tables, and the daily
   token consumption chart.
5. Click **Export CSV** or **Export PDF** to download the full per-user, per-day,
   per-feature breakdown.

### Configuring the cost estimate rate

Estimated cost is calculated from token counts × a configurable rate, set in
**Admin Settings → AI → Cost Estimation Rates**:

1. Enter the **Input cost (cents per 1M tokens)** and **Output cost (cents per 1M
   tokens)** for your provider agreement.
2. Click **Save**.

Changes take effect immediately on the next dashboard load — historical cost figures on
the dashboard are recalculated using the current rate, not the rate that was in effect
when the tokens were originally consumed.

### Known limitations / follow-up

- **Cost estimates are self-reported, not reconciled against provider billing.** Token
  counts come from the same values Claude's API returns on each response — they are not
  cross-checked against Anthropic's usage/billing dashboard or API. If you need
  billing-grade accuracy, use your provider's own billing console as the source of truth;
  treat this dashboard as a directional estimate. A follow-up ticket has been noted to
  investigate real provider-side usage reconciliation if/when Anthropic exposes a
  suitable API for it.
- **Aggregation is computed on-demand, not cached nightly.** At current data volumes this
  is fast enough that a separate nightly caching job was not implemented; revisit if
  usage data volume grows significantly.

---

## 12. AI Role-Based Feature Access

> **Feature flags:** `ai_nli_page`, `ai_activity_summarizer`, `ai_email_draft`,
> `ai_task_suggestions`, `ai_contact_enrichment`, `ai_duplicate_explanation`,
> `ai_lead_scoring`, `ai_lead_score_narrative`, `ai_deal_health_check`,
> `ai_stage_advancement`, `ai_win_loss_insights`, `ai_champion_blocker_detection`,
> `ai_churn_expansion_detection`, `ai_objection_pattern_matching`,
> `ai_proposal_draft_generation`, `ai_meeting_brief`, `ai_warm_intro_path`,
> `ai_sentiment_tracking`, `ai_relationship_health_score`,
> `ai_followup_timing_suggestions`

Individual AI sub-features can be enabled or disabled per role. This lets you roll out
specific AI capabilities to admins first, or restrict certain features to admins only,
without disabling AI entirely.

### Available AI sub-features

| Flag key                         | Feature                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ai_nli_page`                    | Natural-language query page (ask questions in plain text)                                         |
| `ai_activity_summarizer`         | Summarize recent activities on a contact, deal, or account                                        |
| `ai_email_draft`                 | Draft outbound emails from a prompt                                                               |
| `ai_task_suggestions`            | Suggest follow-up tasks after an activity                                                         |
| `ai_contact_enrichment`          | Enrich contact profiles with public data                                                          |
| `ai_duplicate_explanation`       | Explain why two records were flagged as duplicates                                                |
| `ai_lead_scoring`                | Rule-based quality score badge on the lead detail page                                            |
| `ai_lead_score_narrative`        | Narrative explanation of a lead's score                                                           |
| `ai_deal_health_check`           | Health assessment and risk flags for a deal                                                       |
| `ai_stage_advancement`           | Suggested next pipeline stage and supporting rationale                                            |
| `ai_win_loss_insights`           | Nightly AI-narrated win/loss behavioral pattern analysis (`/insights/win-loss`)                   |
| `ai_champion_blocker_detection`  | Champion/blocker classification for deal contacts and the stakeholder map                         |
| `ai_churn_expansion_detection`   | Nightly churn-risk and expansion-opportunity detection for accounts (`/insights/churn-expansion`) |
| `ai_objection_pattern_matching`  | On-demand objection categorization and precedent matching from won deals                          |
| `ai_proposal_draft_generation`   | AI-drafted, editable proposal documents from a deal's context                                     |
| `ai_meeting_brief`               | On-demand pre-meeting brief for upcoming Call/Meeting activities                                  |
| `ai_warm_intro_path`             | Warm introduction path lookup through a rep's own contact network                                 |
| `ai_sentiment_tracking`          | Per-activity sentiment scoring and Contact/Account trend badges                                   |
| `ai_relationship_health_score`   | Nightly account relationship health scoring, badge, and trend sparkline                           |
| `ai_followup_timing_suggestions` | Best-time-to-contact suggestions on the Contact detail page and pre-meeting brief                 |

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

### AI Natural-Language Interface (NLI) — RBAC-filtered tool set

The NLI tool set presented to Claude is filtered server-side based on the authenticated
user's effective capabilities. Claude never receives tool definitions for operations the
user is not authorized to perform.

#### How tool filtering works

Tool availability in the NLI mirrors the user's role and capability set:

| Capability                | Tools available                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `contacts:view`           | Search and get contacts, accounts, leads                                                    |
| `contacts:create`         | Create contacts, accounts, leads; convert leads                                             |
| `contacts:edit`           | Update contacts, accounts, leads; manage notes and tags                                     |
| `contacts:delete`         | Delete contacts, accounts, leads                                                            |
| `deals:view`              | Search and get deals                                                                        |
| `deals:create`            | Create deals                                                                                |
| `deals:edit`              | Update deals                                                                                |
| `deals:delete`            | Delete deals                                                                                |
| `activities:view`         | Search and get activities                                                                   |
| `activities:create`       | Create activities                                                                           |
| `activities:edit`         | Update activities                                                                           |
| `activities:delete`       | Delete activities                                                                           |
| `reports:view`            | Run built-in reports                                                                        |
| `data:export`             | Export records as CSV                                                                       |
| `settings:manage` (admin) | Read pipeline config, custom field definitions, automation rules, webhooks, email templates |

Viewers receive only read-only tools (search/get) and cannot create, update, or delete
records via the NLI, matching their standard CRM access.

#### Audit logging

When a user attempts an operation they are not authorized to perform (e.g. a rep calling
an admin-only tool), the server emits a structured `warn` log entry with the tool name,
user ID, and role under the tag `NLI permission denied`. These entries are available in
the server log for security review.

### AI mutation audit trail

Every record created, updated, or deleted through the NLI is written to the **Audit Log**
with the same fidelity as a manual change. The audit entry carries a `source` field that
identifies the origin of the change:

| Source value   | Meaning                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| _(blank)_      | Change made by a human user via the CRM UI or REST API                               |
| `AI (NLI)`     | Change initiated by the AI Natural-Language Interface                                |
| `AI (context)` | Change to a user's personal AI context preferences (My Context panel on the AI page) |

#### Filtering audit log entries by source

Go to **Admin Settings → Data → Audit Log** and use the **Source** dropdown to filter:

| Filter option | Shows                                         |
| ------------- | --------------------------------------------- |
| All sources   | Every entry regardless of origin (default)    |
| Human         | Only entries created by humans (blank source) |
| AI (NLI)      | Only entries created through the NLI          |

Entries created via the AI Assistant are highlighted with a purple **AI (NLI)** badge
next to the user name in the audit log table, so you can identify them at a glance even
when viewing unfiltered results.

#### What is recorded

The audit log captures the full change set for every NLI-initiated write — which fields
changed, the old and new values, the acting user's identity, and the timestamp. This
applies to all entity types the NLI can modify: contacts, accounts, leads, deals,
activities, and notes.

---

## 13. Data Visibility Scoping

Controls which records each role can see when listing contacts, deals, and activities.

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

When a manager changes the `owner` field on a contact or deal, the new owner must belong to one of the teams the manager manages, including sub-teams. Attempting to assign ownership to a user outside that subtree returns a 403 error. Admins and reps are not subject to this restriction.

### Tutorial: restrict contacts to team visibility

1. Go to **Admin Settings → Users & Access**, and find **Visibility**.
2. In the **Contacts** row, change the policy from _Org_ to _Team_.
3. Click **Save**.

Reps will now only see contacts owned by members of their team. Contacts outside their team are filtered from list results. Existing records are not deleted — only their visibility in list views is affected.

### Tutorial: revert to org-wide visibility

1. Go to **Admin Settings → Users & Access**, and find **Visibility**.
2. Change the policy back to _Org_ for the relevant object type.
3. Click **Save**.

All users immediately regain access to all records of that type.

### Audit trail

Every visibility policy change is recorded in the **Audit Log** under record type
`org_visibility_settings`, including the previous value, the new value, and the admin who made the change.

---

## 14. Roles and Capabilities

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

---

## 15. Email Templates

Email templates are reusable message blueprints that can be referenced by the AI Assistant
when drafting outbound emails. They are managed by admins and read by all users (via the AI).

### What templates contain

| Field     | Description                                                                       |
| --------- | --------------------------------------------------------------------------------- |
| Name      | Unique, human-readable identifier (e.g. "Cold outreach — SaaS")                   |
| Category  | Free-text grouping label (e.g. `sales`, `support`, `onboarding`)                  |
| Subject   | Default email subject line (may include merge tags like `{{contact.first_name}}`) |
| Body HTML | HTML body of the email                                                            |
| Enabled   | When disabled, the template is hidden from AI-assisted email drafting             |

### Managing templates via the API

Templates are managed via the REST API (admin only). A future release will add a UI.

```bash
# List templates

curl https://<your-crm>/api/v1/email-templates \
  -b "token=<admin-jwt>"

# Create a template

curl -X POST https://<your-crm>/api/v1/email-templates \
  -H "Content-Type: application/json" \
  -b "token=<admin-jwt>" \
  -d '{
    "name": "Cold outreach — SaaS",
    "category": "sales",
    "subject": "Quick question, {{contact.first_name}}",
    "body_html": "<p>Hi {{contact.first_name}},</p>...",
    "enabled": true
  }'

# Update a template

curl -X PATCH https://<your-crm>/api/v1/email-templates/<id> \
  -H "Content-Type: application/json" \
  -b "token=<admin-jwt>" \
  -d '{"enabled": false}'

# Delete a template

curl -X DELETE https://<your-crm>/api/v1/email-templates/<id> \
  -b "token=<admin-jwt>"
```

### Reference

| Endpoint                      | Method | Description                         |
| ----------------------------- | ------ | ----------------------------------- |
| `/api/v1/email-templates`     | GET    | List templates (filter by category) |
| `/api/v1/email-templates`     | POST   | Create a template (admin only)      |
| `/api/v1/email-templates/:id` | GET    | Get a single template               |
| `/api/v1/email-templates/:id` | PATCH  | Update fields (admin only)          |
| `/api/v1/email-templates/:id` | DELETE | Delete a template (admin only)      |

`GET` endpoints are accessible to all authenticated users so the AI Assistant can browse
templates when drafting emails. Write endpoints require the `admin` role.

### Audit trail

Every create, update, and delete is recorded in the **Audit Log** under record type
`email_templates`.

---

## 16. Two-Factor Authentication

MiniCRM supports TOTP two-factor authentication (2FA) using any standard authenticator app
— Google Authenticator, Authy, 1Password, and similar. Each user enrolls their own device;
administrators control only whether enrollment is mandatory org-wide.

### Tutorial: require two-factor authentication for everyone

#### Step 1 — Open the setting

1. Go to **Admin Settings → Security & Identity**.
2. Find the **Two-Factor Authentication** panel at the top.

#### Step 2 — Turn on enforcement

1. Check **Require two-factor authentication**.
2. The setting saves immediately and a confirmation appears.

### What enforcement actually does

A user who has not yet enrolled is redirected to their **Profile** page immediately after
sign-in, where a banner reads "Your organisation requires two-factor authentication. Please
set it up to continue." They enroll from the **Two-Factor Authentication** panel on that
same page.

Two limits are worth knowing before you turn this on:

- **It prompts; it does not block.** The session cookie is issued as normal, so a user who
  ignores the banner keeps full access to the application.
- **The prompt appears once per sign-in.** It is carried in the redirect URL, not in the
  user's account state, so it disappears as soon as they navigate elsewhere and does not
  return until their next login.

The redirect also discards wherever the user was originally heading. Treat this setting as
"prompt everyone to enroll at login", not as a hard gate — if you need enrollment
guaranteed, follow up out of band.

### The enrollment flow (what your users see)

Enrollment is self-service, from **Profile → Two-Factor Authentication**:

1. The user clicks **Set up two-factor authentication**.
2. MiniCRM displays a QR code. The user scans it with their authenticator app. The entry
   appears there labelled with the user's email address, under the issuer name `MiniCRM`
   (set by the `APP_NAME` environment variable, and separate from the workspace name under
   **Branding**).
3. The user enters the current 6-digit code to confirm the app is correctly paired.
4. MiniCRM shows **eight single-use recovery codes**, once and only once.

### Recovery codes

| Property     | Value                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Count        | 8, generated at enrollment                                                                                                 |
| Format       | 16 hexadecimal characters                                                                                                  |
| Reuse        | Single-use — each code is consumed when redeemed                                                                           |
| Storage      | Hashed; MiniCRM cannot display them again after enrollment                                                                 |
| Regeneration | Not available — a fresh set requires disabling and re-enrolling, which invalidates the user's existing authenticator entry |

At sign-in a user who cannot reach their authenticator app chooses **Use a recovery code
instead** and enters one of the eight. The user's own **Two-Factor Authentication** panel
shows how many remain, which is the easiest way to spot someone at risk of locking
themselves out.

> **Advise users to store recovery codes before dismissing the dialog.** They are shown
> exactly once and are stored hashed, so neither the user nor an administrator can recover
> them afterwards.

### Turning 2FA off

A user disables their own 2FA from **Profile → Two-Factor Authentication** by entering their
**current account password**. This clears their secret and all remaining recovery codes.

> **There is no administrator reset.** MiniCRM has no admin-side control that clears another
> user's 2FA enrollment — disabling requires the account holder's own password. A user who
> loses both their authenticator device and all eight recovery codes cannot be recovered
> through the application at all. Restoring such an account means clearing
> `mfa_enabled`, `mfa_secret`, `mfa_pending_secret`, and `mfa_recovery_codes` on their
> `users` row directly in the database — which, unlike the two events below, writes no audit
> entry. Plan for this before enabling org-wide enforcement, and make sure users store their
> recovery codes.

### Reference

| Endpoint                          | Method | Description                                    |
| --------------------------------- | ------ | ---------------------------------------------- |
| `/api/v1/settings/mfa-required`   | GET    | Read org-wide enforcement (admin only)         |
| `/api/v1/settings/mfa-required`   | PATCH  | Set org-wide enforcement (admin only)          |
| `/api/v1/auth/mfa/status`         | GET    | Whether the caller has 2FA enabled             |
| `/api/v1/auth/mfa/setup`          | POST   | Begin enrollment; returns the QR code          |
| `/api/v1/auth/mfa/verify-setup`   | POST   | Confirm the code; returns the recovery codes   |
| `/api/v1/auth/mfa/disable`        | POST   | Disable own 2FA; requires the account password |
| `/api/v1/auth/mfa/verify-login`   | POST   | Complete sign-in with an authenticator code    |
| `/api/v1/auth/mfa/recovery-login` | POST   | Complete sign-in with a recovery code          |

The two sign-in endpoints take no session cookie: they complete a login already in
progress, using a token issued when the password was accepted, valid for five minutes.

> **These two endpoints are not rate-limited**, unlike `/auth/login` and the password-reset
> endpoints. Within that five-minute window a 6-digit code or a recovery code can be
> submitted repeatedly. If your deployment is internet-facing, rate-limit them at the
> reverse proxy.

### Audit trail

Enrollment and removal are recorded in the **Audit Log** against record type `user`, with
event types `mfa_enabled` and `mfa_disabled`. Because 2FA is always self-service, the actor
and the subject are the same person.

> Neither event type appears in the Audit Log page's event-type filter, so filter by record
> type `user` and read the results, rather than looking for them in that dropdown.

---

## 17. Single Sign-On (SSO)

MiniCRM can delegate authentication to your identity provider using either **SAML 2.0** or
**OpenID Connect (OIDC)**. One protocol is active at a time. Users who sign in through the
IdP are provisioned automatically on first login.

### Tutorial: connect an identity provider

#### Step 1 — Open the SSO panel

1. Go to **Admin Settings → Security & Identity**.
2. Find the **Single Sign-On (SSO)** panel.

#### Step 2 — Give your IdP MiniCRM's details

Your identity provider needs these before it will accept requests:

| Value              | Where it comes from                                |
| ------------------ | -------------------------------------------------- |
| Redirect / ACS URL | `<SSO_CALLBACK_BASE_URL>/api/v1/auth/sso/callback` |
| SP metadata (SAML) | `<SSO_CALLBACK_BASE_URL>/api/v1/auth/sso/metadata` |

`SSO_CALLBACK_BASE_URL` is an environment variable and **must point at the API server, not
the front end**. If it is unset, MiniCRM falls back to `APP_BASE_URL` and then to
`http://localhost:3001`. Getting this wrong is the most common cause of a failed callback.

The SAML metadata document is public and unauthenticated, so your IdP can fetch it
directly. **Save your configuration before pointing the IdP at it** — until **SP Entity ID**
is set, the document advertises a placeholder entity ID built from the callback base URL,
which is not a real endpoint.

#### Step 3 — Enter your IdP's details

| Field                              | Applies to | Notes                                                     |
| ---------------------------------- | ---------- | --------------------------------------------------------- |
| **Protocol**                       | Both       | SAML 2.0 or OpenID Connect (OIDC)                         |
| **IdP Metadata URL**               | Both       | OIDC: the discovery document. SAML: the IdP metadata URL. |
| **SP Entity ID** / **Client ID**   | Both       | Labelled _SP Entity ID_ for SAML, _Client ID_ for OIDC    |
| **IdP Certificate (PEM)**          | SAML only  | The X.509 certificate from your IdP; stored encrypted     |
| **Default Role for New SSO Users** | Both       | Extra role granted to users provisioned on first sign-in  |

Click **Save SSO Configuration**. The login page then offers SSO to your users.

> The IdP certificate is never returned by the API once saved — the panel shows only
> "Certificate saved — enter a new value to replace it." To change it, paste a new one.

### How users are provisioned

On each SSO sign-in MiniCRM resolves the user in this order:

1. **Known SSO identity** — matched on provider and subject; the user signs in.
2. **Existing account with the same email that is not already bound to an IdP subject** —
   the SSO identity is linked to it and the password-change requirement is cleared. An
   account already bound to a _different_ subject is skipped, and the sign-in is refused
   with `sso_error=SSO_CALLBACK_FAILED`; the original binding is left untouched. A user
   whose email is already bound to one identity provider cannot sign in through a second
   one.
3. **Nobody matches** — a new active user is created.

In steps 1 and 2, a deactivated account is refused: the user is returned to the login page
with an error rather than being reactivated.

#### What role a provisioned user gets

Every JIT-provisioned user is created with the base role **rep**. This is fixed and not
configurable.

**Default Role for New SSO Users** grants an _additional_ custom role on top of that. Leaving
it blank is valid and means no extra role — the user is a plain rep. New installations seed
it to the built-in `rep` role.

> If the configured role has since been deleted, the user is still created and can still
> sign in — with the base `rep` role only, and none of the capabilities you intended. The
> misconfiguration is recorded in the audit log under record type **`system_settings`**, not
> `user`, so it will not appear if you filter the log by the affected account.

#### The administrator escape hatch

> **Administrators can always sign in with a password**, even when SSO is enabled and their
> account is SSO-linked — a deliberate escape hatch against a misconfigured IdP. It keys off
> the built-in `admin` role specifically, so a user who holds administrative capabilities
> only through a custom role does not get it. Keep at least one built-in admin account with
> a working password.

### Turning SSO off

**Disable SSO** clears the configuration and unlinks every SSO-bound user. Those accounts
are _not_ deactivated — they remain active.

> **Users who only ever signed in through SSO have no password and will be locked out.**
> JIT-provisioned accounts are created without a password hash, and MiniCRM refuses a
> password login for any account that has none. Before disabling SSO, set a password for
> each such user (**Admin → Users → Set password**), or they cannot get back in.

### Encryption key rotation

> **SSO must be reconfigured after any `NODE_ENCRYPTION_KEY` rotation.** The IdP
> certificate and MiniCRM's own SAML signing key are protected by the legacy unversioned
> encryption path, which has no key-version column and no re-encryption tooling. After
> rotating the key, existing values cannot be decrypted — re-enter the IdP certificate to
> restore SSO. See [migrations](dev/migrations.md#encryption-key-rotation).

### Testing SSO locally

The repository ships a [Dex](https://dexidp.io/) identity provider behind a Compose profile
for development use. See [Local SSO testing](dev/local-sso.md) for the full procedure — it
is development-only, with in-memory storage and a shared hardcoded password.

### Reference

| Endpoint                      | Method | Description                                    |
| ----------------------------- | ------ | ---------------------------------------------- |
| `/api/v1/settings/sso`        | GET    | Read the configuration (certificate masked)    |
| `/api/v1/settings/sso`        | PUT    | Save the configuration                         |
| `/api/v1/settings/sso`        | DELETE | Disable SSO and unlink all users               |
| `/api/v1/settings/sso/status` | GET    | Whether SSO is enabled — public, used by login |
| `/api/v1/auth/sso/login`      | GET    | Start sign-in; redirects to the IdP            |
| `/api/v1/auth/sso/callback`   | GET    | OIDC callback                                  |
| `/api/v1/auth/sso/callback`   | POST   | SAML callback (POST binding)                   |
| `/api/v1/auth/sso/metadata`   | GET    | SAML SP metadata — public, fetched by the IdP  |

The three configuration endpoints require the `settings:manage` capability. The login,
callback, status, and metadata endpoints are unauthenticated by necessity: they run before
a session exists, or are fetched by the IdP itself.

### Audit trail

SSO activity is recorded in the **Audit Log** under record type `user`, with event types
`sso_login`, `sso_provisioned`, `sso_linked`, and `sso_unlinked`.

> None of those four appear in the Audit Log page's event-type filter, so filter by record
> type `user` and read the results.

---

## 18. SCIM Provisioning

MiniCRM implements **SCIM 2.0** so your identity provider can create, update, and
deactivate users, and keep team membership in sync, without anyone doing it by hand. SCIM
complements SSO: SSO authenticates people, SCIM manages their accounts and group
membership.

### Tutorial: connect your IdP to SCIM

#### Step 1 — Issue a bearer token

1. Go to **Admin Settings → Security & Identity**.
2. In **SCIM 2.0 Provisioning → Bearer Token**, click **Generate Token** (labelled
   **Regenerate Token** once one exists).
3. Copy the token immediately — MiniCRM shows it once and stores only a hash of it.

> **Only one token is active at a time.** Generating a new one revokes the previous token
> in the same operation, so an IdP still using the old value stops provisioning
> immediately. Plan the switch-over.

The panel shows when the active token was issued and when it was last used, which is the
quickest way to confirm your IdP is actually calling MiniCRM.

#### Step 2 — Point your IdP at the SCIM endpoint

| Setting    | Value                     |
| ---------- | ------------------------- |
| Base URL   | `<your-api-host>/scim/v2` |
| Token type | Bearer                    |
| Token      | The value from Step 1     |

Note the SCIM base URL is `/scim/v2` — it is **not** under `/api/v1` like the rest of the
API.

#### Step 3 — Map IdP groups to roles

Members of a mapped IdP group are granted the mapped role automatically; members removed
have it revoked.

> **Mappings are created through the API, not the admin UI.** The **Group-to-Role Mappings**
> panel lists existing mappings and deletes them, but has no form for adding one. Create a
> mapping with:
>
> ```bash
> curl -X PUT "https://<your-host>/api/v1/scim/group-role-mappings/<idp-group-id>" \
>   -H "Content-Type: application/json" \
>   -b "minicrm_token=<admin-jwt>" \
>   -d '{"roleId":"<custom-role-uuid>","groupName":"Sales EMEA"}'
> ```

**Only custom roles can be mapped** — the built-in roles (`admin`, `manager`, `rep`,
`viewer`, `service_account`) are not valid targets, and a mapping that names one is
rejected. Create a custom role under **Admin Settings → Users & Access → Roles** first.

### How group mapping behaves

Each SCIM group corresponds to one MiniCRM team — a real team, not a shadow object. When
your IdP updates a group's membership, MiniCRM adds or removes the matching team
memberships and applies the mapped role alongside them.

> Because these are ordinary teams, a group sync can widen who sees which records wherever
> a `team` visibility policy is in force. See
> [Section 13 — Data Visibility Scoping](#13-data-visibility-scoping).
>
> **A role is only revoked when no other mapped group still grants it.** If a user belongs
> to two IdP groups that both map to the same role, removing them from one leaves the role
> in place. This prevents an unrelated group change from silently stripping access.

A mapped role is granted _in addition to_ the user's base role, which group mapping never
changes.

### What role a SCIM-provisioned user gets

Every user created through SCIM is given the base role **rep**. This is fixed and not
configurable — mapped group roles are granted on top of it.

### What SCIM can and cannot see

Only users provisioned **through SCIM** are visible to the SCIM API. Accounts created
manually in the admin UI, or automatically by SSO on first login, are deliberately hidden
from `/scim/v2/Users` so that a bearer token cannot enumerate your whole user directory.

> **Existing accounts cannot be adopted into SCIM management.** If you turn on SCIM after
> users already exist, your IdP cannot see them — and it cannot re-create them either:
> provisioning any email that already belongs to an account is rejected with a `409`
> conflict, which your IdP reports as a sync error. Those accounts stay managed by hand.
> Plan SCIM adoption before onboarding users, or expect a permanent split between
> SCIM-managed and manually-managed accounts.

### Administrators cannot be deactivated through SCIM

Deactivating a user who holds the built-in `admin` role has no effect: MiniCRM keeps the
account active so an administrator always retains a local way in.

> **Your IdP is told the deactivation succeeded.** The request returns `200` with the user
> still marked active, so the IdP will show the user as deprovisioned when they are not.
> Deactivate administrators in **Admin → Users**, and check there after any admin
> offboarding.

### Reference

The IdP-facing endpoints, all under `/scim/v2`:

| Endpoint                 | Methods          | Auth     |
| ------------------------ | ---------------- | -------- |
| `/ServiceProviderConfig` | GET              | **None** |
| `/Users`                 | GET, POST        | Bearer   |
| `/Users/:id`             | GET, PUT, PATCH  | Bearer   |
| `/Groups`                | GET, POST        | Bearer   |
| `/Groups/:id`            | GET, PUT, DELETE | Bearer   |

> `/ServiceProviderConfig` is unauthenticated by design — the SCIM specification expects
> identity providers to read it during setup, before any credential is configured. It
> advertises capabilities only and exposes no customer data.
>
> The specification's other two discovery endpoints, **`/ResourceTypes` and `/Schemas`, are
> not implemented.** Identity providers that request them during setup will report an error
> or fall back to defaults, and SCIM auto-discovery will not complete — configure the
> connection manually in that case.

The administrative endpoints, under `/api/v1`, all requiring the `integrations:manage`
capability:

| Endpoint                                        | Method | Description                              |
| ----------------------------------------------- | ------ | ---------------------------------------- |
| `/api/v1/scim-token`                            | GET    | Token metadata; never the value          |
| `/api/v1/scim-token`                            | POST   | Issue a token, revoking any existing one |
| `/api/v1/scim-token`                            | DELETE | Revoke the active token                  |
| `/api/v1/scim/group-role-mappings`              | GET    | List mappings                            |
| `/api/v1/scim/group-role-mappings/:scimGroupId` | PUT    | Create or update a mapping               |
| `/api/v1/scim/group-role-mappings/:scimGroupId` | DELETE | Remove a mapping                         |

### Audit trail

SCIM writes audit entries under four record types: `user` for the accounts it provisions
and updates, `team` for membership changes, `scim_group_role_mapping` for mapping changes,
and `scim_token` for token issue and revoke.

> Only `user` appears in the Audit Log page's record-type filter. The other three do not —
> review those in the unfiltered list.

---

## 19. Teams

Teams group users so that record visibility can be scoped to them. A team needs only a
name; a manager, a parent team, and members are all optional.

### Tutorial: create a team and add members

#### Step 1 — Create the team

1. Go to **Admin Settings → Users & Access**.
2. In **Team Management**, click **New team**.
3. Enter a **Team name** (required, and unique regardless of casing).
4. Optionally choose a **Manager** and a **Parent team**.
5. Click **Save**.

#### Step 2 — Add members

1. Click **Members** on the team's row.
2. Click **Add member**, choose a user, and pick their role: **Lead** or **Member**.
3. Remove someone with **Remove** on their row.

### Hierarchy rules

Teams nest to any depth through **Parent team**, which is what lets a manager's visibility
reach sub-teams. Two operations are refused:

- **A team cannot become its own ancestor.** Reparenting that would create a loop is
  rejected.
- **A team with child teams cannot be deleted.** Reparent or delete the children first.

### How teams affect record visibility

Team membership is what the `team` visibility policy resolves against, and a manager's
access always follows the team tree they manage — including sub-teams — no matter which
policy is active. The rules are set out in
[Section 13 — Data Visibility Scoping](#13-data-visibility-scoping).

Two consequences worth stating here:

- **Team-scoped visibility needs both halves.** A user must hold the `manager` role _and_
  be named in a team's **Manager** field. Being a member of a team is not the same thing,
  and the Manager dropdown lists every active user — so naming a rep there is accepted and
  silently grants them nothing. A manager named on no team sees only their own records.
- **A manager may only reassign records to someone inside their own team subtree.** Any
  other target is refused.

### Turning AI lead routing off for one team

One feature can be disabled per team: **AI Lead Routing Suggestion**. Set it under
**Admin Settings → AI → Lead Routing → Per-Team Overrides**, not in this panel and not on
the Features page. That team's members fall back to manual assignment.

This is the only per-team feature control that exists — no other flag can be scoped to a
team — and **only an administrator can set it**, despite the feature being manager-facing.

> **A user on several teams is blocked if _any_ of their teams has it disabled**, which is
> deliberately the conservative direction. Two things still outrank it: a per-user override,
> and the `ai_features` master toggle, which disables every AI sub-feature before any team
> setting is consulted.

### Teams created by SCIM

If you provision groups over SCIM, each mapped IdP group becomes an ordinary team here,
and appears in this panel alongside teams you created by hand. Editing membership in
MiniCRM will be overwritten on the next sync from your IdP — change it there instead. See
[Section 18 — SCIM Provisioning](#18-scim-provisioning).

### Reference

| Endpoint                            | Method | Description                     |
| ----------------------------------- | ------ | ------------------------------- |
| `/api/v1/teams`                     | GET    | List teams                      |
| `/api/v1/teams`                     | POST   | Create a team                   |
| `/api/v1/teams/:id`                 | GET    | Get one team                    |
| `/api/v1/teams/:id`                 | PUT    | Update name, manager, or parent |
| `/api/v1/teams/:id`                 | DELETE | Delete a team                   |
| `/api/v1/teams/:id/members`         | GET    | List members                    |
| `/api/v1/teams/:id/members`         | POST   | Add a member                    |
| `/api/v1/teams/:id/members/:userId` | DELETE | Remove a member                 |

Reading teams and their members requires only an authenticated session. Every write
requires the `teams:manage` capability, which the built-in `admin` role has and `manager`
does not — managers work within their teams rather than administering them.
