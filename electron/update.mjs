// The desktop app's updater: fetch a release installer from this project's own GitHub releases, check it against
// GitHub's SHA-256, and put the new version in place. Used by "Update now" and by automatic updates (main.js).
// No Electron in here, so the release build can try the Mac swap on the real .dmg and the tests can run the rules.

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const RELEASES = "https://github.com/Jdemasse-Urm/card-research-bot/releases/download/";

/** Only this project's own release files, and only the installer for this kind of computer. → error text, or null */
export function badAsset({ url, name } = {}, platform = process.platform) {
  if (typeof url !== "string" || !url.startsWith(RELEASES) || !/^[\w.-]+\.(exe|dmg)$/i.test(String(name))) return "That isn't a Card Research Bot release file.";
  if ((platform === "win32") !== /\.exe$/i.test(name)) return "That installer is for the other kind of computer.";
  if (platform !== "win32" && platform !== "darwin") return "Updates install by themselves on Windows and Mac only.";
  return null;
}

/** "CardResearchBot-3.14.0-Mac.dmg" → "3.14.0" */
export const assetVersion = (name) => String(name || "").match(/\d+\.\d+\.\d+/)?.[0] || null;

/**
 * Download into dir, hashing as it goes. When GitHub publishes a SHA-256 the file must match it byte for byte
 * (a mismatch is deleted). onProgress({ pct, got, total }). → the file's path
 */
export async function download({ url, name, size, sha256 }, dir, onProgress = () => {}) {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15 * 60000) });
  if (!r.ok || !r.body) throw new Error(`GitHub answered ${r.status}`);
  const total = Number(r.headers.get("content-length")) || size || 0;
  const file = path.join(dir, name);
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash("sha256");
  let got = 0, lastPct = -1;
  for await (const chunk of r.body) {
    hash.update(chunk);
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((res) => out.once("drain", res));
    const pct = total ? Math.floor((got / total) * 100) : null;
    if (pct !== lastPct) { lastPct = pct; onProgress({ pct, got, total }); }
  }
  await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
  if (size && got !== size) throw new Error("The download was incomplete — try again.");
  if (sha256 && hash.digest("hex") !== sha256) {
    fs.rmSync(file, { force: true });
    throw new Error("The download didn't match GitHub's checksum, so it was deleted. Try again later.");
  }
  return file;
}

/**
 * An automatic update installs only at a quiet moment: no research running, none for 5 minutes, and nobody
 * at the keyboard for 10 (the app restarts, so a half-typed card or a running bulk scan would be lost).
 */
export function quietMoment({ busy, jobIdleSecs, userIdleSecs }) {
  return busy === 0 && (jobIdleSecs == null || jobIdleSecs >= 300) && userIdleSecs >= 600;
}

/** Mac: the .app this process runs from, or null when it can't be swapped in place (run from the .dmg, or quarantined). */
export function macAppPath(execPath) {
  const app = path.posix.resolve(execPath, "..", "..", "..");
  return app.endsWith(".app") && !app.includes("/AppTranslocation/") && !app.startsWith("/Volumes/") ? app : null;
}

const plistVersion = (xml) => String(xml).match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || null;

/**
 * Mac: swap the app at appPath for the one inside the .dmg. The new copy is made and checked first, beside the
 * old one; only then are the two swapped, and the old app is put back if the swap fails part-way. The old copy
 * is left as ".<name>.old" (still in use until the restart) for macCleanup on the next start.
 */
export async function macReplace(dmg, appPath, version) {
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), "crb-update-"));
  await run("hdiutil", ["attach", dmg, "-nobrowse", "-noautoopen", "-readonly", "-mountpoint", mnt]);
  const dir = path.dirname(appPath), base = path.basename(appPath);
  const staged = path.join(dir, `.${base}.new`), old = path.join(dir, `.${base}.old`);
  try {
    const src = fs.readdirSync(mnt).find((f) => f.endsWith(".app"));
    if (!src) throw new Error("The update has no app inside.");
    fs.rmSync(staged, { recursive: true, force: true });
    await run("ditto", [path.join(mnt, src), staged]);
    const info = path.join(staged, "Contents", "Info.plist");
    let got = plistVersion(fs.readFileSync(info, "utf8"));
    if (!got) got = plistVersion((await run("plutil", ["-convert", "xml1", "-o", "-", info])).stdout);
    if (version && got !== version) throw new Error(`The update holds version ${got || "unknown"}, not ${version}.`);
    fs.rmSync(old, { recursive: true, force: true });
    fs.renameSync(appPath, old);
    try {
      fs.renameSync(staged, appPath);
    } catch (err) {
      fs.renameSync(old, appPath);
      throw err;
    }
    return { version: got };
  } catch (err) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw err;
  } finally {
    await run("hdiutil", ["detach", mnt, "-force"]).catch(() => {});
    try { fs.rmdirSync(mnt); } catch {}
  }
}

/** Mac: remove the previous version's copy left by macReplace (called when the new version starts). */
export function macCleanup(appPath) {
  if (!appPath) return;
  try { fs.rmSync(path.join(path.dirname(appPath), `.${path.basename(appPath)}.old`), { recursive: true, force: true }); } catch {}
}
