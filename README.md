# Card Research Bot

An AI research assistant for a trading card business. Runs on **Windows and Mac** in your web browser, powered by
**Google Gemini**. The free tier reads photos, scans and prices cards; the features that search Google (hottest cards,
Ask, news) need billing turned on, because Google’s free tier has no Google Search on Gemini 3 models.

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
- **🔥 Hottest cards** — today / this week / this month per category: targeted Google searches, then every card checked
  against its own sold prices (the ones sold prices back rank first), with its sources, whether you own / want /
  watch it, an alert when a card you own shows up, and how the list's past picks did since. Without Google Search
  (needs billing on Gemini 3) it ranks your own tracked cards by their real price moves. Optional **morning brief**.
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

**The site:** https://main.dsq06359z2wce.amplifyapp.com (live since Nov 5, 2026; main.d2p7srpg832hvo is the old Oct 26
demo — see the `mcj` repo). **Every feature of both apps:** [FEATURES.md](FEATURES.md) here and
[mcj/FEATURES.md](https://github.com/UR-MORTGAGE/mcj/blob/main/FEATURES.md).

Cards you mark **Sell on MJC** appear on the MJC store website with their photos. A daily pricing engine sets
their prices from real sold comps and learns from your sales — and health-checks itself every day: the learned
model only steers prices when it predicts unseen listing-days better than the built-in assumptions, a day the
sold-price feed can't be read holds every price (one alert, hourly retry), and a market value that jumps 40%+
overnight is held until the feed confirms it. Website orders come back into inventory as sold,
and customer messages from the site's chatbot (Pip) land in **Inventory → MJC store**. Setup: deploy the
store backend (see the `mcj` repo, `api/deploy.mjs`), then paste its address and sync key into
**MJC store → Setup** and fill in your shipping, returns and policies.

## Where the data comes from

| Data | Source |
|---|---|
| Recent sold prices (eBay completed sales), value per grade, volume, 1/3/6/12-month trends, history | SportsCardsPro.com (sports) and PriceCharting.com (Yu-Gi-Oh, One Piece) |
| Yu-Gi-Oh printings, rarities, TCGplayer/Cardmarket prices, banlist | YGOPRODeck API |
| One Piece variants (alt art, manga, SP) with TCGplayer market price | optcgapi.com |
| Reading the card photo, news, hot cards, answers, listings | Google Gemini (`gemini-3.8-flash`, backups `gemini-3.5-flash-lite` and `gemini-2.5-flash`) with Google Search |
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

**Price search:** SportsCardsPro and PriceCharting put a robot check on their search pages in late Oct 2026, so
finding a new card's sold prices needs their API: $6/month each (SportsCardsPro for sports cards; PriceCharting
for Yu-Gi-Oh, One Piece and Pokémon — optional, those also have free sources). Paste the 40-character token from the
site's Subscription page → API/Download in **Settings → Optional connections**; Save tries it once. Cards already priced
keep re-pricing without it.

*(PSA, Nov 2026: PSA now switches its API on account by account — a new account's token gets "Access to this API is
limited to approved customers" until PSA approves it. Settings → ✉ Ask PSA for access writes the email.)*

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
  Google Search is not part of the free tier on Gemini 3 models; until Google retires it on Dec 1, 2026 the bot
  searches with the older gemini-2.5-flash instead (free, 500 searches a day). After that, hottest cards, Ask and the
  news in a lookup need billing on (a lookup still works without it, from the sold prices). When Google is overloaded the bot switches to
  the backup model (`gemini-3.5-flash-lite`), then to `gemini-2.5-flash`, and skips the overloaded one for 5 minutes (longer
  if it stays overloaded). Backup models get parallels wrong more often, so a card a backup read is marked
  "⚠ backup read" for a check by eye.
- **If you turn on billing** in Google AI Studio (higher limits, private data): a card lookup is roughly a cent or two
  (about 3¢ from Jan 1, 2027, when Google doubles gemini-3.8-flash's price). The first 5,000 Google-searched requests
  each month are free. New Google accounts **prepay** (from $5; credit expires after 12 months): turn on **auto-reload**
  in AI Studio → Billing, because at $0 Google stops the key until credit is added. Settings shows this month's
  estimated spend and lets you set a monthly cap.
- Quick price, watchlist re-checks and inventory re-valuing never use AI — always free.

## Using it from both computers (one shared inventory)

**Shared inventory (3.19, recommended — works anywhere):** each computer runs its own bot, and both work on ONE set of
cards, sales, customers, expenses, shows and research. On the first computer: **Inventory → MJC store → ⚙ Setup →
Shared inventory**, name the computer, **Next → Start sharing**, then **🔑 Invite code for the other computer** → send
the code to the other person (it holds the store's sync key — only to them). On the second computer: the same panel,
paste the code, name it, **Next**, then **Add this computer's cards** (or **Use the shared copy** if it only had test
cards). A change on one shows up on the other within ~20 s; a computer that was off catches up when it's back; each
keeps a full working copy and its own backups. The shared copy lives privately in the MJC store's own storage (never on
the website). The daily jobs (re-pricing, website orders, PSA checks, value history) run on one computer — the panel
says which — and move to the other by themselves if it's off for 20 minutes. Per computer, not shared: Google AI spend
(the monthly budget counts on each), the phone's scan list, Undo. How it merges: a card added or edited on each
computer both survive; the same field changed on both → the later save wins; a card deleted on one but edited on the
other is kept. Code: `lib/team.js`.

**Home network share (one bot, opened from another screen on the same Wi-Fi):** on the computer that will run the bot:
**Settings → Share on home network** → tick **Share**, pick a 4–8 digit PIN, **Save**, then close and restart the bot.
Settings shows the address to open on the other device (e.g. `http://192.168.1.20:3737`). Open it in Safari/Chrome
there and enter the PIN. Handy for a phone or tablet at a show; it needs that computer on and on the same network.
Only the computer running the bot can change settings.

## Using it on a phone at a card show

Turn on **Settings → Share on home network** (or use a phone hotspot that the laptop is also on). Open the address it
shows on the phone, enter the PIN, then use **Share → Add to Home Screen** (iPhone Safari) or **Install app**
(Android Chrome). The **📷 Take photo** button opens the camera.

**Scanning a stack or binder pages with the phone:** Inventory → Bulk scan → **📱 Phone** shows a QR code; open it on
the phone (same Wi-Fi). Each picture goes to the computer at full resolution and is read there — whatever screen the
app is on — and the phone shows what was found a few seconds later: how many cards, which ones to retake (glare,
blurry, cut off — "row 2, card 3"), and each card's name and value. Tick **Front + back** to flip the card (or the whole
page, like a book page) after each front. A dropped Wi-Fi doesn't lose a picture: it waits on the phone and goes when
the connection is back. Check and add the cards on the computer (Inventory → Bulk scan shows how many are new).

## Card shows: Show mode, labels and a barcode scanner

**Inventory → 🏪 Show mode** is a register: scan or type a card, set its price, tap how they paid, **Complete sale**.
Each card is marked sold on "Card show" with the payment; part of a stack stays in stock. **Undo** puts the last
sale back. **Copy today's summary** gives you the day's total by payment type.

**🏷 Print labels** puts a barcode of each card's SKU on the label (letter sheet or 2.25" × 1.25" thermal roll). Any
USB or Bluetooth barcode scanner works with it — it "types" the SKU, so scanning into Show mode adds the card to
the sale, and scanning into the Stock search opens the card.

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

**Backups:** one automatic backup a day (last 14) in `data/backups`. In **Settings → Backup** you can pick your
OneDrive, iCloud Drive, Dropbox or Google Drive folder and every backup is copied there too, so a broken or stolen
computer doesn't take your records. Restore with **Settings → Restore from backup**.

**Updates (desktop app):** new versions install by themselves (**Settings → Desktop app → Update automatically**, on
by default). Every 6 hours the app looks for a new release; it downloads the installer from this project's GitHub
releases, checks it against GitHub's checksum, and installs it once nobody has used the computer for 10 minutes and
no research is running. Windows installs silently and reopens; a Mac swaps the app in place and reopens. A
notification says it updated. The banner's **Update now** does the same thing straight away. The release build
tests both installs (the Windows silent install, the Mac swap from the real .dmg) before anything ships.

Everything stays on your computer in your data folder (**Settings → Open data folder**): `data/` holds your
inventory, lookups, watchlist and backups, `.env` holds your keys. Your keys never leave your computer. Your inventory
stays here too — unless you turn on **Shared inventory**, which keeps the shared copy privately in your MJC store's own
storage (with card photos in its photo folder) so both computers work on one set; the website shows only cards you put
on it. Card searches go to the price sites (and PSA/eBay if connected), and photos/questions go to Google Gemini for
research.
