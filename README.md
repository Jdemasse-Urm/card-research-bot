# Card Research Bot

An AI research assistant for a trading card business. Runs on **Windows and Mac** in your web browser, powered by
**Google Gemini** (free tier works — no credit card).

- **Drag & drop a card photo** (front + back works best). The bot identifies the card (player/character, year, set,
  number, parallel, grade on the slab), pulls the **most recent sold prices for every grade**, searches Google for news
  and price moves, and gives a reseller call: max buy price, list price, quick-sale price, and whether to grade it.
- **Batch mode** — drop a stack of photos (one card each) and the bot works through them in a queue.
- **⚡ Quick price (free)** — instant sold-price lookup by name, no AI.
- **🔥 Hottest cards** — today / this week / this month for baseball, basketball, football, Yu-Gi-Oh, One Piece, or
  all of them, each double-checked against real sold prices.
- **Inventory** — what you own, what you paid, what it's worth today, unrealized and realized profit. Export to CSV/Excel.
- **★ Watchlist + price alerts** — track cards, set "alert me at" prices, see biggest movers over 24h / 7d / 30d.
- **Calculators** on every report — profit after eBay / TCGplayer / Whatnot fees, and grading expected value from the
  AI's PSA-grade odds for your card.
- **Price-history charts** going back ~3 years for every grade.
- **Ask** — any market question (or follow-ups about a specific card), answered with Google-searched sources.
- **History** — every report saved with a thumbnail; search, re-run with fresh prices, delete, export.
- **Share on your home network** — run it on one computer, open it from the other (PIN-protected).

## Where the data comes from

| Data | Source |
|---|---|
| Recent sold prices (eBay completed sales), value per grade, volume, 1/3/6/12-month trends, history | SportsCardsPro.com (sports) and PriceCharting.com (Yu-Gi-Oh, One Piece) |
| Yu-Gi-Oh printings, rarities, TCGplayer/Cardmarket prices, banlist | YGOPRODeck API |
| One Piece variants (alt art, manga, SP) with TCGplayer market price | optcgapi.com |
| Reading the card photo, news, hot cards, answers | Google Gemini (`gemini-3.8-flash`) with Google Search |

## Setup (once per computer)

1. **Install Node.js (LTS)** from <https://nodejs.org>. Windows: the `.msi`. Mac: the `.pkg` (macOS Ventura 13+ is fine).
2. **Get a free Gemini API key** at <https://aistudio.google.com/apikey> → sign in with Google → **Create API key**.
3. **Download this folder** (GitHub → green **Code** button → **Download ZIP**, then unzip), or `git clone` it.

## Start it

- **Windows:** double-click **`start-windows.bat`**
- **Mac:** double-click **`start-mac.command`**
  - If macOS says it can't be opened: right-click it → **Open** → **Open**.
  - If it says you don't have permission: open Terminal, type `chmod +x ` (with a space), drag the file into the
    Terminal window, press Enter, then double-click it again.

The first start installs what it needs (about a minute), then your browser opens **http://localhost:3737**.
Click **⚙ Settings** and paste your Gemini key. Keep the black terminal window open while you use the bot; close it
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

## Tips

- Photos: good light, card fills the frame, no glare on the slab. Add the back for set/number confirmation.
- iPhone HEIC photos: export as JPEG first (Photos → File → Export), or set iPhone Camera → Formats → Most Compatible.
- Type extra details in the box with the photo, e.g. "it's the silver prizm" or "PSA 9".
- Hottest-cards results are cached (4h daily / 12h weekly / 24h monthly); hit **↻ Refresh** for a new scan.
- **Settings → Backup** downloads everything in one file; restore it on another computer.

## Options (`.env` file)

See `.env.example`: port, model (e.g. `gemini-3.5-flash-lite` for faster/cheaper), monthly budget, sharing.

## Your data

Everything stays on your computer in the `data/` folder. The API key is in `.env`. Neither is uploaded to GitHub.

## Check the free data sources

```
npm run check
```
