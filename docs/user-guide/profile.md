# Profile Settings

Click **Profile Settings** in the navigation to open your own account settings: the
language MiniCRM shows you, which emails it sends you, and two-factor authentication.

Everything here applies to you alone. Nothing on this page changes what your teammates
see, and nothing on it needs an admin.

---

## Tutorial: set up your account

### Step 1 — Choose your language

Under **Preferred language**, pick one of English, Chinese (Simplified), Spanish, French,
or German, then click **Save**. The interface switches immediately.

**Use system default** is the first option and means "follow whatever the admin has set
for everyone". Choosing it clears your personal preference rather than pinning you to the
current default, so you keep following the org if the admin later changes it.

> The header bar has a second language selector that saves the same preference. It lists
> each language in its own script — _Deutsch_ rather than _German_ — and offers no
> **Use system default** entry, so clearing a personal preference has to be done here.
> On narrower screens it moves into the menu behind the hamburger icon.

### Step 2 — Choose which emails you get

**Email Notifications** has three checkboxes, all on unless you turn them off:

| Setting            | Sends you                                                    |
| ------------------ | ------------------------------------------------------------ |
| Overdue tasks      | A daily digest when you have newly-overdue tasks             |
| Record assignments | An email when a contact, account, or deal is assigned to you |
| Deal stage changes | An email when one of your deals moves to a new stage         |

Ticking a box does not save it. Click the **Save** button in this section — it is separate
from the language one — or your changes are lost when you leave the page.

### Step 3 — Turn on two-factor authentication

Two-factor authentication asks for a code from your phone as well as your password.

1. Click **Set up two-factor authentication**.
2. Scan the QR code with an authenticator app such as Google Authenticator or Authy. The
   entry appears there under your email address.
3. Click **Next**, type the 6-digit code the app is showing, and click
   **Verify and enable**.
4. MiniCRM shows eight recovery codes. **Save them now** — see below.

---

## Reference

### Recovery codes

When you enable two-factor authentication, MiniCRM shows you **eight recovery codes**,
once. They are your way back in if you lose your phone.

| Property     | Value                                                                |
| ------------ | -------------------------------------------------------------------- |
| How many     | Eight, generated when you enroll                                     |
| Reuse        | Single-use — each one stops working after you redeem it              |
| Shown again  | No. MiniCRM stores them hashed and cannot display them a second time |
| Regenerating | Not possible. A fresh set means disabling and enrolling again        |

Use **Copy all codes** and put them somewhere safe first. Clicking
**I have saved my recovery codes** is the only way out of the dialog, and the codes are
gone once it closes.

Your **Two-Factor Authentication** panel shows how many codes remain. If that number is
getting low, disable and re-enroll to get eight fresh ones.

### Signing in with two-factor authentication on

After your password, MiniCRM asks for the 6-digit code from your app. If you cannot reach
your phone, click **Use a recovery code instead** and enter one of your eight. Each code
works once.

### Turning two-factor authentication off

Click **Disable two-factor authentication**, enter your **Current password**, and click
**Disable 2FA**. Your authenticator entry and your remaining recovery codes stop working
immediately.

Your admin cannot disable it for you — only you can, with your own password. If you are
locked out entirely, your admin's options are covered in
[Admin guide — Two-Factor Authentication](../admin-guide.md#16-two-factor-authentication).

### If your organization requires it

An admin can make two-factor authentication mandatory. If yours has, you land on this page
straight after signing in, with a banner reading _Your organisation requires two-factor
authentication. Please set it up to continue._

The banner prompts, it does not block: you keep full access whether you enroll or not. It
is carried in the link that brought you here rather than stored against your account, so
it disappears as soon as you navigate elsewhere and comes back at your next sign-in.
