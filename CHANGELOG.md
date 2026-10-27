# Changelog

## 3.10.0 — a scan you can trust, condition reports, sealed boxes

- **Checked against the set's checklist**: every scanned card (and every Card Lookup) is checked against the price
  site's checklist for that set and number. A misread number is caught ("#138 in 2023 Panini Prizm is Seth Lundy,
  not Victor Wembanyama"), and so is a parallel the set never had ("no Gold Vinyl version of #136 — listed: Silver,
  Gold Sparkle, Red Ice…"). Cards that match get ✓ checklist. When the set or number can't be found there's no
  verdict — never a false alarm.
- **Fix a card field by field**: ✎ fix (or click the picture) opens the card big with its year, set, player,
  number, parallel, serial and grade as boxes, and the checklist's versions of that card as buttons to pick from.
  Saving rebuilds the name and re-prices it.
- **The reader learns from your fixes**: every correction is remembered. Bulk scan shows the reader's accuracy
  per field (number, parallel, player, grade), and before each scan the reader is told the mistakes you've fixed
  most ("2023 Panini Prizm: parallel was read as base but it was Silver — 4 times") so it looks twice.
- **Your phone as the scanner**: 📱 Phone in Bulk scan shows a QR code; scan it with the phone (same Wi-Fi, with
  Share on home network on) and every picture you take lands in the scan on the computer. Front + back mode reads
  both sides of each card. Free, and the phone's camera is the best one you own.
- **Card facts on every card**: year, set, player, team, number, parallel, serial, rookie / auto / relic and cert
  are kept on each card (bulk scan fills them in; the editor shows them) — the website shows them too, for scanned
  cards as well as researched ones.
- **Condition report for raw cards**: one scale buyers know — Near Mint, Lightly Played, Moderately Played,
  Heavily Played, Damaged — with centering (📐 measures it on the front photo), corners, edges, surface and notes.
  Bulk edit sets the condition for many cards at once; a quick view lists raw cards with no condition yet.
- **Sealed product**: hobby boxes, blasters, packs, cases with their UPC (a barcode scanner finds them in Stock).
  📦 Opened: one box leaves stock and its cost is spread over the cards that came out — scan them (Bulk scan picks
  the box) or tick cards already added. Sales & profit shows every box opened: cost vs what came out, sold or still
  in stock — whether opening boxes pays.
- **Tilt video**: record 3 seconds with the camera (or choose a video) on any card — shows refractor shine and the
  surface. It goes to the website with the photos.
- **PSA population watch**: your PSA slabs are re-checked a batch a day; when the count at your grade grows 10%
  (at least 3 more), you get an alert — more copies usually pull the price down. The editor shows the latest count.

## 3.9.0 — bulk scan reads every card up close

- **Find, then read up close**: a scan is now two steps. A quick pass finds every card in each picture; then each
  card is cut out at full resolution and read on its own at high image detail. Before, a whole page went in at
  once, so each card got a fraction of the picture and small print — card numbers, serial stamps, the word
  "Refractor" — could be missed.
- **Backs too**: scan the fronts, flip every card over where it lies, scan again — each back is matched to its
  front by position (left↔right or top↕bottom flips both work) and read with it. Backs carry the card number,
  year and set. Each card keeps its back as its second photo.
- **Every detail, as its own field**: year, set, player/character, card number, parallel/refractor, stamped
  serial (23/99), rookie, autograph, relic, grading company + grade, cert — the same fields a single-card lookup
  uses. The name is built from them; RC / auto / relic / numbered / the parallel become tags.
- **No guessing**: a raw card never gets a grade; a parallel is named only when the picture shows it, otherwise
  the card is flagged with exactly what to check ("Silver Prizm or base? Tilt it under a light"). Flagged cards
  count as "to check" and can be unticked in one click.
- **PSA cross-check**: a PSA cert read off a slab is checked against PSA's record (with the free PSA token); if
  the label was read as PSA 9 but PSA says 8, the card is flagged and PSA's grade is used. ✓ PSA shows on cards
  that match.
- Click a card's picture to see the front and back big with everything that was read.
- AI calls for close reads ask Gemini for high image detail (dropped automatically if a model refuses it).

## 3.8.0 — the inventory 10-10: scan the stack, organise it, and keep it fast

**Major**
- **📥 Bulk scan** (Inventory): choose a folder of scans (or files, or use a webcam / document camera) and every
  card in every picture is found, cut out as its own photo, slab cert numbers read, and priced from recent
  sales — up to 10 files per AI call. Check the list (unsure cards flagged, "have 2" when you already own it),
  set the box and what you paid, and add them all at once. Pause, a quota stop or closing the app never pays
  for the same file twice (what each file held is kept for a month). Duplex scanners: backs are paired as
  each card's second photo.
- **PSA slabs by barcode**: scan the cert barcode into Bulk scan → PSA's record gives the exact card and grade
  (with the free PSA token). Slabs in a scanned picture are checked against PSA the same way.
- **✎ Edit selected**: change location, status, category, grade, tags, cost, listing for any number of cards in
  one step — with **Undo** (kept a week). Selection survives filters and "Show more"; "Select all N matching",
  shift-click ranges, select a whole group.
- **📍 Locations**: every box and binder with its cards, value and last count; open, rename, or **count** it.
- **🔢 Stock count**: scan every label in a box → what's there, what's missing, what belongs elsewhere (and
  cards scanned that are marked sold); apply moves the strays and can mark the missing ones "Not found".
- **🩺 Data check**: duplicate SKUs, the same card on several rows, sold cards still on the website, sold without
  a price, listed without a price, "at grading" without a submission, cost typos, website cards without a
  photo, cards with no sales page — with one-click fixes, and a daily alert when something serious appears.
- **Speed at 10,000 cards** (measured): the inventory file went from 104 MB to 4 MB; opening Stock reads it in
  14 ms (was 387 ms) and the list sent to the screen is 5.8 MB (was 56 MB); an edit takes 31 ms (was 893 ms);
  adding 1,000 cards takes 44 ms (was ~3 s). Value and price history moved to their own file; edits log to a
  small change file.

**Niche**
- ⇉ **Merge** the same card kept on several rows into one (quantities added, cost averaged, Undo).
- ÷ **Split lot cost** over the selected cards by value.
- **Change history** in every card's editor (who changed what, when) and a value-over-time line.
- **Quick views**: no sales page, stale value, on the website, listed 30+ days, no location, never counted, no
  photo — with counts. **Saved views** shared by every computer.
- **Group by** location / category / status / grade with subtotals; **Compact** rows; sort by 30-day trend
  (▲/▼ % next to each value) or location.
- **⬇ CSV** exports the selection or the current view, not just everything.
- Keyboard: **N** add a card, **E** edit the selected cards, **F** search, **Esc** clear the selection.
- "Sell on MJC" for many cards is one request and one pricing run (it was one per card).
- Fix: cards added after 8 pm got tomorrow's date (the date was taken in UTC); sales recorded today were left
  out of the website price before noon.
- Mac: the camera permission text is set, so the camera works on a Mac.

## 3.7.0 — the website's new controls, in the app
- **Setup switches for the website**: local pickup (with a note), promo codes, Stripe Tax, show/hide the demo
  parts of the site, the email list on/off, and your Instagram / eBay / Facebook / Whatnot / TikTok / YouTube
  links. Changes reach the site within a minute — no programmer needed.
- **Email list**: how many shoppers signed up for new-arrival and price-drop emails, a CSV download for your
  email program, and "Remove an address" when someone asks to stop.
- **Website numbers**: visits and card views this week, Pip chats, and the store software's version — on Home
  ("This week") and in MJC store.
- **Orders**: local-pickup orders are flagged, the customer's note and phone number show, promo discounts and
  tax are listed, and **✉ Email tracking** drafts the shipping email with the tracking number and track link.
- **Daily update email**: `scripts/daily-update-email.mjs` emails a plain-English summary of the day's work on
  the app and the website (runs at 5 pm from Joseph's computer; skips quiet days).
- Fix: "🎯 Want" in Quick price used a browser prompt that silently does nothing in the desktop app — it's a
  small dialog now.

## 3.6.1
- Fix: after updating from an older version, Home said "No backup in a while" even though the daily backups were
  there (the new backup status only started recording on the next backup). It now reads the newest backup file.

## 3.6.0 — the third 10-10: run the business from it

**Major**
- **One-click updates** (desktop app): "Update now" downloads the new installer from GitHub, checks it against
  GitHub's SHA-256 checksum, and installs it — Windows closes and reopens on the new version; on a Mac the
  installer window opens for the usual drag to Applications. No browser, no hunting for the right file.
- **Pop-up notifications** for website orders, offers, sell-to-us requests and messages, watchlist price targets
  and pricing problems — with the alert's own words, even when the window is closed to the tray. Clicking one
  opens the screen that deals with it. Choose which kinds in Settings → Desktop app.
- **Show mode** (Inventory → 🏪 Show mode): a register for card shows. Scan a label (or type a name / SKU),
  set prices, tap how they paid (Cash, Card, Venmo, PayPal…), Complete sale. Today's total by payment type,
  Undo the last sale, and "Copy today's summary" for a text or email.
- **Sell part of a stack**: the Sold dialog asks how many — the rest stay in stock with their own row. Show mode
  and website orders use the same path, so a stack is never marked sold by accident.
- **Backups to your cloud folder**: pick OneDrive, iCloud Drive, Dropbox or Google Drive in Settings and every
  daily backup is copied there too (last 30 kept). Settings shows when the last backup and copy ran; Home warns
  when backups stop or the copy fails. "Back up now" any time.
- **Value history per card**: every daily re-value is recorded. Stock shows a small trend line per card, and Home
  shows **your cards' biggest moves** this week (up and down, in dollars).
- **Read a receipt** (Expenses → 📷): take a photo of a receipt and the AI fills in the date, total, category and
  what was bought, for you to check and save.
- **This week** on Home: cards sold, sales, profit after fees, best flip, cards added, expenses, and website
  orders / offers / messages.
- **Barcode labels**: printed labels carry a scannable barcode of the SKU. Any USB or Bluetooth barcode scanner
  works — scan into Show mode to sell, or into the Stock search to open that card.
- **Big inventories stay fast**: Stock draws 150 rows at a time with "Show more" / "Show all".

**Niche**
- Sold dialog: how they paid, and the profit after fees updates as you type (same fee table as Sales & profit).
- Show mode: a card with several copies lets you pick the quantity; a card sold elsewhere a moment ago is skipped.
- Update banner: "What's new" for the new version before you install it.
- Mac: the Dock icon shows how many alerts are waiting. Windows: the taskbar button flashes on a new order.
- Tray menu: Show mode, Website orders & messages, Check for updates; the tray tooltip counts new alerts.
- Labels: choose a letter sheet (3 across) or a 2.25" × 1.25" thermal roll label (Dymo / Rollo / Zebra).
- Receipts: the same receipt photographed twice is flagged before it's logged again.
- Home alerts read correctly for website orders, messages and pricing notices (they showed "→ $—").
- A scanned SKU in the Stock search opens that card.
- The "payment" of every sale is kept and included in backups.

## 3.5.0 — the MJC store's new services, in your inbox

- **Offers**: shoppers can make an offer on any website card. It arrives in Inventory → MJC store →
  Messages with the amount and the list price. **Accept** sets that card's website price to the offer and
  opens an email to the buyer with the link; **Counter** opens a ready-to-edit reply.
- **Sell or trade to us**: shoppers send a description, how many cards, an asking price and up to 4 photos.
  The photos are copied to this computer and shown in Messages (they're never public on the site).
- **Card requests**: "find me this card" requests arrive in Messages; **Add to want list** puts them on your
  want list with the shopper's max price.
- **About the shop** (MJC store → Setup): your own words for the website's front page, its policies page
  and Pip. Shipping, returns and policy text now keep their paragraphs.
- **Faster website photos**: each listing photo also gets a small copy for the shop grid (the full photo
  still shows on the card page).
- Alerts name what came in ("Offer of $230 on …", "Cards to sell or trade to you", "Card request").

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
