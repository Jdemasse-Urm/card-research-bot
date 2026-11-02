// The desktop updater's rules (electron/update.mjs): which files it accepts, the checked download, when an
// automatic update may install, and — on the Mac release build only — the in-place swap from the real .dmg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASES, assetVersion, badAsset, download, macAppPath, macCleanup, macReplace, quietMoment } from "../electron/update.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("only this project's release installers, for this kind of computer", () => {
  const exe = { url: RELEASES + "v3.14.0/CardResearchBot-Setup-3.14.0-Windows.exe", name: "CardResearchBot-Setup-3.14.0-Windows.exe" };
  const dmg = { url: RELEASES + "v3.14.0/CardResearchBot-3.14.0-Mac.dmg", name: "CardResearchBot-3.14.0-Mac.dmg" };
  assert.equal(badAsset(exe, "win32"), null);
  assert.equal(badAsset(dmg, "darwin"), null);
  assert.match(badAsset(dmg, "win32"), /other kind of computer/);
  assert.match(badAsset(exe, "darwin"), /other kind of computer/);
  assert.match(badAsset({ ...exe, url: "https://evil.example/CardResearchBot.exe" }, "win32"), /isn't a Card Research Bot release/);
  assert.match(badAsset({ ...exe, name: "../../x.exe" }, "win32"), /isn't a Card Research Bot release/);
  assert.match(badAsset(dmg, "linux"), /Windows and Mac only/);
  assert.equal(assetVersion(dmg.name), "3.14.0");
  assert.equal(assetVersion("nothing"), null);
});

test("an automatic update waits for a quiet moment", () => {
  assert.equal(quietMoment({ busy: 0, jobIdleSecs: null, userIdleSecs: 900 }), true, "no research since the app started, nobody at the computer");
  assert.equal(quietMoment({ busy: 1, jobIdleSecs: 0, userIdleSecs: 3600 }), false, "research running (e.g. a bulk scan while away)");
  assert.equal(quietMoment({ busy: 0, jobIdleSecs: 20, userIdleSecs: 3600 }), false, "between two calls of a bulk scan");
  assert.equal(quietMoment({ busy: 0, jobIdleSecs: 400, userIdleSecs: 120 }), false, "someone is using the computer");
  assert.equal(quietMoment({ busy: 0, jobIdleSecs: 400, userIdleSecs: 700 }), true);
});

test("Mac: the app can be swapped in place only from a real folder", () => {
  assert.equal(macAppPath("/Applications/Card Research Bot.app/Contents/MacOS/Card Research Bot"), "/Applications/Card Research Bot.app");
  assert.equal(macAppPath("/Volumes/Card Research Bot/Card Research Bot.app/Contents/MacOS/Card Research Bot"), null, "running from the .dmg");
  assert.equal(macAppPath("/private/var/folders/x/T/AppTranslocation/ABC/d/Card Research Bot.app/Contents/MacOS/Card Research Bot"), null, "quarantined copy");
});

test("the download must match GitHub's checksum and size; a bad one is deleted", async () => {
  const body = crypto.randomBytes(200000);
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  const srv = http.createServer((_req, res) => { res.setHeader("content-length", body.length); res.end(body); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/x`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-upd-"));
  try {
    const seen = [];
    const file = await download({ url, name: "CardResearchBot-Setup-9.9.9-Windows.exe", size: body.length, sha256: sha }, dir, (p) => seen.push(p.pct));
    assert.deepEqual(fs.readFileSync(file), body);
    assert.equal(seen.at(-1), 100);
    await assert.rejects(download({ url, name: "bad.exe", size: body.length, sha256: "0".repeat(64) }, dir), /didn't match GitHub's checksum/);
    assert.equal(fs.existsSync(path.join(dir, "bad.exe")), false, "a mismatch is never left to run");
    await assert.rejects(download({ url, name: "short.exe", size: body.length + 1, sha256: sha }, dir), /incomplete/);
  } finally {
    srv.close();
  }
});

// The release build runs this on GitHub's Mac right after building: the exact swap an automatic update does.
const dmgName = fs.existsSync(path.join(root, "dist")) ? fs.readdirSync(path.join(root, "dist")).find((f) => f.endsWith(".dmg")) : null;
const builtApp = path.join(root, "dist", "mac-universal", "Card Research Bot.app");
test("Mac: an update swaps the app in place from the real .dmg, and a wrong one leaves the app alone", { skip: process.platform !== "darwin" || !dmgName || !fs.existsSync(builtApp) ? "runs on the Mac release build" : false, timeout: 300000 }, async () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const dmg = path.join(root, "dist", dmgName);
  const apps = fs.mkdtempSync(path.join(os.tmpdir(), "apps-"));
  const appPath = path.join(apps, "Card Research Bot.app");
  const plistOf = (app) => execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", path.join(app, "Contents", "Info.plist")]).toString().trim();
  execFileSync("ditto", [builtApp, appPath]);
  execFileSync("plutil", ["-replace", "CFBundleShortVersionString", "-string", "0.0.1", path.join(appPath, "Contents", "Info.plist")]);
  assert.equal(plistOf(appPath), "0.0.1", "the 'installed' older version");

  await assert.rejects(macReplace(dmg, appPath, "9.9.9"), /holds version/);
  assert.equal(plistOf(appPath), "0.0.1", "a wrong update leaves the installed app as it was");
  assert.equal(fs.existsSync(path.join(apps, ".Card Research Bot.app.new")), false);

  assert.deepEqual(await macReplace(dmg, appPath, version), { version });
  assert.equal(plistOf(appPath), version, "the new version is in place");
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath]);
  assert.equal(plistOf(path.join(apps, ".Card Research Bot.app.old")), "0.0.1", "the old copy waits beside it until the restart");
  macCleanup(appPath);
  assert.equal(fs.existsSync(path.join(apps, ".Card Research Bot.app.old")), false, "removed when the new version starts");
  assert.equal(execFileSync("hdiutil", ["info"]).toString().includes("crb-update-"), false, "the .dmg was ejected");
});
