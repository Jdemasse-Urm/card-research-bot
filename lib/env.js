// Where the bot keeps its data and settings, and loading of the .env settings file.
// Imported FIRST by server.js and selftest.js so every other module sees the settings.
//
//   Desktop app:  CARD_BOT_HOME is set by electron/main.js to the per-user app-data folder
//                 (Windows: %APPDATA%\Card Research Bot, Mac: ~/Library/Application Support/Card Research Bot)
//   From source:  the project folder itself (./data and ./.env), as before.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APP_DIR = projectDir; // read-only in the installed app (inside app.asar)
export const HOME = process.env.CARD_BOT_HOME || projectDir;
export const ENV_PATH = path.join(HOME, ".env");
export const DATA_DIR = path.join(HOME, "data");

fs.mkdirSync(DATA_DIR, { recursive: true });
dotenv.config({ path: ENV_PATH, quiet: true });
