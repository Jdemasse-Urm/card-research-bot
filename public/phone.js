// Phone camera for Bulk scan: every picture is shrunk to a sensible size and sent to the computer's scan inbox.
// Names tell the computer how pictures go together: <session>-<card>-a (front), -b (back), -s (one picture).
const $ = (s) => document.querySelector(s);
const session = Date.now().toString(36);
let card = 0, sent = 0, waitingBack = null;

const both = $("#both");
both.checked = localStorage.getItem("phoneBoth") === "1";
both.onchange = () => {
  localStorage.setItem("phoneBoth", both.checked ? "1" : "0");
  waitingBack = null;
  say(both.checked ? "Take the front of a card." : "");
};
$("#shoot").onclick = () => $("#cam").click();
$("#pickBtn").onclick = () => $("#pick").click();
$("#cam").onchange = (e) => sendAll(e.target);
$("#pick").onchange = (e) => sendAll(e.target);

function say(text, kind = "") {
  const el = $("#status");
  el.textContent = text;
  el.className = "status " + kind;
}

async function sendAll(input) {
  const files = [...input.files];
  input.value = "";
  for (const f of files) await send(f);
}

/** Long side 2400 px: plenty for card numbers and serial stamps, small enough for home Wi-Fi. */
async function shrink(file) {
  let img;
  try {
    img = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    img = await new Promise((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = URL.createObjectURL(file);
    });
  }
  const w = img.width, h = img.height, k = Math.min(1, 2400 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

async function send(file) {
  let side = "s", n;
  if (both.checked) {
    if (waitingBack == null) { n = waitingBack = ++card; side = "a"; }
    else { n = waitingBack; waitingBack = null; side = "b"; }
  } else n = ++card;
  say("Sending…");
  try {
    const image = await shrink(file);
    const r = await fetch("/api/scan/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image, name: `phone-${session}-${String(n).padStart(4, "0")}-${side}` }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `The computer said ${r.status}`);
    sent++;
    const fig = document.createElement("figure");
    fig.innerHTML = `<img alt=""><figcaption>${n}${side === "a" ? " front" : side === "b" ? " back" : ""}</figcaption>`;
    fig.querySelector("img").src = image;
    $("#gallery").prepend(fig);
    say(side === "a" ? `Card ${n}: front sent ✓ — now flip it and take the back.` : `✓ ${sent} picture${sent === 1 ? "" : "s"} sent — they show up in Bulk scan on the computer.`, "good");
  } catch (err) {
    if (side === "a") { waitingBack = null; card--; }
    if (side === "b") waitingBack = n;
    say(`Not sent: ${err.message}. Same Wi-Fi as the computer? Try again.`, "bad");
  }
}
