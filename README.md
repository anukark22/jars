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

## Files

| File | |
| --- | --- |
| `index.html` | The whole app |
| `.claude/launch.json` | Local dev-server config, for previewing during development |
