# pages/

Application-specific Page Objects. Organized per app: `pages/<app>/`.

Page Objects encapsulate **UI interactions only** — they locate elements and perform
actions, but contain no assertion logic or business workflow composition.

Example structure (added in later stories):

```
pages/
  minicrm/
    LoginPage.ts
    ContactsPage.ts
    DealsPage.ts
```
