# Card Research Bot

An AI research assistant for a trading card business. Runs on **Windows and Mac** in your web browser.

- **Drag & drop a card photo** (front + back works best). The bot identifies the card (player/character, year,
  set, number, parallel, grade on the slab), pulls the **most recent sold prices for every grade**, searches the
  web for news and price moves, and gives a reseller call: max buy price, list price, quick-sale price, and
  whether it's worth grading.
- **⚡ Quick price (free)** — instant sold-price lookup by name, no AI and no cost.
- **🔥 Hottest cards** — today / this week / this month, for baseball, basketball, football, Yu-Gi-Oh,
  One Piece, or all of them.
- **★ Watchlist** — track cards; prices re-check daily (free) and show your biggest movers over 24h / 7d / 30d.
- **Ask** — any market question, answered with live web research and sources.
- **History** — every report is saved on your computer.

## Where the data comes from

| Data | Source |
|---|---|
| Recent sold prices (eBay completed sales), value per grade, sales volume, 1/3/6/12-month trends | SportsCardsPro.com (sports) and PriceCharting.com (Yu-Gi-Oh, One Piece) |
| Yu-Gi-Oh printings, rarities, TCGplayer/Cardmarket prices, banlist | YGOPRODeck API |
| One Piece variants (alt art, manga, SP) with TCGplayer market price | optcgapi.com |
| News, hot cards, anything else | Live web search + page reading by Claude |
| Reading the card photo | Claude vision |

## Setup (once per computer)

1. **Install Node.js (LTS)** from <https://nodejs.org> — Windows: the `.msi`; Mac: the `.pkg`
   (works on macOS Ventura 13 and newer).
2. **Get an Anthropic API key** at <https://console.anthropic.com/settings/keys> and add a little credit under
   Billing. Each AI card lookup typically costs about **$0.10–$0.50**; hottest-cards scans cost a bit more.
   Quick price and watchlist re-checks are free.
3. **Download this folder** (GitHub → green **Code** button → **Download ZIP**, then unzip), or `git clone` it.

## Start it

- **Windows:** double-click **`start-windows.bat`**
- **Mac:** double-click **`start-mac.command`**
  - If macOS says it can't be opened: right-click it → **Open** → **Open**.
  - If it says you don't have permission: open Terminal, type `chmod +x ` (with a space), drag the file into the
    Terminal window, press Enter, then double-click it again.

The first start installs what it needs (about a minute). Your browser opens to **http://localhost:3737**.
Click **⚙ Settings** and paste your API key. Keep the black terminal window open while you use the bot;
close it to stop.

## Tips

- Photos: good light, card fills the frame, no glare on the slab. Add the back for set/number confirmation.
- iPhone HEIC photos: export as JPEG first (Photos → File → Export), or set iPhone Camera → Formats → Most Compatible.
- Type extra details in the box with the photo, e.g. "it's the silver prizm" or "PSA 9".
- Hottest-cards results are cached (4h daily / 12h weekly / 24h monthly); hit **↻ Refresh** for a new scan.

## Options (`.env` file)

See `.env.example`: change port, model, research effort (`low` / `medium` / `high`), and more.

## Your data

Everything stays on your computer in the `data/` folder (lookups, watchlist, hot-card reports). The API key is in
`.env`. Neither is uploaded to GitHub (`.gitignore`).

## Check the free data sources

```
npm run check
```
