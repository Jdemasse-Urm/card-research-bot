# Card Research Bot

An AI research assistant for a trading card business. Runs on **Windows and Mac** in your web browser, powered by
**Google Gemini** (free tier works — no credit card).

**Research**
- **Drag & drop a card photo** (front + back works best), or take one with your phone's camera. The bot identifies
  the card (player/character, year, set, number, parallel, slab grade), pulls the **most recent sold prices for every
  grade**, searches Google for news and price moves, and gives a reseller call: max buy price, list price,
  quick-sale price, whether to grade it, and **which grading company** pays best for a 10.
- **Lot / binder-page evaluator** — one photo of many cards → each card priced, total value, and whether the asking
  price is a good buy.
- **PSA slab check** — reads the cert number off the slab and verifies it with PSA, with population by grade.
- **eBay deal finder** — live listings priced well under the card's recent sold value.
- **Listing writer** — eBay / TCGplayer / Whatnot title, description, item specifics and pricing.
- **Centering tool** — measure left/right and top/bottom centering on the photo.
- **⚡ Quick price** and **📖 Set browser** — free sold-price lookups and every card in a set sorted by value (no AI).
- **🔥 Hottest cards** — today / this week / this month per category, double-checked against real sold prices, with
  NEW / ↑↓ markers vs the last scan. Optional automatic **morning brief**.
- **Ask** — any market question (or follow-ups about a specific card), answered with Google-searched sources.

**Business**
- **Home dashboard** — inventory value, profit this month, alerts, hottest cards, movers, who did what.
- **Inventory** — in stock / listed / at grading / sold, SKUs, storage locations, tags, printable labels, CSV import
  and export, daily re-valuing, portfolio value chart, "you already own this" warnings.
- **Grading tracker** — submissions, cards at grading, PSA progress checked automatically, grades + cost basis
  updated when cards come back.
- **Sales & profit** — revenue, fees, profit, ROI, days to sell, best/worst flips, by month and category. **Expenses**.
- **★ Watchlist** — price alerts, biggest movers (24h / 7d / 30d), buy-the-dip / at-peak badges.
- **Share on your home network** — one computer runs it; the other computer or a phone opens it (PIN-protected).

Covers baseball, basketball, football, Yu-Gi-Oh and One Piece — plus Pokémon, hockey and soccer.

## Where the data comes from

| Data | Source |
|---|---|
| Recent sold prices (eBay completed sales), value per grade, volume, 1/3/6/12-month trends, history | SportsCardsPro.com (sports) and PriceCharting.com (Yu-Gi-Oh, One Piece) |
| Yu-Gi-Oh printings, rarities, TCGplayer/Cardmarket prices, banlist | YGOPRODeck API |
| One Piece variants (alt art, manga, SP) with TCGplayer market price | optcgapi.com |
| Reading the card photo, news, hot cards, answers, listings | Google Gemini (`gemini-3.8-flash`, backup `gemini-3.5-flash-lite`) with Google Search |
| Slab verification, population, grading progress (optional) | PSA Public API |
| Live listings for the deal finder (optional) | eBay Browse API |
| Every card in a set | SportsCardsPro.com / PriceCharting.com set pages |

## Setup (once per computer)

1. **Install Node.js (LTS)** from <https://nodejs.org>. Windows: the `.msi`. Mac: the `.pkg` (macOS Ventura 13+ is fine).
2. **Get a free Gemini API key** at <https://aistudio.google.com/apikey> → sign in with Google → **Create API key**.
3. *(Optional)* **PSA token** — free at <https://www.psacard.com/publicapi/documentation> — for slab checks, population
   and grading progress. **eBay keys** — free at <https://developer.ebay.com/my/keys> (Production keyset: App ID +
   Cert ID) — for the deal finder. Paste them in **Settings → Optional connections**.
4. **Download this folder** (GitHub → green **Code** button → **Download ZIP**, then unzip), or `git clone` it.

## Start it

- **Windows:** double-click **`start-windows.bat`**
- **Mac:** double-click **`start-mac.command`**
  - If macOS says it can't be opened: right-click it → **Open** → **Open**.
  - If it says you don't have permission: open Terminal, type `chmod +x ` (with a space), drag the file into the
    Terminal window, press Enter, then double-click it again.

The first start installs what it needs (about a minute), then your browser opens **http://localhost:3737**.
Click **⚙ Settings**, paste your Gemini key, then click **🩺 Run self-test** to confirm everything works. Keep the black terminal window open while you use the bot; close it
to stop.

## Cost

- **Free tier:** $0. Google limits how many requests per minute/day you can make; if you hit the limit the bot waits
  and retries, or tells you to try again later. On the free tier Google may use your prompts to improve its products.
- **If you turn on billing** in Google AI Studio (higher limits, private data): a card lookup is roughly a cent or two.
  The first 5,000 Google-searched requests each month are free. Settings shows this month's estimated spend and lets
  you set a monthly cap.
- Quick price, watchlist re-checks and inventory re-valuing never use AI — always free.

## Using it from both computers (one shared inventory)

On the computer that will run the bot: **Settings → Share on home network** → tick **Share**, pick a 4–8 digit PIN,
**Save**, then close and restart the bot. Settings shows the address to open on the other computer (e.g.
`http://192.168.1.20:3737`). Open it in Safari/Chrome there and enter the PIN. Both of you now see the same inventory,
watchlist and history. Only the computer running the bot can change settings.

## Using it on a phone at a card show

Turn on **Settings → Share on home network** (or use a phone hotspot that the laptop is also on). Open the address it
shows on the phone, enter the PIN, then use **Share → Add to Home Screen** (iPhone Safari) or **Install app**
(Android Chrome). The **📷 Take photo** button opens the camera.

## Keyboard shortcuts

`/` search · `Ctrl/⌘ + Enter` research · `Esc` cancel · `1`–`8` tabs · `?` list them.

## Tips

- Photos: good light, card fills the frame, no glare on the slab. Add the back for set/number confirmation.
- iPhone HEIC photos: export as JPEG first (Photos → File → Export), or set iPhone Camera → Formats → Most Compatible.
- Type extra details in the box with the photo, e.g. "it's the silver prizm" or "PSA 9".
- Hottest-cards results are cached (4h daily / 12h weekly / 24h monthly); hit **↻ Refresh** for a new scan.
- **Settings → Backup** downloads everything in one file; restore it on another computer. The bot also keeps 14 daily
  backups automatically in `data/backups`.
- Something wrong? **Settings → Copy diagnostics** and paste it in a message (it never includes your keys).

## Options (`.env` file)

See `.env.example`: port, model (e.g. `gemini-3.5-flash-lite` for faster/cheaper), monthly budget, sharing.

## Your data

Everything stays on your computer in the `data/` folder. The API key is in `.env`. Neither is uploaded to GitHub.

## Check that everything works

```
npm run selftest     # data sources + Gemini key + Google Search + one full lookup
npm run check        # just the free data sources
```

## Updating

Download the newest ZIP, then copy your old `data` folder and `.env` file into the new folder (or `git pull` if you
cloned it). See `CHANGELOG.md` for what changed.
