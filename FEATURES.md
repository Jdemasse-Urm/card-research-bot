# Card Research Bot — every feature and service

The desktop app for the card business (Windows + Mac). Everything below is in the app today. Version numbers
say when it arrived; `CHANGELOG.md` has the details per version. The website it feeds is the MJC site
(repo `UR-MORTGAGE/mcj`, whose own list is in that repo's `FEATURES.md`).

**Live store:** https://main.dsq06359z2wce.amplifyapp.com (since Nov 5, 2026, in the UR Mortgage AWS account until the MJC
account exists) · **Investor demo:** https://main.d2p7srpg832hvo.amplifyapp.com · **Downloads:** https://github.com/Jdemasse-Urm/card-research-bot/releases

## Researching cards

| Feature | What it does | Since |
|---|---|---|
| Photo → card ID → report | Drop or snap a card photo (front + back), get the card identified, recent sold prices, grading math and a buy/sell/grade verdict | 1.0 |
| Text lookup | Type a card name instead of a photo | 1.0 |
| Batch mode | Several photos = several different cards in one go | 2.0 |
| Quick price (no AI) | Free sold-price lookup from SportsCardsPro / PriceCharting | 3.0 |
| Price search through the sites' API | Since the price sites put a robot check on their search pages (late Oct 2026), search goes through their official API ($6/month each) with a token in Settings; card pages, sales and set pages are read as before | 3.14.2 |
| Set browser | Every card in a set sorted by value, rookies filter | 3.0 |
| Hottest cards | Today / week / month per category; one targeted Google search per category; each card checked against its own sold prices (✓ backed / no data / not backed, ranked in that order, with the numbers + chart); sources per card; you own / wanted / watching; flip or sell-into prices; alert when a card you own shows up; streaks + a scoreboard of past calls; without search a list from your own tracked moves; Deals / Price / Research / hide; Ask about the list; copy as text | 1.0 / 3.0 / 3.17 |
| Ask | Any market question with Google-searched sources; follow-ups about a specific card | 1.0 |
| Ask about my business | Questions about your own sales, stock, expenses and customers — the AI picks what to count, the app counts your records | 3.12 |
| Lot / binder-page evaluator | One photo of many cards → each priced, total value, offer verdict for an asking price; fix a misread card and re-price without AI | 3.0 / 3.2 |
| Trade evaluator | My cards vs theirs, sold values per grade, who comes out ahead | 3.2 |
| PSA slab check | Cert number read off the slab and verified with PSA, population by grade, PSA's own photos next to yours | 3.0 / 3.2 |
| Centering tool | Measure left/right and top/bottom centering on a photo; from the card editor it fills in the card's condition | 3.0 / 3.10 |
| Checklist check | Every lookup and scanned card checked against the set's checklist: a misread number or a parallel the set never had is flagged; ✓ when it matches | 3.10 |
| Listing writer | eBay / TCGplayer / Whatnot title, description, item specifics and pricing | 3.0 |
| Which grader pays best | Which grading company's 10 is worth the most for this card | 3.0 |
| eBay deal finder | Live listings well under the card's recent sold value (free eBay keys) | 3.0 |
| Want list | Cards you're hunting with a max price, flagged 🎯 everywhere, "scan eBay for deals on these" | 3.2 |
| Photo re-use | The same photo again re-uses its identification and price-page match (saves free-tier quota) | 3.0 / 3.4 |
| Blurry/dark photo warnings, rotate, re-read | — | 3.0 |
| Save report as PDF | Desktop app | 3.2 |
| Pokémon, hockey, soccer | Plus baseball, basketball, football, Yu-Gi-Oh, One Piece | 3.0 |

## AI (Google Gemini)

| Feature | What it does | Since |
|---|---|---|
| Gemini, free tier | The app's AI; one key in Settings; backup models used automatically when the main one is out of quota or overloaded; a backup's card read is marked for a check by eye | 2.0 / 3.0 / 3.17.2 |
| Monthly spending cap | Stops AI calls at a dollar amount you set | 2.0 |
| Self-test | Proves prices, the key, Google Search and a full lookup work (~1 min) | 3.0 |
| AI inventory advisor | Sell / hold / list / drop price / grade / buy-more plan from what you actually own | 3.2 |
| Morning brief | Optional: today's hottest cards scanned automatically each morning | 3.0 |
| Call gate + deadlines | At most 2 AI calls at once, every call has a time limit, 429s wait exactly as long as Google asks | 3.4 |
| Fast lane | Simple steps (matching, listing writing) run at low thinking effort — quicker and cheaper | 3.4 |
| Research runs in parallel | Google research starts alongside the sold-price search; lookups finish sooner | 3.4 |
| AI performance panel | Calls, failures, time-outs, average/slowest times, backup-model switches (today + 7 days) | 3.4 |
| Read a receipt | Photograph a receipt → date, total, category and what was bought, for you to check; duplicates flagged | 3.6 |

## Inventory and the business

| Feature | What it does | Since |
|---|---|---|
| Inventory | In stock / listed / at grading / sold; SKUs, storage locations, tags, cost basis, value, CSV import/export | 2.0 / 3.0 |
| Duplicate detection | Adding a card you already have offers to add to its quantity | 3.2 |
| Find prices | Links imported/hand-added cards to their sales pages so they get valued daily | 3.2 |
| Daily re-value | Every card with a sales page is re-valued daily; value history per card with a trend line; "your cards' biggest moves" | 3.0 / 3.6 |
| Sold dialog | Sell some or all of a stack, how they paid, profit after fees as you type | 3.0 / 3.6 |
| Show mode | A register for card shows: scan a label or type a card, set prices, tap the payment type, complete sale; totals by payment, Undo, copy the day's summary | 3.6 |
| Barcode labels | Code 128 barcode of the SKU on every label; letter sheet (3 across) or 2.25" × 1.25" thermal roll; any USB/Bluetooth scanner works (Show mode, Stock search) | 3.0 / 3.6 |
| Grading tracker | Submissions (cards not yet in inventory too), PSA progress hourly with a progress bar, each stage and its days, due date from the service's turnaround + overdue mark, tracking link, notifications (grades ready / shipped / problem), grades + cost basis when they return | 3.0 / 3.16 |
| Cards are back by barcode | Scan each slab: PSA's record fills the grade, matches the card, keeps cert + label (qualifiers, auto grade) + ✓ matches PSA; what grading added per submission and a grading history per service | 3.16 |
| Submission prep | The list for PSA's form (year, set, #, player, variety, declared value = expected graded value, "if it's a 10"), the cheapest open service that covers every card, printable packing list + CSV | 3.16 |
| Pre-grade photo check | Each card's photos judged the way a grader would (centering, corners, edges, surface, worst flaw) before sending; re-ranks What to grade next | 3.16 |
| What to grade next | Raw cards ranked by what grading adds after fees (sold value per grade × odds from condition + centering) → a submission | 3.12 |
| Sales & profit | Revenue, fees, profit, ROI, days to sell, best/worst flips, by month and category; year selector; tax CSV (every sale and expense with totals) | 3.0 / 3.2 |
| Expenses | Supplies, shipping, grading, show tables, fees, travel, software; receipt photos (see AI) | 3.0 / 3.6 |
| Portfolio value chart | Daily snapshots of what the stock is worth | 3.0 |
| Needs attention | Stale listings with a one-click price drop, unlisted stock, value drops, unpriced/stale values, backup health | 3.2 / 3.6 |
| Home dashboard | Inventory value, profit, "This week" (sales, profit after fees, best flip, cards added, website orders/offers/messages/visits), alerts, hottest cards, movers, recent lookups, who did what | 3.0 / 3.6 |
| Watchlist | Price alerts, biggest movers (24h / 7d / 30d), buy-the-dip / at-peak badges, sparklines | 2.0 / 3.2 |
| Search everything | Ctrl/⌘ + K across inventory, reports, watchlist, want list | 3.2 |
| Big inventories | Stock draws 150 rows at a time; at 10,000 cards a list opens in milliseconds and an edit takes ~30 ms (histories kept in their own files) | 3.6 / 3.8 |
| Bulk scan | A folder of scans, files, a webcam/document camera, or your phone (QR code) → every card found, then each cut out at full resolution and read up close (year, set, player, number, parallel/refractor, serial, RC, auto, relic, grade, cert), checked against the set's checklist, priced; backs paired by position and read too; review with "check by eye" flags, a big front/back view and field-by-field fixes; set box + lot cost (or the box it came out of), add all with front + back photos and card facts; resumes without paying twice | 3.8 / 3.9 / 3.10 |
| Reader accuracy + learning | Every fix you make is remembered: accuracy per field (number, parallel, player, grade) and the most repeated mistakes told to the reader before each scan | 3.10 |
| Phone as scanner | 📱 Phone shows a QR code; the phone's pictures (front + back mode, on by default) land in Bulk scan on the computer — needs Share on home network; ⏭ No back (a slab) reads a front right away | 3.10 / 3.18 |
| iPhone multi-card scanning | Full-resolution pictures (up to 4096 px) through a send queue that survives a Wi-Fi drop; read on the computer whatever screen is open (each picture claimed once); the phone shows per picture how many cards were found, which need a retake (glare, blurry, cut off — by "row 2, card 3") and each card's name and value; front/back card-count check; session totals, "same page twice?", undo the last picture, too-dark/blurry check before sending, optional sound | 3.15 |
| Scanner you can trust (3.19) | **Sessions end by themselves** after 4 hours without a picture. **🆕 New session** says it clears the phone's list only and never drops an unsent picture. **When the reader is down** (Google credit, a limit, an overload), the phone says so once, pictures wait as "⏸ waiting for the reader", and the computer retries every minute by itself. **A picture is never lost through a restart**: one taken but not read goes back in the inbox. **The same slab is never added twice**: a PSA cert already in stock is unticked, refused on Add, and shown on the phone as "already in inventory (CRB-…)". A picture of only a card's back is unticked. **The phone shows "✓ in inventory CRB-…"** once the computer adds a picture's cards. **Faster sending**: the camera's own JPEG goes as it is, about 2.7× less phone work and about a fifth less to upload, and sending resumes as soon as you're back from the camera. | 3.19 |
| Second look + full details | Unsure or checklist-flagged cards are read again, choosing from the set's real list of versions; every raw card gets condition (NM–DMG, corners, edges, surface), centering and PSA 10/9 odds as a photo estimate, saved on the row ("What to grade next" uses it); finding and reading run side by side | 3.15 |
| Card facts | Year, set, player, team, number, parallel, serial, rookie/auto/relic, cert on every card — filled by bulk scan, editable, shown on the website | 3.10 |
| Condition report | Raw cards: Near Mint / Lightly Played / Moderately Played / Heavily Played / Damaged + centering (measured on the photo), corners, edges, surface, notes; bulk set; shown on the website | 3.10 |
| Sealed product | Boxes, blasters, packs, cases with UPC; 📦 Opened spreads a box's cost over what came out; Sales shows whether opening boxes pays | 3.10 |
| Tilt video | 3 seconds recorded with the camera (or a file) per card — refractor shine and surface — sent to the website | 3.10 |
| PSA population watch | Your PSA slabs re-checked a batch a day; an alert when the count at your grade grows 10%+; the same check verifies each slab against PSA's record (✓ / alert); population + higher on the row; PSA's own photos in a slab's editor | 3.10 / 3.16 |
| PSA slabs by barcode | Scan a slab's cert barcode → PSA's exact card + grade, priced, ready to add; a cert read off a scanned slab is cross-checked with PSA (grade mismatch flagged, PSA's used) | 3.8 / 3.9 |
| Bulk edit + Undo | Location, status, category, grade, tags, cost, listing for any number of cards; select all matching, shift-click, whole groups; Undo for a week | 3.8 |
| Merge / split lot cost | The same card on several rows → one row (qty, averaged cost); spread what a lot cost over its cards by value | 3.8 |
| Locations + stock count | Every box/binder with cards, value, last count; scan a box's labels → found / missing / belongs elsewhere; rename a box | 3.8 |
| Data check | Duplicate SKUs, duplicate rows, sold-but-on-website, missing sold/list prices, grading without a submission, cost typos, website cards without photos, unpriced cards — one-click fixes and a daily alert | 3.8 |
| Views | Quick views (no sales page, stale, on website, listed 30+ days, no location, never counted, no photo), saved views shared by both computers, group by with subtotals, compact rows, 30-day trend sort, CSV of the current view | 3.8 |
| Change history | Who changed what on each card, when; value-over-time line in the editor | 3.8 |

## The Shop tab — customers and services

| Feature | What it does | Since |
|---|---|---|
| Customer book | Everyone who buys, sells, consigns or grades with you; website buyers added automatically; full history per customer; "collects" words → an alert when matching cards come in + a ready email | 3.11 |
| Store credit | Give it (trade-ins, refunds, gift cards), spend it as a payment in Show mode or the Sold dialog; never below zero; a log per customer | 3.11 |
| Consignment | Other people's cards sold for a commission (shop default or per customer), never under their minimum; payout worked out on every sale; pay in one click; printable statement | 3.11 |
| Grading service | Customers' cards taken in, a printed receipt, sent with your submissions — progress at PSA follows; your price list per service | 3.11 |
| Card shows | Calendar (public ones on the website), table checklist, pull list by box, sales filed under the show, profit per show, cash drawer count | 3.11 |
| Helper PIN | A second PIN for someone at your table: Show mode only, no costs, no settings | 3.11 |
| Supplies | On hand, used per website order / per card sold, reorder alerts, restock files the expense | 3.11 |
| Books & taxes | Sales by channel, fees, cost of cards, expenses, net; inventory at cost Jan 1 / Dec 31 (COGS); sales tax collected + due on in-person sales; 1099-K check per site; year-end report + CSVs | 3.12 |
| Sales from other sites | eBay orders report / Whatnot / TCGplayer sales file → matched by SKU or title → marked sold with that site's fees, off the website; re-importing is harmless | 3.12 |
| Listing file | Every field eBay / Whatnot ask for, one row per selected card, for their bulk-listing templates | 3.12 |
| Insurance schedule | Cards over an amount with photo, cert, location, cost, value — printed for the insurer | 3.12 |
| Live stream | Queue, card on screen, sold to @buyer (Whatnot fees, buyer in the customer book), OBS overlay page, recap by buyer | 3.12 |
| Packing | Pick list by box for orders to ship, packing advice (insure / signature / mailer), packing slips with a tracking QR code | 3.12 |
| Weekly report | Last week's numbers + what needs doing; Monday alert; copy or email | 3.12 |

## The MJC website connection

| Feature | What it does | Since |
|---|---|---|
| Sell on MJC | A switch per card (and bulk) puts it on the website with photos and an optional AI description; off = taken down; says the price the engine set and that it's up — or why it can't go up; Bulk scan can add + sell in one step (⚠ cards wait until checked); WNBA cards go to the website's WNBA section | 3.3 / 3.18 |
| Photos | Up to 8 per card, ★ front, resized on upload, a small copy for the shop grid | 3.3 / 3.5 |
| Daily pricing engine | Price from that exact grade's recent sold comps, your cost, liquidity and days listed; guardrails (never under cost + margin, ±5%/day, no churn); every change logged with its reason | 3.3 |
| Learns from your sales | After 10 site sales a model learns your buyers' price sensitivity; health-checked daily (holdout vs the simple rules, calibration) and only steers prices when it passes | 3.3 / 3.4 |
| Feed-down day | If the price site can't be read, prices hold, one alert, hourly retry; a 40%+ overnight jump waits a day to be confirmed | 3.4 |
| Orders → inventory | Paid website orders arrive as alerts, the card is marked sold with Stripe's fee; tracking entered here shows on the site; "Email tracking" drafts the shipping email | 3.3 / 3.7 |
| Messages inbox | Pip hand-offs, offers (Accept = set the price + email the buyer; Counter), sell-or-trade requests with photos, card requests (→ want list) | 3.3 / 3.5 |
| Website conversations | Reply in the app → the shopper sees it on their page / in Pip's chat (and by email); their replies + answers alert you; 30-second checks while a conversation is going | 3.13 |
| Trade-in offers | Cash and/or credit offer on a sell request → they accept on their page → one click gives the credit | 3.13 |
| Reviews + Pip's questions | Reply to reviews (hide only spam/abuse/personal details); the questions Pip couldn't answer, to add to Setup | 3.13 |
| Order checks | Orders over your amount wait for "Checked — OK to ship"; shipped / delivered email the buyer | 3.13 |
| Drops | "Goes live at" per card or in bulk — hidden on the site until then; the email list is told when it drops | 3.13 / 3.13.1 |
| Status pages + credit codes | Consignor statements and grading orders kept up to date on the website; each customer's online credit code | 3.13 |
| Store setup | Name, support email, shipping charge + free-shipping threshold, shipping/returns/policies text, "About the shop"; checkout on/off | 3.3 / 3.5 |
| Owner's switches | Local pickup (+ note), promo codes, Stripe Tax, show/hide the demo parts of the site, email list on/off, social links | 3.7 |
| Email list | Count + CSV download of the site's sign-ups; remove an address | 3.7 |
| Website numbers | Visits and card views this week, Pip chats, store software version — on Home and in MJC store | 3.4 / 3.7 |
| Privacy | Cost, notes, locations and SKUs never leave the computer; only public card facts go to the site | 3.3 |

## The desktop app itself

| Feature | What it does | Since |
|---|---|---|
| Windows installer + Mac disk image | Built and smoke-tested on GitHub for every release (Mac on Intel runners) | 3.1 |
| Data in your user folder | Installing a new version keeps everything; Settings → Open data folder | 3.1 |
| Update checker → one-click update | Downloads the new installer, checks it against GitHub's SHA-256, installs; "What's new" shown first | 3.2 / 3.6 |
| Automatic updates | Every 6 h: a new release downloads + is checksum-checked in the background, installs when the computer has been idle 10 min and no research is running (Windows silent install; Mac swaps the app in place, no dragging); "updated" notification; switch in Settings; the release build tests both installs | 3.14 |
| Runs in the background | Tray / menu bar icon; start at login; daily re-pricing and alerts keep working | 3.2 |
| Pop-up notifications | Website orders, offers/messages, price targets, pricing problems — click to open; choose which kinds; Mac Dock badge, Windows taskbar flash | 3.6 |
| Tray menu | Open, Show mode, Website orders & messages, Check for updates, Quit | 3.6 |
| Backups | Automatic daily (14 kept) + a copy to OneDrive / iCloud Drive / Dropbox / Google Drive; Back up now; download/restore everything in one file | 3.0 / 3.6 |
| Share on the home network | A phone or another screen on the same Wi-Fi opens this computer's bot (PIN-protected) | 2.0 |
| Shared inventory | Both computers (Joseph's PC, Dad's Mac), each running its own bot, work on ONE set of cards, sales, customers, expenses, shows and research — from anywhere; invite code to join; three-way merge (nothing lost when both edit); each keeps a full copy + backups; photos both ways; daily jobs on one computer with automatic takeover; the shared copy is private in the MJC store's storage (store 1.2.0) | 3.19 |
| Phone mode | Camera button, add-to-home-screen layout | 3.0 |
| Keyboard shortcuts | `/` search · Ctrl/⌘+Enter research · Esc cancel · 1–8 tabs · `?` list | 3.0 |
| Light / dark mode, who-is-using-this name, activity feed | — | 3.0 |
| Crash-safe saves, log file + copy diagnostics, security headers, cross-site request blocking | — | 3.0 |
| Daily update email | `scripts/daily-update-email.mjs` emails a plain-English summary of the day's work (via the Salesforce email action) | 3.7 |
