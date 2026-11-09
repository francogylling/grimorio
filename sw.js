// Grimorio: abre sin internet usando la última versión guardada.
// Siempre intenta bajar la versión nueva primero, así las actualizaciones llegan solas.
const CACHE = "grimorio-v17";
const IMG = "grimorio-img"; // imágenes de cartas guardadas para usar sin internet
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== IMG).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method === "GET" && u.hostname === "cards.scryfall.io") { e.respondWith(cardImage(e.request)); return; }
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // Scryfall y fuentes van directo a internet
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
// Avisos en el celular: los manda GitHub (scripts/avisos.mjs) y aquí se muestran.
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Grimorio", { body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: d.tag || undefined, data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => x.url.startsWith(self.registration.scope));
    if (w) return w.focus().then(f => (f || w).navigate ? (f || w).navigate(url).catch(() => {}) : null);
    return self.clients.openWindow(url);
  }));
});
// Imágenes de cartas: primero las guardadas; si no, se bajan y se guardan. Sin internet, la versión chica sirve para la grande.
let imgPuts = 0;
async function cardImage(req) {
  const c = await caches.open(IMG), key = req.url;
  const hit = await c.match(key); if (hit) return hit;
  try {
    const r = await fetch(key, { mode: "cors", credentials: "omit" });
    if (r.ok) { c.put(key, r.clone()); if (++imgPuts % 100 === 0) c.keys().then(ks => ks.slice(0, Math.max(0, ks.length - 8000)).forEach(k => c.delete(k))); }
    return r;
  } catch (err) {
    const alt = key.replace(/\/(normal|large|png|border_crop)\//, "/small/");
    const h2 = alt !== key && await c.match(alt, { ignoreSearch: true }); if (h2) return h2;
    try { return await fetch(req); } catch (e2) { return Response.error(); }
  }
}
