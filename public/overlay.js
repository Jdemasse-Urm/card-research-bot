// Live-stream overlay: the card on screen in Shop → Live stream, what's next, and a "SOLD" banner for the last sale.
const $ = (id) => document.getElementById(id);
const money = (n) => (n == null ? "" : "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }));
let lastSold = "", soldTimer = null;
async function tick() {
  try {
    const d = await (await fetch("/api/live/overlay", { cache: "no-store" })).json();
    const c = d.now;
    $("card").classList.toggle("hidden", !c);
    if (c) {
      $("name").textContent = c.name;
      $("grade").textContent = c.grade;
      $("price").textContent = c.price != null ? `Starts at ${money(c.price)}` : "";
      $("next").textContent = d.next ? `Next: ${d.next.name}` : "";
      if (c.photo && $("photo").getAttribute("src") !== c.photo) $("photo").src = c.photo;
      $("photo").style.display = c.photo ? "" : "none";
    }
    const s = d.last ? `SOLD ${d.last.buyer ? "to @" + d.last.buyer + " " : ""}— ${money(d.last.price)}` : "";
    if (s && s !== lastSold) {
      if (lastSold) {
        $("sold").textContent = s;
        $("sold").classList.remove("hidden");
        clearTimeout(soldTimer);
        soldTimer = setTimeout(() => $("sold").classList.add("hidden"), 6000);
      }
      lastSold = s;
    }
  } catch {
    /* the app is restarting — try again */
  }
}
tick();
setInterval(tick, 1500);
