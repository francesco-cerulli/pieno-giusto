// Service worker: rete prima di tutto (così i prezzi sono sempre quelli nuovi),
// copia salvata come riserva quando manca la connessione.
const CACHE = "pumpy-v25";
const BASE = ["./", "index.html", "manifest.webmanifest", "icone/icona-192.png", "icone/icona-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // solo i file del sito: mappe, font e librerie esterne restano alla cache del browser
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    // no-cache: chiede sempre al server se c'è una versione nuova (niente copie vecchie della cache HTTP)
    // (le richieste di pagina non si possono ricopiare con opzioni: si rifanno dall'indirizzo)
    fetch(e.request.mode === "navigate" ? e.request.url : e.request, { cache: "no-cache" }).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// --- Avvisi: notifiche mandate dal servizio Pumpy (al massimo una al giorno) ---
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Pumpy", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Pumpy", {
    body: d.body || "", icon: "icone/icona-192.png", badge: "icone/badge-96.png",
    tag: d.tag || "pumpy", renotify: false, data: { url: new URL(d.url || "./", self.registration.scope).href },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((finestre) => {
    for (const f of finestre) if (f.url.startsWith(self.registration.scope) && "focus" in f) return f.navigate(url).then((c) => (c || f).focus());
    return self.clients.openWindow(url);
  }));
});
