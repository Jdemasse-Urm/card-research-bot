# Changelog

## 3.23.0 — Upload (Camera or Photos), whose phone, and straight to the computer through Tailscale

11/15, the first cards through the phone from anywhere came from Joseph's dad, and Joseph took them for his own:
"make sure you can differentiate between the two". Dad: "can we have it just read the front pic? Also can we have
the option to take a pic or go to photo library?", then: no front / front + back toggle at all, "it should just be
'upload' and then it should have us select either camera or photos". Joseph: Tailscale is already on his PC, "hook it
up so I can do this all from my phone". (3.22.0 was never released; its phone page was on the store for a few minutes.)
- **Upload.** The gold button says Upload. It opens two choices: **Camera** (take a picture now) or **Photos** (pick
  from the library, as many as you like). Every picture is read on its own: one per card, or a whole binder page.
  There is no Front / Front + back toggle any more, and no "No back". A slab's label names the card, and a raw card's
  number comes from the set's checklist when the player has one number in that set. A front an older page took and
  never sent with its back goes as a single picture, so it's read at once. The computer still pairs fronts and backs
  sent by a phone that hasn't updated yet.
- **Whose phone.** Each phone asks once, "Whose phone is this?" (the welcome sheet, and Settings → Whose phone). The
  name goes with every picture and every ＋ Add, through the cloud or straight to the computer. On the computer:
  "📱 1 picture from Dad's phone", the card's note says "added from the phone (Dad)", "Added by" is Dad, and the
  activity says Dad added it. Needs store 1.4.0 for the cloud way; an older store just drops the name.
- **Straight to the computer, through Tailscale.** When the computer is on Tailscale and shares on the network,
  **📱 Phone** also shows a second code for this computer's Tailscale address. A phone with Tailscale on sends its
  pictures straight into Card Research Bot from anywhere, with nothing in between, and can open the whole bot at the
  same address (PIN). The cloud code stays the one that works for every phone, Tailscale or not. Nothing new runs: it
  is the home Wi-Fi way, at the address Tailscale gives the computer.
- **Why Dad's ＋ Add did nothing:** his Wembanyama slab carried the wrong "Splash… tilt it under a light" note, so
  the phone showed it as "Check on a computer", and ＋ Add skips those. 3.21.4's fixes (below, released in 3.23.0)
  stop that note on slabs.
- The phone's Settings still said pictures "wait in your store" in one place; now "your private cloud folder".

## 3.21.4 (released in 3.23.0) — the right set for an insert, no tilt warning on a slab, and sales dated the day they happened

Joseph's first card through the phone from anywhere (11/15, a PSA 10 2023 Donruss Optic Victor Wembanyama My House #6)
came in, was read right and priced from the right page ($140). But its set check said "#6 in 2023 Donruss Optic
Splash also comes as Holo — tilt the card under a light".
- **An insert is checked against its own set.** The price site lists every insert as a set of its own, all sharing
  card numbers: #6 is in My House, in Splash and in the base set (Luguentz Dort). The reader wrote "My House" in its
  price search but not in the set, and the closest-name tie went to Splash. The words the reader saw that the set
  name left out now decide it. Grade, grader and rookie words never do. Tested on the price site's real results.
- **No "tilt it under a light" on a graded slab.** PSA, BGS, SGC and CGC print the parallel on the label
  ("MY HOUSE-HOLO"), so a label read as the base is the base. Raw cards still get the check.
- **Sales, purchases, expenses and grading dates are the day here, not the UTC day.** They were stamped from the UTC
  clock, so after about 7 PM Detroit time a sale got tomorrow's date. Then the books counted it as still in stock
  that evening, and a sale on the evening of December 31 would have landed in the next tax year. Internal day keys
  (counters, backups) are unchanged. Found by the suite failing in the evening.

## 3.21.3 — the scanner says where pictures really go

Joseph, 11/15: "I don't want it to reach the store, I want it to reach the TCRB." It already did. But the
scanner's words ("pictures wait in your store", "Through your MJC store") read as the website. They now say what
happens: a picture goes straight into Card Research Bot, through a private folder in your MJC cloud that only your
computers can open. It never touches the website, and it's deleted from the cloud the moment Card Research Bot has
it. Cards reach the website only when you choose them in Card Research Bot, as always. Only words changed.

## 3.21.2 — a picture that won't upload says why, and Send now always works

Joseph, 11/15: a picture sat "waiting for a signal" and Send now wouldn't do anything. His phone was online: the store
answered its other calls (26 that hour from his cell connection). But the picture never reached the store's folder.
The same page uploads fine in Safari's engine and Chrome's on the PC, so the cause is on the phone, and the page hid it.
- **"No signal" only when there's no signal.** If the store is still answering, the problem is the upload itself, and
  the phone names it on the picture, in the pill at the top ("Upload trouble · 1 waiting — tap for details"), in
  Settings and in the picture's sheet.
- **The picture is read into memory before it goes.** A camera file kept in the phone's storage can fail to stream on
  iOS; a copy in memory doesn't. A picture the phone can't read back at all says "take it again" instead of waiting
  forever.
- **A second way to send:** if the watched upload (the one with the progress bar) fails, the picture goes once more
  the plain way.
- **Send now always works** (it was greyed out), and a waiting picture's sheet has **Try again now**.
- **The phone tells the store what went wrong** (store 1.3.1: one line in its log, nothing kept), so a problem on a
  phone can be fixed from the computer.

## 3.21.1 — the phone list never outgrows the phone; a security update

From an audit of speed, data growth and security (11/15):
- **The phone scanner's list always fits the phone.** An iPhone gives a web page about 5 MB. 3.21's bigger thumbnails
  meant a list near 150 pictures could fill it, and the save then failed silently, so the list could vanish on the
  next open. Now:
  - Thumbnails are smaller (about 15 KB).
  - If a save doesn't fit, the oldest pictures give up their thumbnails first, keeping their cards and status, and
    show a plain tile. Then the oldest pictures beyond the last 40 go.
  - History drops its oldest sessions first.
  - Checked by imitating the iPhone's limit: all 150 pictures were kept, and the newest 40 kept their thumbnails.
- **Security update:** body-parser 1.20.9 (via Express 4.22.3). It fixes a high-severity denial of service: a crafted
  compressed request could tie up the bot's server. `npm audit` now finds 0 issues in the bot, the store and the site.

## 3.21.0 — the Card Scanner, 20-20: an app with tabs

Joseph, 11/15: "a more advanced nicer smoother UI and UX … some tabs, some different page options". The phone page
was one long column. It's now an app with four tabs along the bottom: **Scan**, **Cards**, **History** and
**Settings**. Sending, reading and adding work exactly as in 3.20. Look: the TCRB ink and gold (light mode follows the
phone), rounded figures for money and counts, and one bold element, a refractor shutter ring.

### 20 major

1. **Four tabs** in a bar at the bottom, within reach of your thumb. The Cards tab carries a badge with how many cards are
   ready to add, or a red dot when a picture needs a retake.
2. **The Scan tab is built around the shutter.** It's a big gold button in a holographic ring. Above it is a switch
   between Front + back and One side, with a line saying what to shoot next ("Now flip #4 over and take its back").
3. **Connection pill** at the top: it says how pictures travel right now. For example "Joseph's PC is reading",
   "Sending #5 · 64%", "No signal · 3 waiting on this phone" or "No computer open · pictures wait in your store". Tap it
   for the connection settings.
4. **"Just read" card:** the newest picture goes from sending to reading to its best card's name, grade, value and
   status, without leaving the camera.
5. **Recent strip:** the last dozen pictures as thumbnails, each with a colour bar (reading, read, to check, retake).
6. **Cards tab:** every card read, one row each, with its picture, grade, value and where it stands. The statuses are
   ready to add, adding, in inventory, check on a computer, retake and already in stock.
7. **Filters with counts:** All, Ready to add, To check, In inventory.
8. **Search by name, and sort** by value or newest.
9. **＋ Add dock:** "＋ Add 7 cards · $372", with the Paid box. It shows what that comes to a card and against what
   they're worth ("$12.00 a card, worth $38.50 (+$26.50)").
10. **Pictures view** on the Cards tab: every picture with where it is, its number and a progress bar while it uploads.
11. **Real upload progress:** each picture's percentage, measured as it goes up (to the store, or to the computer on the
    home Wi-Fi).
12. **Picture sheet** that slides up from the bottom: the picture, its cards with their status and why, retake reasons,
    and the actions (＋ Add, Retake, Take it back). The buttons stay pinned at the bottom.
13. **Retake:** opens the camera, and the new picture stands in for the old one. The old picture's cards leave the totals
    and ＋ Add.
14. **History tab:** this session (cards, value, in inventory, pictures, cards a minute, reader cost, best three cards)
    and the sessions before it on this phone (the last 30), each with its cards.
15. **Share a session** through the iPhone share sheet: a plain list of cards, grades and values with the total, ready to
    text to your dad. Where sharing isn't possible, there's a copy box.
16. **The screen stays on while scanning**, so the phone doesn't lock in the middle of a binder. On by default; switch it
    off in Settings.
17. **Settings tab:** pictures per card, sound, screen on, send from the photo library, connection, theme, picture tips,
    how it works, new session, and forget past sessions.
18. **Waiting on this phone:** how many pictures haven't gone yet, with Send now.
19. **First open:** a short sheet with the four steps (Home Screen, shoot, watch them come back, add). It shows once and
    can be reopened from Settings.
20. **Theme:** Auto (follows the phone), Dark or Light. The phone's status-bar colour follows it.

### 20 niche

1. The phone's rounded typeface for money and counts, with fixed-width digits, so a value counting up doesn't jitter.
2. A fresh read's value counts up: the one animation, never for anyone whose phone asks for less motion. Fixed during
   testing: it showed a negative amount for one frame.
3. The shutter shows the next picture's number and side ("#5 back").
4. The shutter's ring spins while a picture is prepared, and it can't be double-tapped.
5. Undo #N and "No back for #N" sit on either side of the shutter, only when they apply.
6. The mini row under the shutter (cards, worth, ready to add) jumps to the Cards tab.
7. The tab bar, the top and the sheets keep clear of the iPhone's notch and home bar.
8. Touch targets of at least 44 points.
9. Screen readers get proper tabs (and arrow keys move between them), labelled buttons, and announced messages.
10. Sheets close by tapping outside them, with Escape, or with their own button.
11. A chime (two notes) when cards go into inventory, and a message with their inventory numbers.
12. The last tab, view, filter and sort are remembered.
13. New session and Forget past sessions take two taps: the first says what will happen.
14. Empty screens say what to do next.
15. The no-signal message shows once per dropped signal, not on every retry. "Back online" when it returns.
16. Grades look like a slab label (PSA 10 in a box); raw cards just say Raw.
17. Cards already in stock, and the inventory numbers of added ones, show on their rows.
18. Copy name in the picture sheet, for searching it elsewhere.
19. The reader's cost moved off the main screen into History.
20. Smoother: only what changed is redrawn (no flicker every 2 seconds), there's no tap flash or double-tap zoom, and the
    page doesn't bounce at the edges.

## 3.20.0 — scan from anywhere, add from the phone

Joseph, 11/15: "I should be able to scan in from any WiFi or even on the road with no WiFi", and his dad should see what
he scans. The shared inventory already reached every computer at any location. What didn't was the phone: it sent its
pictures straight to one computer, so it only worked on the same Wi-Fi as that computer.

- **The phone sends its pictures through your MJC store** (it needs store 1.3.0: `node api/deploy.mjs --profile mjc`).
  That works on any Wi-Fi or cell signal. With no signal at all, the page still opens from the phone, the pictures wait
  there, and they go up by themselves once there's a signal.
  - **Which computer reads them:** whichever of your computers has Card Research Bot open. The one running the daily
    jobs takes each picture first; another open one steps in after a minute. A picture is read once (the store
    hands it to one computer only), then deleted from the store. It's read exactly like a home-Wi-Fi picture.
  - **The phone shows** what each card is, what it's worth, and which computer is reading.
  - **No computer on:** the phone says so. The pictures wait safely in the store (up to a week) until a computer is
    open.
- **＋ Add on the phone.** Cards that read cleanly go into the shared inventory from the phone, so every computer sees
  them within seconds. There's an optional "Paid for these $" box, split by value.
  - **What stays for a computer:** ⚠ cards (an unsure read, a checklist doubt), a slab already in stock and the back of
    a card all wait for a check in Bulk scan. The phone shows how many.
  - **How it adds:** the computer that read the pictures adds them through the same Add as its button (in stock, no
    location, copies on one row). The website still changes only from a computer.
  - Phones on the home Wi-Fi (no store) can use ＋ Add too.
- **The 📱 Phone window** shows the store's link when the store is connected. Add it to the Home Screen once and it works
  everywhere.
  - **New link** is for a lost phone: every saved icon stops working.
  - The link only sends pictures, shows what was read and adds cards. It can't open costs, customers, settings or the
    website.
- The bot puts its own phone page on the store (the newest bot's version), so there's never a second copy to keep up.
- **The app keeps full speed when its window is closed to the tray.** That's where it is when you're on the road. Before,
  a hidden window slowed to about one check a minute, so phone pictures would have waited a minute or two each.
- **Fixed (3.19.1): "Got it" on the phone's Home Screen tip didn't hide it,** and opening the scanner from the icon showed
  an empty box.

## 3.19.1 — the phone scanner on your Home Screen

- **The phone scanner can go on the iPhone's Home Screen, so it opens without a QR code.** Scan the code once, then
  tap Share (on newer iPhones it's under ⋯) → Add to Home Screen. The **Card Scanner** icon opens the camera straight
  away whenever the phone is on the same Wi-Fi as the computer. The phone page says how the first time, and so does
  the computer's 📱 Phone window.
  - Why the code was needed every time: an app on the Home Screen keeps its own sign-in, apart from Safari's, so the
    sign-in the code gave Safari didn't carry over. Now the code lands on an address that signs the icon in by itself
    (`/phone?s=…`). A phone already on the old address (`/phone.html`) moves to the new one by itself.
  - That address only opens the camera page: it sends pictures, shows what was read, and can undo a picture. It can't
    open inventory, customers, costs or settings (those still ask for the PIN). It comes from the PIN, so changing the
    PIN retires every icon; scan the new code and add the icon again.
  - The icon goes to the computer's Wi-Fi address, which the 📱 Phone window shows. If the router ever gives the
    computer a new address, scan the code again and add the icon again.
  - Opening a used-up code on a phone that's already signed in now opens the scanner instead of "This code has
    expired".
- **A new Google key on the free plan gets the right explanation for Google Search.** On 11/12, a freshly made key's
  project was on Google's free plan. Search was refused on the main model, and the free plan's older search model
  answered "no longer available to new users". The self test said "The model gemini-3.8-flash wasn't found for this
  key", which named the wrong model and gave the wrong fix. Now it says the search needs billing on the key's project,
  and how to switch it on. That closed model isn't tried again until a new key is saved. A "not found" message also
  names the model Google named.

## 3.19.0 — one inventory for both computers

Joseph's PC and his dad's Mac each had their own inventory; a card scanned on one never showed up on the other.

- **Shared inventory** (Inventory → MJC store → ⚙ Setup): both computers work on ONE set of cards, sales, customers,
  expenses, shows, grading, want list, research reports, alerts and the activity feed. Start it on one computer, send
  the **🔑 invite code** to the other, paste it there — done. Changes reach the other computer within ~20 s (pushed ~2 s
  after a save, the cloud checked every 20 s); a computer that was off catches up when it's back. The Stock list
  redraws itself when the other computer's changes arrive (never while a card is open or you're typing), and its bar
  says "⇄ Shared with Dad's Mac · in step".
- **Nothing is lost when both edit at once.** Three-way merge: cards added on each computer both stay; different fields
  of one card edited on each both stay; the same field → the later save; a card deleted on one but edited on the
  other is kept. A save lands only on the cloud version it was merged with (the store checks), so two computers saving
  at the same second can't overwrite each other — the second merges again. Two cards numbered CRB-0005 at once: the
  newer gets the next free SKU.
- **Each computer keeps a full copy**: fast, works offline, its own daily backups. The shared copy lives privately in
  the MJC store's own storage (store 1.2.0) — the website never shows it. Card photos go up to the store's photo folder
  and come down on the other computer, so both see every card's pictures.
- **The daily jobs run on one computer** (re-pricing, website orders, PSA checks, value history, the weekly report), so
  nothing runs twice and no website order is recorded twice; if that computer is off for 20 minutes the other takes
  over by itself, or **Run them on this computer**. A computer connected to the store but not sharing doesn't pull
  website orders while another one shares.
- **The website can't go backwards.** A website sync names the shared copy it was built from; if the other computer
  saved a newer one a moment before, the store refuses it and the bot pulls and builds again — a stale copy can't take
  the other computer's new cards off the site. Once the inventory is shared, the store refuses a whole-catalog sync
  from a bot that isn't on it (an old version, or one never joined).
- **The activity feed says which computer** ("Dad's Mac added …").
- **Moving to a new store** (11/12: the store left the UR Mortgage AWS account for MJC's own). When the bot is connected
  to a different store, through Setup's Connect or an invite code, it forgets the old store's photo addresses for every
  photo whose file is on this computer. The next sync puts those photos in the new store, and the store details
  (shipping, returns, shows) go up right away. A store that doesn't answer leaves the old connection in place, and
  nothing is forgotten.
- Kept per computer: Google AI spend (the monthly budget counts on each computer), the phone's scan list, Undo.

### The phone scanner, 10-10 (11/12)

Joseph opened the phone camera page on 11/12 and found last week's pictures, including the Doflamingo already in stock.
He couldn't tell whether "Start over" would delete them, or whether sending more would add a second Doflamingo. His new
picture said "waiting to send" while it was actually stuck because Google's credit was out.

- **Sessions end by themselves.** Opening the page, or taking a picture, after 4 hours without one starts a new
  session and says where the last one's cards are. A line shows "This session: started 2:45 PM · 3 pictures".
- **"Start over" is now 🆕 New session**, and it says what it does: it clears this phone's list only; inventory and the
  website change only on the computer's ＋ Add. Pictures not done yet stay. Before, the button warned it would "drop"
  unsent pictures, but they were still sent with nothing on the phone to show for them.
- **The reader being down isn't a dead end.** When Google's credit runs out, a limit is hit or Google is overloaded:
  - the phone shows one banner saying why;
  - pictures read "⏸ waiting for the reader" instead of ✗;
  - Bulk scan tries again every minute by itself, so adding credit or a new key is all it takes. Before, you had to
    find ▶ Resume.
  - A wrong key or the bot's own budget still stops and says so.
- **A picture is never lost through a restart.** A phone picture the computer took but never finished goes back in the
  inbox at the next start. Finished ones are filed in `scan-inbox/read/` for a week. On the first start of 3.19, the
  pictures 3.18 already read are filed as finished, so they're never re-read into the list.
- **The same slab is never added twice.** A read card whose PSA cert is already in stock is the same slab:
  - it's unticked, and **＋ Add refuses it** even when ticked by hand (checked against inventory as it is at that
    moment);
  - the phone shows "already in inventory (CRB-0001)";
  - a slab shot twice in one scan is unticked the second time;
  - ☑ Tick all never re-ticks either.
  - Raw cards still show "have N": more copies are real.
- **A picture of only a card's back** (11/5: a slab's back shot on its own was read as a card named "One Piece Card
  Game") is unticked with a note.
- **The phone shows "✓ in inventory CRB-0007"** once the computer adds a picture's cards, so it's clear what's done and
  what still waits in Bulk scan. The phone's view of every picture is kept a week and survives a restart of the bot.
- **Faster sending:**
  - the camera's own JPEG goes as it is: no 4096-px re-encode on the phone, and no base64. Measured on a 12 MP picture
    in the same window: 353 → 132 ms of phone work, and 12.9 → 10.2 MB sent.
  - Sending and the status check restart the moment the page is back from the camera; the retry wait is at most 8 s.
- Plain captions ("#3 front · on the computer", "✓ read · 1 to check"), "↩ Undo picture 3", the time on each picture,
  and a low tone when a picture can't be read (with 🔔 on).

## 3.18.1 — Google's prepaid billing, and the Jan 1 price rise

- **Out of prepaid credit says so.** New Google AI accounts prepay (since Mar 2026): at $0 Google stops every key at
  once. The app now says the credit ran out and where to add it (AI Studio → Billing; auto-reload stops it happening
  mid-scan), instead of "Gemini API error 402", and doesn't try the backup models (they're stopped too).
- **The spend estimate follows Google's price.** gemini-3.8-flash doubles on Jan 1, 2027 ($1.50 in / $7.50 out per
  million tokens); from that day the estimate (Settings) and the monthly budget count the new price, so a budget isn't
  quietly worth half.

## 3.18.0 — scan to the MJC website in one go, WNBA, and a sync that keeps up

The MJC store went live on Nov 5 (https://main.dsq06359z2wce.amplifyapp.com). This release is the bot's half of the
day's 10-10 — the website's half is store 1.1.0.

- **WNBA.** A basketball card is WNBA when its set or name says so, its sales page is a WNBA set, or its team is one of
  the 15 WNBA teams. Scans tag it `wnba`, Inventory has a **🏀 WNBA** filter, and the website gets it in its own WNBA
  section. The set-checklist check picks the WNBA set ("2024 Panini Prizm WNBA"), never the NBA set of the same name, so
  there are no false "that number is someone else" alarms; price searches add "WNBA" when the read set leaves it out.
- **Bulk scan → 🌐 Also sell them on the MJC website.** The checked cards go up in the same step, priced by the engine.
  A card still marked ⚠ (backup read, checklist doubt, a parallel to check) is added but kept off the website until it's
  checked, so an unchecked parallel never goes up at the wrong price.
- **Sell on MJC says what happened**: the price the engine set and that it's on the website — or why it can't go up
  (no sales page, no sold data, the website not connected).
- **Faster, safer sync to the website**: photos upload 4 cards at a time; a catalog over 250 cards goes up in chunks
  (one request went past the store's 6 MB limit around 2,000 cards) when the store takes them (1.1.0+); a change made
  during a sync gets a sync of its own; one card's change or a sale reaches the website in ~2 s (was 8 s+); two failed
  syncs in a row raise an alert, and the MJC store panel shows the error and the card count.
- **Shipping not set isn't "free".** A blank shipping charge stays blank (the website said "Free shipping on every
  order"); the MJC store panel lists what Setup still needs (shipping charge, returns, support email).
- **Phone:** Front + back is on by default (the back has the number, year and set); **⏭ No back (a slab)** sends a front
  to be read right away instead of waiting 2 minutes for a back; after a read the phone says the next step on the
  computer.

## 3.17.3 — the set name from a set code, and no "null" names

From Joseph's first real scan (a PSA 10 Doflamingo OP04-019 Alternate Art):

- A One Piece / Yu-Gi-Oh / Pokémon card's set code (OP04-019, LOB-EN001) names exactly one set, so when the price page
  is that code, the card takes the page's set name. The reader had called OP04 "Kingdom of Ruin"; it's Kingdoms of
  Intrigue. (The price was already right — $140 for a PSA 10, recent sales $127.50–$150.)
- When the reader answers the word "null" for a player or team (the back of a slab), it's left blank instead of
  becoming the card's name.

## 3.17.2 — scanned cards get the right price page, and a wrong read can't slip through

Found by scanning real card photos end to end (scan → sales page → website price) on Nov 5, with Google's main
reader overloaded all morning.

- **Season years.** A card read as "2023-24 Panini Prizm" found no sales page at all — both price sites read
  "2023-24" as junk (it matched one /24 card). Searches now use the first year, the way the sites name sets.
- **Google overloaded: a third reader.** When the main model and the backup were both overloaded, a scan failed.
  Now it moves on to Google's older free model (gemini-2.5-flash). A model that keeps saying "overloaded" is skipped
  longer each time (5, 10, 20, then 30 minutes) instead of costing every scan ~100 s of waiting.
- **Backup readers are checked by eye.** On the test cards the backup readers swapped a base and a Silver Prizm and
  called a Red Ice "Red" — each "sure", worth $64 vs $897 vs $1,665. A card read by a backup model is now marked
  "⚠ backup read" (on the phone too); its "second look" never changes or clears a card; and a single-card lookup by a
  backup isn't remembered for that photo. Open the card, check the version, Save — saving marks it checked.
- **Look-alike versions.** A read that fits several versions ("Red" = Red, Red Ice, Red White Blue…) is flagged and
  gets a second look with the set's real list of versions. A card read as the base when the set has a Silver /
  Refractor / Holo of it worth more (~$897 vs ~$67 for the Wembanyama) says so — tilt it under a light; no photo
  can settle that one.
- **Front-only scans** get the card number from the set's checklist when the player has only one number in that set.

## 3.17.1 — Google searches on a free key again (until Dec 1); PSA says what to do

- **Searching works on Google's free tier.** Google's free tier has no Google Search on the Gemini 3 models, but its
  older model, gemini-2.5-flash, still searches for free (500 searches a day) — until Google retires it on
  **December 1, 2026**. When Google refuses a search on the main model, the app now searches with that one instead
  (hottest cards, Ask, the news in a lookup, the market check), and tries the main model again each hour (billing may
  be on by then). The self-test says which model searched. After Dec 1 Google refuses that too, and the app says
  billing is the way to keep searching.
- **PSA:** PSA now switches its "public" API on account by account (since late Oct 2026): every request from an
  account it hasn't approved gets "Access to this API is limited to approved customers", whatever the token. Settings
  says so in plain words and has **✉ Ask PSA for access** — an email to PSA's API team, written for you, that you send
  from your own mail. After that answer the app stops asking PSA for 6 hours instead of spending your ~100 calls a
  day on the same refusal (Save in Settings asks again). Until PSA approves it, every cert in the app links to its page
  on psacard.com so a slab can be checked by eye — stock rows ("verify"), scanned slabs and Cards are back.
- The desktop app opens email links in your mail program.

## 3.17.0 — hottest cards you can check, act on, and hold to account

The Google-searched part needs Gemini billing on (Google's free tier has no search on Gemini 3 models); everything
marked * works without it.

- **Sold prices first.** Every card on the list is checked against its own sales page: the sales inside the period
  against the ones before, and the 1-month trend. "✓ sold prices back it" cards rank above the buzz, then the ones
  with no data, then the ones sold prices don't show yet — with the numbers and a small price chart on each.
- **Targeted searches.** "All" runs one search per category (baseball, basketball, football, Yu-Gi-Oh, One Piece) and
  a single category two (the news, and the market trackers) — side by side — instead of one broad search.
- **Sources per card**: each card shows the pages that back it, not one pile at the bottom (that's still there as
  "All sources"). A card whose newest evidence is older than the list's window is marked with the date.
- * **What you have**: "you own 2 (PSA 10)", 🎯 wanted, ★ watching on each card. Owned: recent raw sales to sell
  into; not owned: what you could pay for a raw one and still flip it (raw sold value less eBay's fees and a 20%
  margin — hover for the math). **A card you own that turns up on the list raises an alert** (🔥).
- * **The list's track record**: 🔥 "3 in a row" when a card stays on the list, when it first showed up, and a
  scoreboard — the cards it flagged 1–8 weeks ago and what their raw sold prices did since.
- * **No Google search? Still a list.** Without search (free-tier key, or Google down) the list is built from your own
  watchlist and inventory, ranked by how much their real sold values rose — said plainly at the top, nothing made up.
  When Google refuses search, the other searches of the same list don't wait in line to be refused too.
- 🔎 **Deals** on each card (live eBay listings under its sold value), ⚡ **Price** (free Quick price), **Research →**,
  and ✕ to hide a card you don't care about (Show hidden brings them back).
- **💬 Ask about this list** opens Ask with the whole list as the context ("which of these is safest to hold?").
  **📋 Copy as text** to paste it in a message. Each category button shows how old its last list is.
- The cost line counts the Google searches the list used. Settings → the morning brief has a time.

## 3.16.0 — PSA: track what's out, send the right cards, check what came back

Everything that asks PSA works the moment PSA approves your account for its API (Settings shows PSA's answer);
the rest works now.

- **Cards already at PSA can be tracked.** A new submission takes cards that were never in inventory — one per line
  with what you paid — and adds them as "at grading". Enter the submission number and the bot checks PSA every hour.
- **The tracker:** PSA's stage with a progress bar, every stage it passed and how many days it spent there, when it's
  due back (the service's turnaround in business days from the day it was sent) and an **overdue** mark past that,
  the return tracking number as a link to UPS / FedEx / USPS, and a link to PSA's My Orders.
- **Notifications** (desktop, and in Alerts) when grades are ready, when the box ships back, and when PSA flags a
  problem with the order — with what to do. Settings → Desktop app → notifications has a switch for them.
- **Cards are back — scan the slabs.** Scan each slab's barcode (or type the cert): PSA's record fills in the grade,
  matches it to the right card in the submission, and keeps the cert, the label's words (qualifiers, an autograph
  grade) and "✓ matches PSA" on the card. A slab from somewhere else is called out. If PSA doesn't answer, you pick
  the card and the cert is still kept.
- **What grading did:** each finished submission shows the cards' value when they went out → now, the cost, and what
  grading added. **Grading history** sums it up per service: days out, average grade, 10s, and what it added per card.
- **📋 The list for PSA's form** (from What to grade next, or any submission): year, set, number, player, variety and
  a declared value for each card — what it should be worth once graded (each grade's sold price × its odds), with
  "if it's a 10" — and the cheapest open service level whose limit covers every card, with the total. Print it as a
  packing list with tick boxes, or download it as a CSV. **＋ Make the submission** carries the service and cost over.
- **🔍 Check their photos first** (What to grade next): each ticked card's own photos looked at the way a grader would
  — centering, corners, edges, surface, and the one flaw most likely to cost it a grade — then ranked again with what
  the photos show. A condition you set yourself is never overwritten.
- **Grading services** (Shop → Settings) now hold, next to what you charge a customer, what the grader charges you,
  the most a card may be declared at, the turnaround and paused levels. **Fill in PSA's levels** adds PSA's levels as
  Sports Illustrated reported them in June 2026 (Regular, Express, Super Express, Walk-Through; the Value levels
  paused) — check them on psacard.com, PSA changes them often. Customers are only offered services you've priced.
- **Slabs in stock:** the daily PSA check now also verifies each slab — PSA's record must say the same card and
  grade (✓ on the row; an alert if not, or if PSA has no such cert) — and the row shows the population at its grade
  and how many are higher. A slab's editor has **🖼 PSA's own photos** to compare with the one in hand.
- Settings shows how many PSA calls the app made today (PSA allows about 100 a day).

## 3.15.0 — the iPhone scans pages of cards and tells you what it found

- **Full-resolution pictures.** The phone sends its camera's full picture (up to 4096 px, an iPhone's 4032) instead
  of shrinking it to 2400 — on a 9-card page that's about 1.7× the detail on every card number and serial.
- **Read whatever screen the computer is on.** Phone pictures used to wait until someone opened Bulk scan. Now the
  computer running the bot reads them as they arrive, on any screen; Bulk scan shows "(5 new)" until it's opened.
  Each picture is claimed by one screen, so it's never read twice.
- **The phone shows what was found**, a few seconds after each picture: how many cards, which ones to retake —
  glare, blurry, cut off by the edge, too small — by position ("row 2, card 3"), and each card's name and value. Tap a
  picture for the list. Running totals (cards, value, how many to check), a warning when the same page seems to have
  been shot twice, and when a front and its back show a different number of cards.
- **Nothing lost on a Wi-Fi drop.** Pictures wait on the phone and go when the connection is back (with a count of
  how many are waiting); a retry is never a second copy. **Undo last** takes back a picture the computer hasn't
  started. A quick check before sending warns when a picture is too dark or blurry. Optional short sound when a
  picture is read. The phone keeps its session through a reload; **Start over** begins a new one.
- **A second look at the unsure cards.** After the first read, cards it wasn't sure of — or that don't match the set's
  checklist — are read again up close, choosing from the versions the checklist really lists for that number (Base,
  Silver, Red Wave…). What changed is re-checked and re-priced; the row shows 👀 looked twice.
- **Full details on every raw card**: condition (NM / LP / MP / HP / DMG, corners, edges, surface), centering and the
  PSA 10 / 9 odds, as an estimate from the photo, saved on the inventory row — "What to grade next" uses them.
- **Faster pages.** Finding the cards in the next pictures and reading the last ones now run side by side.
- The review list shows each card's place on the page, what it's in (sleeve, toploader, slab), a 📷 note when its
  photo had glare or blur, and "📱 picture 3" for phone pictures.

## 3.14.3 — the search message says what the free tier really allows

- When Google refuses a search, the message now says plainly that the key's project is on Google's free tier, which
  has no Google Search at all on Gemini 3 models (0 searches — the 5,000 free a month only start once billing is on),
  and how to tell in AI Studio that billing took (the key's row shows a paid tier instead of "Free tier").
- After a refusal the app asks Google again after 2 minutes instead of 30, so turning billing on starts working
  within minutes without re-saving the key.

## 3.14.2 — price search through the sites' API; Settings shows whether PSA really works

- **Price search token** (Settings → Optional connections → Price search). SportsCardsPro and PriceCharting put a robot
  check on their search pages, so the app can't find a new card's sold prices by itself any more. Their official API
  ($6/month each — SportsCardsPro for sports cards, PriceCharting for Yu-Gi-Oh / One Piece / Pokémon) is the way
  in: paste the 40-character token and Save tries it once before keeping it. With it, card lookups, bulk scans, Quick
  price, the set browser, hottest-cards price checks and 💲 Find price search through the API, and still read each
  card's own page for its recent sales, exactly as before (same page addresses, so nothing already saved changes).
  The API allows one call a second; calls queue.
- **PSA shows "working", not just "saved".** Settings asks PSA (at most hourly) whether the token really works and
  shows PSA's answer — e.g. that the account isn't approved for the API yet. Saving a PSA token says so straight away.

## 3.14.1 — when Google, PSA or the price sites say no, the app says why

- **Gemini busy no longer looks like a hang.** When Google says the main model (gemini-3.8-flash) is overloaded — it
  was for most of Nov 3 — the app tries once more, then the backup model answers within seconds, and the main one is
  skipped for 5 minutes. A call that hangs moves to the backup after one 90 s wait instead of two. After 25 s of
  silence the progress line says what it is waiting on. The self-test shows each retry and switch as it happens.
- **Google Search needs billing on Gemini 3 models.** Google's free tier has no Google Search on Gemini 3 and newer
  models ("Not available" on Google's pricing page), so hottest cards, Ask, news in a lookup and the market check
  could never search on a free key — the app waited out a "speed limit" six times and then failed. Now it says at once
  what to do (turn on billing in Google AI Studio; the first 5,000 searches a month are free), and doesn't ask Google
  again for 30 minutes. Saving a new key in Settings clears that.
- **A card lookup finishes without search.** Identification, sold prices, the grade math and the reseller call come
  from the photo and the price sites; when search isn't possible the report is written from those and says news is
  unknown, instead of the whole lookup failing. The inventory market check does the same.
- **PSA:** when PSA turns the token away, the app shows PSA's own reason. "Access to this API is limited to approved
  customers" means the token is right but PSA hasn't switched API access on for the account yet.
- **Price sites:** SportsCardsPro and PriceCharting now put a robot check ("Just a moment…") on their search pages;
  the app says so plainly instead of "HTTP 403". Card pages themselves still load, so cards already in inventory keep
  re-pricing.

## 3.14.0 — updates install by themselves

- **Automatic updates** (Settings → Desktop app → Update automatically, on by default). Every 6 hours the app looks
  for a new version, downloads it in the background and checks it against GitHub's checksum. Then it waits for a quiet
  moment — nobody has used the computer for 10 minutes and no research is running — and installs it. The app closes
  and reopens on the new version by itself, and a notification says it updated. Your data and settings are kept.
- **Mac: no more dragging.** Update now (and automatic updates) swap the new app in place and reopen it. If the app
  isn't in a folder it can change (for example it was opened straight from the download), the installer window opens
  as before.
- The release build now tests both installs on the files it just built — the Windows silent install and the Mac
  swap from the real .dmg — so a version that can't install itself never ships.

## 3.13.2 — Google's new Gemini keys

- Settings now takes Google's new Gemini API keys (they start with `AQ.`). AI Studio stopped handing out the older
  `AIza…` keys, and the app refused the new ones as "not a Gemini key". Older keys still work. New keys are also
  scrubbed from the app's log like the old ones.

## 3.13.1 — drops tell your email list

- When a scheduled drop goes live on the website, the email list hears about it once — the cards, prices and links,
  one email per person (sent by the store from the shop's address, once that's set up). A drop more than 6 hours old
  is never announced late. The activity feed says who was told, or why not.

## 3.13.0 — running the website's new services from here

- **Conversations**: every website message now has a reply box — the shopper sees your reply on their page (and in
  Pip's chat, within about 30 seconds while they're there) and by email once the shop's email is set up. Their
  answers come back as alerts. While a conversation is going, the app checks for replies every 30 seconds.
- **Offers on cards people want to sell**: type a cash and/or store-credit offer; they accept or decline on their
  own page. Chose credit? One click gives it to them in the customer book.
- **Reviews** (MJC store → ⭐ Reviews): reply publicly; hide one only as spam, abuse or personal details.
- **What Pip couldn't answer** (❓): the questions it handed over or missed (no contact details) — add the answer to
  Setup and Pip uses it next time.
- **Orders**: a big order waits with a warning until you click "Checked — OK to ship" (set the amount in Setup);
  pickup at a show and gift cards show on the order; store credit spent online comes off the customer's balance.
  Marking an order shipped or delivered emails the buyer (tracking; then the review link).
- **Setup**: pickup at a card show, pay over time (after turning on Affirm/Klarna in Stripe), store credit online
  by code, gift cards (and their amounts), "check orders over $". Saving Setup no longer drops the show calendar.
- **Drops**: "Goes live at" on a card (or many at once in Bulk edit) — hidden on the website until then, and the
  home page shows the next drop.
- **Status pages**: consignors' statements and customers' grading orders go to the website on every sync; their
  links are on the customer's page and the printed grading receipt (with a QR code). Each customer has an online
  store-credit code.
- **Tilt videos** go to the website through a signed upload link (straight to the photo bucket).
- **Weekly report**: "Send it now" from the shop's own address once the website's email is set up.

## 3.12.0 — books & taxes, sales from other sites, live streams, packing, "ask my business"

- **Books & taxes** (Shop → Books & taxes): the year's sales by where they sold, fees, cost of cards, expenses and
  net; inventory at cost on Jan 1 and Dec 31 (the cost-of-goods number for taxes); sales tax (collected on the
  website, and what's due on show and local sales at your rate); a **1099-K check** — type each site's 1099-K amount
  and see what isn't recorded here; consignment totals. 🖨 **Year-end report** for the accountant, plus the CSVs.
- **Sales from eBay / Whatnot / TCGplayer**: load the site's sales file (eBay: Seller Hub → Orders → Download
  report). Each line is matched to your card by SKU (the Custom label) or the closest title; you tick what's right
  and those cards are marked sold with that site's fees — and come off the MJC website. Importing the same file
  twice is harmless. Buyers join the customer book.
- **Listing file** (Stock → select → ⬇ Listing file): every field eBay and Whatnot ask for, one row per card
  (title, price, grader, grade, cert, condition, year, set, player, team, number, parallel, serial, RC/auto/relic,
  description, photo links) to copy into their bulk-listing templates.
- **Insurance schedule**: every card over an amount with its photo, cert, location, cost and value today — printed
  the way insurers ask for it.
- **What to grade next** (Inventory → Grading): raw cards ranked by what grading should add after eBay fees and your
  grading cost, from each grade's sold values and the odds from the card's condition and centering. Tick the best
  ones → a new submission.
- **Ask about my business** (Ask → 📊 My business): "What did Tigers cards make us this year?", "What's been in
  stock 90+ days?". The AI only works out what to count — the app counts your real records, and the answer quotes
  those numbers with a table of how it got them.
- **Weekly report** (Home → 📋, and a Monday-morning alert): last week's sales, profit, best flip, cards added,
  stock value, biggest moves, and what needs doing (orders to ship, messages, consignors owed, grading back,
  supplies low, shows coming up) — copy it or email it.
- **Packing**: a pick list for every website order waiting to ship, sorted by box, with packing advice (insure over
  $100, signature over $750, envelope / bubble mailer / box by value — set in Shop settings) and branded packing
  slips with a QR code to track the order.
- **Live streams** (Shop → 📺 Live stream): line up the cards, put one on screen, type @buyer and the price → it's
  sold on Whatnot (fees taken off), the buyer joins the customer book and the next card comes up. The **overlay
  page** (http://localhost:3737/overlay.html as an OBS browser source) shows the card, its price, what's next and a
  SOLD banner. End the stream → a recap by buyer to pack from.
- Supplies nobody has counted yet show "—" instead of telling a new shop to reorder everything.

## 3.11.0 — the Shop: customers, store credit, consignment, grading service, shows, supplies

- **Customer book** (new **Shop** tab): everyone who buys, sells, consigns or grades with you — website buyers are
  added by themselves. Write what each one collects ("Tigers, Skubal, Pokemon 151"): when matching cards come in
  you get one alert naming who to tell, and the customer's page has "✉ Email them these" ready to send. Their page
  shows everything they've done with the shop.
- **Store credit**: give credit for a trade-in, a refund or a gift card; spend it with the new **Store credit**
  payment in Show mode or the Sold dialog (it can never go below zero; undoing a show sale gives it back).
- **Consignment**: sell other people's cards for a commission (15% by default, per customer if you like). Pick
  "Consigned by" in Bulk scan or the card editor, with their minimum price — the pricing engine never goes under it.
  When one sells, what they're owed is worked out automatically and the profit shown is your commission. Pay them
  in one click (cash, Venmo, store credit…) and print their statement.
- **Grading service**: take in customers' cards to grade, print their receipt, send them with your own submissions
  — link the order to the submission and its progress at PSA follows it. Prices per service in Shop settings.
- **Card shows**: the calendar (public ones go on the website's "Find us at shows"), a checklist for the table, a
  pull list of what to bring sorted by box, Show mode files each sale under the day's show, and each show's profit
  after the table and expenses. **Cash drawer count** at close: start cash + cash sales − cash paid out vs counted.
- **Helper PIN** (Settings → Share on home network): someone helping at the table signs in with it and gets Show
  mode only — no costs, no settings, no edits.
- **Supplies**: sleeves, top loaders, team bags, mailers… each website order uses up its share; an alert when one
  reaches its reorder point; ＋ Restock files the expense.
- Show mode: pick the customer (credit shown), every payment type, and the show the sale is filed under.

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
