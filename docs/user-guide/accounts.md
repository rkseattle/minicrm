# Accounts

Accounts represent companies or organisations. Linking contacts and deals to an account
gives you a full picture of your relationship with that company.

---

## Tutorial: create an account and link your contacts

### Step 1 — Create the account

1. Click **Accounts** in the navigation.
2. Click **New Account** (top-right).
3. Enter the **Account name** (required).
4. Choose an **Account type** from the dropdown (see reference below).
5. Optionally add website, phone, industry, and address.
6. Click **Save**.

### Step 2 — Link a contact to the account

1. Open the account's detail page.
2. In the **Contacts** section, click **Add contact**.
3. Search for an existing contact by name or email and select them.
4. The contact now appears under this account. Their contact record also shows the
   account in its **Account** field.

> You can also set the account when creating or editing a contact directly from the
> Contacts page.

### Step 3 — Link a deal to the account

1. On the account detail page, in the **Deals** section, click **New deal**.
2. Fill in the deal details — the account is pre-filled.
3. Save. The deal appears under the account and on the pipeline board.

### Step 4 — Set a parent account (subsidiaries)

If this account is a subsidiary of a larger company:

1. Open the account and click **Edit**.
2. In the **Parent account** field, search for and select the parent.
3. Save. The parent account's detail page will list this account under **Subsidiaries**.

---

## Reference

### Fields

| Field          | Notes                                         |
| -------------- | --------------------------------------------- |
| Account name   | Required                                      |
| Account type   | Optional; see type list below                 |
| Website        | Optional                                      |
| Phone          | Optional                                      |
| Industry       | Optional free-text                            |
| Owner          | The rep responsible; defaults to the creator  |
| Parent account | Links this account as a subsidiary of another |

### Account types

| Type       | When to use                                                |
| ---------- | ---------------------------------------------------------- |
| Prospect   | A company you are actively trying to win as a customer     |
| Customer   | A company that has bought from you                         |
| Partner    | A company you work with (reseller, referral partner, etc.) |
| Vendor     | A supplier or service provider                             |
| Competitor | A company you compete with                                 |
| Other      | Any other relationship                                     |

Account type is optional — you can leave it blank if it does not apply.

### Parent/child hierarchy

- An account can have one parent and any number of children.
- The parent account's detail page shows all subsidiaries.
- There is no limit on hierarchy depth, but circular relationships are not allowed.
