# Changelog

## 3.4.0 — the pricing engine and the AI, made dependable (10-10 on performance + service)

**Major**
- **Pricing engine: model health check.** Every daily training now tests the learned model on the newest
  30% of listing-days it hasn't seen, against the built-in starting assumptions, and checks that its price
  sensitivity is clearly negative. It only steers prices when it passes; otherwise prices stay on the
  schedule and the Pricing panel says why. A 30-day "expected sales vs actual" line shows calibration.
- **Pricing engine: a broken feed day doesn't count.** If the sold-price site can't be read for most cards,
  prices hold, you get one alert, no training rows are written, and the engine retries every hour.
- **Pricing engine: faster runs.** Sales pages load in parallel, one fetch per page even when several copies
  or grades share it, and the inventory is written once per run instead of once per card.
- **Pricing engine: training fix.** The trainer now damps its steps (line search) — on a shop with a high
  sale rate the old one could overshoot into a model that predicted a sale every day for every card.
- **AI: no more pile-ups.** At most two Gemini calls run at once (a lookup and a hot scan no longer race each
  other into "speed limit" errors), and a 429 waits exactly as long as Google asks instead of a blind 20 s.
- **AI: every call has a deadline** (90 s, 150 s for Google research). A hung call is retried once, then
  fails with a clear message instead of a job that never finishes.
- **AI: fast lane.** The simple structured steps (matching a card to its price page, matching a lot,
  writing a listing) run at low thinking effort — quicker and cheaper. If a model rejects the option it's
  dropped automatically.
- **Card lookups finish sooner:** the Google research starts at the same time as the sold-price search
  instead of after it.
- **AI performance panel** in Settings: calls and jobs today and over 7 days, failures, time-outs, average
  and slowest times, retries, switches to the backup model, fast-lane calls.
- **Pip (website chatbot) never leaves a shopper with an error.** If the AI is off, out of quota, slow or
  over its daily limit, Pip still searches the shop for what was asked, says plainly that its assistant is
  offline, and offers the team. Its calls have a deadline inside the server's own limit, and the website
  shows "taking longer than usual" after 6 s.

**Niche**
- Pricing: a market value that jumps 40%+ in a day is held until the feed confirms it the next day
  (misparsed page, mislabeled lot), and the Pricing panel lists what's on hold.
- Pricing: a website sale is recorded against the price it sold for, even if it sold before that day's run.
- Pricing: a learned price sensitivity that isn't clearly negative (a confounded fit) can't steer prices.
- Pricing: wiring tests — feed-failure day, shared page fetched once, market-jump hold, sale observation,
  health check — `npm test` runs 15 tests in 4 s with no network.
- AI: a repeat lookup of the same photo also skips the price-page match step, not just the identification.
- AI: each report shows how long it took; alerts for website orders, messages and pricing notices now read
  correctly in the Watchlist (they used to render as a price alert).
- Pip quotes the real shipping charge, free-shipping threshold, returns text and whether checkout is open.
- Pip understands plain-words filters — "rookies under $100", "PSA 10 basketball between $500 and $1,000",
  "cheapest signed football card" — as hard filters before ranking, and says when nothing matches.
- Pip: per-instance caches (catalog 15 s, repeated opening questions 10 min) and a daily AI-answer cap with
  counters you can see in MJC store → Setup (chats, hand-offs, answered without AI, average time).
- Store backend: Stripe and the AI SDK load only on the routes that use them (lighter cold starts).

## 3.3.0 — connected to the MJC website
- **Sell on MJC**: a switch on any inventory card puts it on the MJC website, with its photos and an
  optional AI-written description. Selling it anywhere else, or switching it off, takes it down automatically.
  Bulk "Sell selected on MJC" in Stock.
- **Daily pricing engine** for website cards. Prices come from that exact grade's recent sold comps (outliers
  removed, recent sales weighted most), your cost, how fast the card sells, and how long it's been listed.
  - Until the site has 10 sales it follows a steady starting schedule: market price, a premium for slow movers,
    2% markdowns each week a card doesn't sell.
  - After that, a model trained on your own sales decides how price-sensitive your buyers are.
  - Guardrails: never under cost + your margin (until the clearance age), at most ±5% a day, no churn under 1%.
  - Every change is logged with its reason. Settings live in Inventory → MJC store → Pricing engine.
- **Website orders → inventory**: paid orders arrive within 5 minutes as an alert. The card is marked sold on
  "MJC site" with Stripe's fee, and you add tracking in MJC store → Orders; the customer sees it.
- **Customer messages**: shoppers who ask Pip for a person land in MJC store → Messages, with the chat that
  led there and a one-click email reply.
- **Store details for Pip**: shipping, returns and policies typed once in MJC store → Setup. They're exactly
  what the website chatbot quotes and what checkout charges. Online checkout stays off until you turn it on.
- Your cost, notes, storage locations and SKUs never leave this computer — only public card facts are sent.

## 3.2.0 — the second 10-10

**Major**
- **Update checker**: a banner when a newer version is on GitHub, with the right download for your computer; Settings → Check for updates.
- **Runs in the background**: closing the window keeps the bot in the tray / menu bar so daily re-pricing and price alerts keep working (Settings → Desktop app to change; "Start when I log in" too).
- **AI inventory advisor** (Ask tab, Home): sell / hold / list / drop price / grade / buy-more plan from what you actually own, movers and the market.
- **Find prices** for imported or hand-added cards: links each one to its sales page (automatic when the match is clear) so it gets valued every day.
- **Want list**: cards you're hunting with a max price — flagged 🎯 in Quick price, reports, lot evaluations; "Scan eBay for deals on these".
- **Trade evaluator** (Card Lookup → ⚖ Trade): my cards vs. theirs, sold values per grade, who comes out ahead.
- **Needs attention** on Home: stale listings with a one-click suggested price drop, unlisted stock, value drops, unpriced and stale values.
- **Year / tax summary**: year selector on Sales & profit and a tax CSV (every sale and expense with totals).
- **PSA photo compare**: PSA's own photos of the cert next to your slab (report and cert checker).
- **Save report as PDF** (desktop app; browsers use Print → Save as PDF).

**Niche**
- Search everything with Ctrl/⌘ + K · duplicate detection when adding a card · fix a misread card in a lot and re-price it without AI ·
  watchlist sparklines · hover tooltips on price charts · "stale" value badge with per-row re-value · error toasts with Try again ·
  window remembers size/position/zoom · "research is still running — quit anyway?" · first-run welcome checklist.

## 3.1.0 — real desktop app
- **Card Research Bot is now a desktop app**: its own window, Desktop / Start-menu / Dock icon, no browser tab and
  no black console window. Windows installer (`.exe`) and Mac disk image (`.dmg`, Apple Silicon + Intel).
- Your data and settings now live in your user folder (Windows `%APPDATA%\Card Research Bot`, Mac
  `~/Library/Application Support/Card Research Bot`), so installing a new version keeps everything.
  **Settings → Open data folder** shows it.
- Links open in your normal browser; Help menu has "Open data folder" and "Releases".
- Both apps are built and smoke-tested automatically on GitHub for every release.
- The 3.0.1 zip downloads and their start scripts are retired — the installers replace them.

## 3.0.1 — one-click downloads
- Separate **Windows** and **Mac** downloads on GitHub Releases, each with Node.js built in — nothing to install,
  just unzip and double-click. The Mac download runs on both Apple Silicon and Intel Macs (macOS 11+).
- Launchers use the built-in Node.js when it's there and fall back to an installed one (for git clones).

## 3.0.0 — the 20-20 update

**Big new things**
- **Home dashboard**: inventory value, profit, alerts, hottest cards, movers, recent lookups and who did what.
- **Lot / binder-page evaluator**: one photo of many cards → each card priced, total value, and an offer verdict for the asking price.
- **eBay deal finder**: live listings well under the card's recent sold value (free eBay developer keys).
- **PSA slab check**: the cert number on the slab is verified with PSA, with population by grade (free PSA token).
- **Listing writer**: eBay/TCGplayer/Whatnot title, description, item specifics and pricing in one click.
- **Business tools**: inventory statuses (in stock / listed / at grading / sold), SKUs, storage locations, printable labels,
  CSV import, grading submission tracker (PSA progress checks itself), sales & profit analytics, expenses.
- **Portfolio value chart** over time.
- **Set browser**: every card in a set, sorted by value, with rookies filter.
- **Centering tool** to measure left/right and top/bottom centering from a photo.
- **Phone mode**: camera button, add-to-home-screen, phone-friendly layout (use with home-network sharing).
- **Self-test** in Settings to prove everything works with your key.
- **Pokémon, hockey and soccer** support.
- **Which grading company** pays best for a 10 on this card.
- **Backup AI model** used automatically when the main one is out of free quota.
- **Optional morning brief**: today's hottest cards, scanned automatically.

**Smaller things**
- Quick price → watch / add to inventory / find deals without using AI.
- "You already own this" banner. Liquidity and days-to-sell. Buy-the-dip / at-peak badges on the watchlist.
- Blurry/dark photo warnings, rotate and re-read buttons, same photo reuses its identification (saves quota).
- Hot list shows NEW / ↑↓ vs the previous scan and one-click watch.
- Undo instead of "are you sure?", light/dark toggle, keyboard shortcuts (press ?), who-is-using-this name.
- Crash-safe saves, automatic daily backups (14 kept), log file + "copy diagnostics", security headers,
  automatic port if 3737 is busy, stricter input checks.

## 2.0.0
- Switched the AI to Google Gemini (free tier). Inventory, price alerts, charts, calculators, batch mode, sharing with PIN.

## 1.0.0
- First version: photo → card ID → recent sold prices → buy/sell/grade report; hottest cards; watchlist; ask.
