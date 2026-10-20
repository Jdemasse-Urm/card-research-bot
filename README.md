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

## The MJC website connection

Cards you mark **Sell on MJC** appear on the MJC store website with their photos. A daily pricing engine sets
their prices from real sold comps and learns from your sales. Website orders come back into inventory as sold,
and customer messages from the site's chatbot (Pip) land in **Inventory → MJC store**. Setup: deploy the
store backend (see the `mcj` repo, `api/deploy.mjs`), then paste its address and sync key into
**MJC store → Setup** and fill in your shipping, returns and policies.

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

## Download

Go to **[Releases](../../releases/latest)** and download the one for your computer:

- **Windows:** `CardResearchBot-Setup-x.y.z-Windows.exe` → double-click. If Windows says "Windows protected your PC":
  **More info → Run anyway**. It installs in seconds and adds **Card Research Bot** to your Desktop and Start menu.
- **Mac** (Apple Silicon or Intel, macOS 11+): `CardResearchBot-x.y.z-Mac.dmg` → double-click → drag
  **Card Research Bot** into **Applications**. The first open is blocked with *"Apple cannot check it for malicious
  software"* (the app isn't Apple-signed). Click **Cancel**, then **System Settings → Privacy & Security → scroll down →
  Open Anyway**. Or right-click the app → **Open** → **Open**. If it still refuses, open Terminal and run
  `xattr -cr "/Applications/Card Research Bot.app"`. This is a one-time step.

Then get a **free Gemini API key** at <https://aistudio.google.com/apikey> (sign in with Google → **Create API key**),
paste it in the app's **⚙ Settings**, and click **🩺 Run self-test**.

*(Optional)* **PSA token** — free at <https://www.psacard.com/publicapi/documentation> — for slab checks, population
and grading progress. **eBay keys** — free at <https://developer.ebay.com/my/keys> (Production keyset: App ID +
Cert ID) — for the deal finder. Paste them in **Settings → Optional connections**.

**Updating:** install the new version over the old one — your data and settings are kept. They live in
`%APPDATA%\Card Research Bot` (Windows) or `~/Library/Application Support/Card Research Bot` (Mac);
**Settings → Open data folder** takes you there.

## For developers

```
npm install
npm run app        # desktop app from source
npm start          # just the server; open http://localhost:3737 in a browser
npm run selftest   # data sources + Gemini key + Google Search + one full lookup
npm run dist:win   # build the Windows installer into dist/
```

Releases: push a tag like `v3.2.0` — GitHub Actions (`.github/workflows/release.yml`) builds the Windows installer on
Windows and the Mac `.dmg` on macOS, smoke-tests both packaged apps, and attaches them to the release.

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

## Options (`.env` file in your data folder)

See `.env.example`: port, model (e.g. `gemini-3.5-flash-lite` for faster/cheaper), monthly budget, sharing,
morning brief. Most of these are also in **Settings**.

## Your data

Everything stays on your computer in your data folder (**Settings → Open data folder**): `data/` holds your
inventory, lookups, watchlist and backups, `.env` holds your keys. Your inventory and keys never leave your computer;
card searches go to the price sites (and PSA/eBay if connected), and photos/questions go to Google Gemini for research.
