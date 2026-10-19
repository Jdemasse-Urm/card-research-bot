# Changelog

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
