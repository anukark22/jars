# jars

A soft, romantic savings planner — a single self-contained HTML file, no build step and no dependencies.

Open `index.html` in a browser and it just runs. Everything is stored locally in your browser.

## What it does

Save up for the things you want, in jars.

- **Home** — a greeting, what you're currently saving for, your collections, the jar in focus, and a ledger
- **Wallet** — the money you actually have. Add income, subtract spending, and see what's left after everything already sitting in your jars
- **Priority** — a three-column board (Must Have / Nice To Have / Someday). Drag a jar between columns to change how much it matters
- **Events** — everything with a date, grouped by month
- **Calendar** — a month grid; click any day to see what's on it or add something new to that date

## How the money works

Your wallet balance is **money in − everything currently in your jars**. It's calculated fresh rather than tracked as a running total, so it can't drift out of sync.

Putting money into a jar takes it out of your wallet, whether you use the card's **+** button, the **Saved** field when editing, or **Put money in** on the Wallet page. Lowering a jar's amount — or deleting the jar — returns that money to your wallet.

## Other bits

- Light and dark themes, remembered between visits, following your system setting by default
- Add a photo to a jar, or paste an image link and it becomes the jar's picture
- Links in notes become clickable
- Optional checklists on experiences and celebrations
- Works even where browser storage is blocked, just without saving between visits


## Accounts

There are local accounts, so two people sharing a browser keep separate jars.
Sign up, log in, log out and a password reset all live in `login.html`,
`signup.html` and `forgot-password.html`, with the logic in `auth.js`.

```
localStorage
  users        [ { id, email, password, createdAt, data: { ...the planner keys } } ]
  currentUser  the id of whoever is signed in
```

The planner writes through `safeGet`/`safeSet`, and those two functions are the
only thing that changed: they now read and write inside the signed-in account's
`data` rather than a shared key. Every load and save function above them is
untouched. The theme stays outside the accounts, since how the screen looks
belongs to the device rather than the person.

Jars saved before accounts existed are copied into the first account made, and
the original keys are left where they are rather than deleted.

### What this is not

**It is not secure, and it is not a real login.** Passwords are kept as plain
text in the same browser storage as everything else, because there is nothing
else here to check them against. Anyone who can open this device can read them,
and the password reset asks only for an email address — no proof of anything.

It keeps two people's jars apart on one laptop. That is all it does. Accounts
live in one browser on one device: they do not sync, and clearing site data
removes them. Do not put anything sensitive in it, and do not reuse a password
you use elsewhere.

## Files

| File | |
| --- | --- |
| `index.html` | The whole app |
| `.claude/launch.json` | Local dev-server config, for previewing during development |
