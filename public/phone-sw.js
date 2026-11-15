// The phone scanner with no signal (3.20): the page served by the MJC store (/scan/) is kept on the phone, so it opens
// on the road with no Wi-Fi or cell signal. Pictures taken then wait in the page's own queue (IndexedDB) and go up by
// themselves when the signal is back. Only the page's own files are kept — never a call to the store (the scanner's
// answers, uploads, adds always go to the network).
// Golden rule: nothing else keeps this page offline; the bot's own copy (/phone, home Wi-Fi) doesn't use this file.
const CACHE = "card-scanner-1";
const SHELL = ["./", "phone.js", "apple-touch-icon.png", "icon.svg"];
const isShell = (u) => u.origin === self.location.origin && /\/scan\/(phone\.js|apple-touch-icon\.png|icon\.svg)?$/.test(u.pathname);

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || !isShell(u)) return;
  // the network first (a new version shows at once), the kept copy when there's no signal or it's too slow to wait for
  const key = u.pathname; // one copy whatever the address's ?s= key
  const fresh = fetch(e.request).then((r) => {
    if (r.ok) {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
    }
    return r;
  });
  const slow = new Promise((ok) => setTimeout(ok, 4000)).then(() => caches.match(key));
  e.respondWith(
    Promise.race([fresh.catch(() => caches.match(key)), slow.then((r) => r || fresh)]).then((r) => r || fresh),
  );
});
