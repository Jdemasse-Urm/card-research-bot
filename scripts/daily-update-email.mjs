#!/usr/bin/env node
// Emails a plain-English summary of the day's work on Card Research Bot and the MJC website.
//
//   node scripts/daily-update-email.mjs                 today's summary from both repos' commits + CHANGELOG (skips a quiet day)
//   node scripts/daily-update-email.mjs --file note.txt  send that text instead (first line = subject if it starts with "Subject:")
//   --to a@b.com,c@d.com   recipients (default: UPDATE_EMAIL_TO env, else jeffkelly@comcast.net)
//   --cc a@b.com           copies
//   --dry                  print instead of sending
//
// Sends through Salesforce's emailSimple action with the Salesforce CLI's login on this computer (the same
// path the dialer's alert emails use — see sfEmail in the dialer). The token stays in memory; nothing is
// printed but the result. Needs: `sf` CLI logged in to the org named by SF_ORG (default "prod").

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const TO = flag("to", process.env.UPDATE_EMAIL_TO || "jeffkelly@comcast.net");
const CC = flag("cc", process.env.UPDATE_EMAIL_CC || "");
const ORG = process.env.SF_ORG || "prod";
const REPOS = [
  { name: "Card Research Bot (the desktop app)", dir: path.join(os.homedir(), "card-research-bot") },
  { name: "The MJC website", dir: path.join(os.homedir(), "mcj") },
];
const today = new Date();
const day = today.toISOString().slice(0, 10);
const human = today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

function git(dir, ...a) {
  try {
    return execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** The day's commit messages, with the terse developer lines (SHAs, "Co-Authored-By", file lists) left out. */
function commitsToday(dir) {
  const raw = git(dir, "log", `--since=${day}T00:00:00`, "--format=%s%n%b%n---");
  if (!raw) return [];
  return raw.split("\n---").map((block) => block.trim()).filter(Boolean).map((block) => {
    const lines = block.split("\n").filter((l) => l.trim() && !/^(Co-Authored-By|Signed-off-by|Golden rule|Tests?:)/i.test(l.trim()));
    return { title: lines[0].replace(/^v?\d+\.\d+\.\d+:\s*/, "").replace(/^ci:\s*/i, "CI: "), body: lines.slice(1).map((l) => l.trim()).join(" ").replace(/\s+/g, " ") };
  });
}

/** CHANGELOG sections committed today (they're already written for a non-technical reader). */
function changelogToday(dir) {
  const file = path.join(dir, "CHANGELOG.md");
  if (!fs.existsSync(file)) return [];
  const changed = git(dir, "log", `--since=${day}T00:00:00`, "--format=%H", "--", "CHANGELOG.md");
  if (!changed) return [];
  const text = fs.readFileSync(file, "utf8");
  const before = git(dir, "show", `${changed.split("\n").pop()}~1:CHANGELOG.md`);
  const sections = (t) => t.split(/\n(?=## )/).filter((s) => s.startsWith("## "));
  const old = new Set(sections(before).map((s) => s.split("\n")[0]));
  return sections(text).filter((s) => !old.has(s.split("\n")[0])).map((s) => s.replace(/\*\*/g, "").replace(/`/g, "").trim());
}

function compose() {
  const parts = [];
  for (const r of REPOS) {
    if (!fs.existsSync(r.dir)) continue;
    const log = changelogToday(r.dir);
    const commits = commitsToday(r.dir);
    if (!log.length && !commits.length) continue;
    parts.push(`${r.name.toUpperCase()}\n${"=".repeat(r.name.length)}`);
    if (log.length) parts.push(log.join("\n\n"));
    else parts.push(commits.map((c) => `• ${c.title}${c.body ? `\n  ${c.body}` : ""}`).join("\n"));
    parts.push("");
  }
  if (!parts.length) return null;
  return `Hi Jeff,\n\nHere's what got done today (${human}) on the card business software. Plain English, no tech needed.\n\n${parts.join("\n")}\nQuestions? Just reply to this email.\n\n— Sent automatically at the end of the day from Joseph's computer`;
}

function sfLogin() {
  const out = execFileSync("sf", ["org", "display", "--target-org", ORG, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" });
  const r = JSON.parse(out).result;
  if (!r?.accessToken || !r?.instanceUrl) throw new Error(`Salesforce CLI isn't logged in to "${ORG}" — run: sf org login web --alias ${ORG}`);
  return r;
}

async function send(subject, body) {
  const { accessToken, instanceUrl } = sfLogin();
  const r = await fetch(`${instanceUrl}/services/data/v60.0/actions/standard/emailSimple`, {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: [{ emailAddresses: [TO, CC].filter(Boolean).join(","), emailSubject: subject, emailBody: body, senderType: "CurrentUser", useLineBreaks: true }] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Salesforce emailSimple HTTP ${r.status}`);
  // A 200 is not "sent": Salesforce reports the real verdict inside the body (daily limit, bad address…).
  const out = await r.json().catch(() => null);
  const first = Array.isArray(out) ? out[0] : out?.results?.[0] || out;
  if (!first || first.isSuccess === false) throw new Error("Salesforce did not send it: " + ((first?.errors || []).map((e) => e.message || e.statusCode).join("; ") || "unknown reason"));
}

let subject, body;
const file = flag("file");
if (file) {
  body = fs.readFileSync(file, "utf8");
  const m = body.match(/^Subject:\s*(.+)\n+/);
  if (m) { subject = m[1].trim(); body = body.slice(m[0].length); }
  subject ||= `MJC update — ${human}`;
} else {
  body = compose();
  if (!body) { console.log(`Nothing to report for ${day} — no email sent.`); process.exit(0); }
  subject = `MJC daily update — ${human}`;
}

if (has("dry")) {
  console.log(`To: ${TO}${CC ? `  Cc: ${CC}` : ""}\nSubject: ${subject}\n\n${body}`);
} else {
  await send(subject, body);
  console.log(`Sent "${subject}" to ${TO}${CC ? ` (cc ${CC})` : ""} via Salesforce (${ORG}).`);
  try {
    const logDir = path.join(os.homedir(), "card-research-bot", "scripts");
    fs.appendFileSync(path.join(logDir, "daily-update-email.log"), `${new Date().toISOString()} sent to ${TO} — ${subject}\n`);
  } catch { /* the log is a convenience */ }
}
