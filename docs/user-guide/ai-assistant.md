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

| What you can ask                           | Example                                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| Search contacts, accounts, leads, or deals | "Find all contacts at Acme Corp"                        |
| Look up a specific record                  | "Get me the details for deal ID xyz"                    |
| List activities, notes, or tags            | "What activities are logged for John Smith this month?" |
| Run a report                               | "Give me a win/loss breakdown for Q2"                   |
| Browse pipeline stages                     | "What stages are in our default pipeline?"              |

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

### Visibility and data access

Your data access in the AI Assistant mirrors your normal CRM permissions:

- **Reps** see and can modify only their own contacts, accounts, leads, and deals.
- **Admins** see all records and can scope reports to any user.

The assistant never exposes webhook signing secrets or PII-excluded custom fields.

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
