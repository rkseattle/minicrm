# AI Assistant

> **Feature flag:** `ai_features` and `ai_nli_page`
>
> The AI Assistant page is only visible when your admin has enabled AI features and
> configured an AI provider. If you do not see the **AI Assistant** tab in your navigation,
> contact your admin.

The AI Assistant gives you a conversational interface to ask questions about your CRM
data, draft content, and get help with sales tasks — without leaving MiniCRM.

---

## Tutorial: having a conversation

### Step 1 — Open the AI Assistant

Click **AI Assistant** in the top navigation (or sidebar, depending on your layout setting).

If this is your first visit, you will see an empty state with a prompt input at the bottom.

### Step 2 — Send a message

Type your question or request in the text area at the bottom of the page and press
**Cmd+Enter** (or **Ctrl+Enter** on Windows/Linux, or click the **Send** button).

Example questions you can ask:

- "How many open deals do we have this month?"
- "Draft a follow-up email for a prospect who went cold after our demo."
- "Summarise what I know about Acme Corp."

The assistant's reply appears in the conversation thread above your message.

### Step 3 — Continue the conversation

Each reply in the thread maintains context from earlier messages in the same session.
You can ask follow-up questions without repeating context:

- "Which of those deals are highest value?"
- "Make the email more concise."

### Step 4 — Start a new session

To start a fresh conversation with no prior context, click **New Session** at the top of
the session list (desktop) or the **New Session** button in the conversation header (mobile).

A new session appears in the session list on the left (desktop only). The previous session
is preserved and you can return to it at any time.

---

## Tutorial: managing sessions

### Switching between sessions (desktop)

The session list on the left side of the screen shows all your past conversations,
most recent first. Each session is named automatically from your first message.

Click any session to reload that conversation in the thread panel.

### Deleting a session (desktop)

1. Hover over a session in the list — a **Delete** icon appears to the right.
2. Click the icon.
3. Confirm the deletion in the dialog that appears.

The session and all its messages are permanently removed.

> Sessions belong to your account and are not visible to other users, including admins.

---

## What the AI Assistant can do

The AI Assistant has direct access to your CRM data and can perform actions on your behalf.
It uses a set of built-in tools to read and write records — you do not need to copy and paste
data into your messages.

### Reading data

When you ask the AI to look up records, matching results appear as **inline cards** directly
in the conversation — you do not need to navigate to a separate page. Each card shows key
fields for the record type and includes a **View record** link to open the full detail page.

| What you can ask                           | Example                                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| Search contacts, accounts, leads, or deals | "Find all contacts at Acme Corp"                        |
| Look up a specific record                  | "Get me the details for deal ID xyz"                    |
| List activities, notes, or tags            | "What activities are logged for John Smith this month?" |
| Run a report                               | "Give me a win/loss breakdown for Q2"                   |
| Browse pipeline stages                     | "What stages are in our default pipeline?"              |

#### Result cards

After a successful search or lookup, the AI response includes a set of cards for the
matching records. Each card shows:

| Record type | Fields shown on card                              |
| ----------- | ------------------------------------------------- |
| Contact     | Name, email, company, phone                       |
| Account     | Company name, website, industry                   |
| Lead        | Name, email, company, status                      |
| Deal        | Title, stage, value, currency, close date         |
| Activity    | Subject, type, status, due date                   |
| Note        | Subject, content preview, last-activity timestamp |

If the search returns no results, a "No results found" notice appears in place of the cards.

### Writing data

The assistant can create and update records when you ask it to:

| Action                                                   | Example                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| Create a contact, lead, deal, account, activity, or note | "Add a new lead: Jane Doe, jane@example.com, from a trade show" |
| Update an existing record                                | "Change the close date on the Acme deal to end of month"        |
| Convert a lead                                           | "Convert the Jane Doe lead to a contact and deal"               |
| Attach or remove a tag                                   | "Tag the Acme Corp account as VIP"                              |
| Delete a record                                          | "Delete the duplicate contact I just created"                   |

> **Note:** The assistant can only modify records you own. Admins can modify any record.

### Confirming write actions

Before the AI executes any create, update, or delete operation it shows a **confirmation
block** in the chat. This gives you a chance to review the proposed change and either
approve it or cancel before anything is written to your CRM.

#### What the confirmation block shows

- An **operation badge** — green for Create, blue for Update, red for Delete.
- The **record type** (Contact, Deal, Lead, etc.) and a short summary of the proposed change.
- A **field preview** table showing the values that will be set (for create/update) or the
  name of the record that will be deleted.
- For operations affecting **multiple records**, a count of how many records are affected and
  a sample list of record names.

#### Approving a change

Click **Confirm** to let the AI proceed. The confirmation block becomes disabled while the
request is being processed.

#### Cancelling a change

Click **Cancel** to abort the operation. The AI will acknowledge the cancellation and no
data will be written.

#### Bulk delete double-confirmation

When the AI proposes deleting more than one record at once, an additional safety gate
appears below the warning. You must type either:

- The exact number of records to be deleted (e.g. `5`), or
- The word `DELETE` (in any case)

…before the **Confirm** button becomes active (case-insensitive). This prevents accidental bulk deletions.

> If you reload the page or navigate away after clicking **Confirm**, the AI request is
> still processed — navigating away does not cancel an in-flight write.

### Visibility and data access

Your data access in the AI Assistant mirrors your normal CRM permissions:

- **Viewers** can search and read records but cannot create, update, or delete anything
  via the AI Assistant.
- **Reps** see and can modify only their own contacts, accounts, leads, and deals.
- **Admins** see all records and can scope reports to any user. Admins also have access
  to read-only tools for pipeline stages, custom field definitions, automation rules,
  webhooks, and email templates.

The tool set Claude has access to is filtered server-side based on your role — Claude
never receives tools for operations you are not authorized to perform.

The assistant never exposes webhook signing secrets or values from custom fields marked
as PII-excluded by your administrator.

---

## Audit trail for AI-initiated changes

Every record created, updated, or deleted via the AI Assistant is written to the audit log
just like a manual change — with one difference: the entry is tagged with the source
**AI (NLI)** so administrators can distinguish AI-initiated changes from human ones.

You can see this attribution in **Admin → Data → Audit Log**:

- In the **User** column, an **AI (NLI)** badge appears next to your name on entries
  created through the AI Assistant.
- Admins can filter the audit log by **Source** to view only AI-initiated changes, only
  human changes, or all changes together.

This means all AI actions are fully auditable and reversible — nothing the AI does on your
behalf is hidden from the audit trail.

---

## Reference

### Sessions and privacy

Each conversation session is scoped to your user account. Other users — including
administrators — cannot read your sessions. Sessions persist across browser refreshes
and logins until you delete them.

### Token usage and limits

Your admin may set a monthly token budget that limits how many AI requests you can make.
If you reach your budget, the AI Assistant will show an error message until the budget
resets at the start of the next calendar month.

### AI responses are not guaranteed to be accurate

The AI Assistant uses a large language model. Its responses can contain errors, hallucinations,
or outdated information. Always verify important facts — especially financial figures and
data referenced from your CRM — against the source records.

### Keyboard shortcuts

| Action            | Shortcut                                    |
| ----------------- | ------------------------------------------- |
| Send message      | **Cmd+Enter** (Ctrl+Enter on Windows/Linux) |
| New line in input | **Shift + Enter**                           |
