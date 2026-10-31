/* EduVerse - service worker (mode offline)
   - Halaman game: ambil versi terbaru dari server; kalau tidak ada sinyal, pakai salinan terakhir di perangkat.
   - Font & gambar soal: disimpan setelah pertama kali dibuka agar tetap tampil saat offline.
   - Endpoint API (/kelas/, /paket/, /setelan, /admin/) dilewatkan langsung ke server. */
var V = "ev-v1", CORE = ["./", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable.png", "./apple-touch-icon.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return (k.indexOf("zv-") === 0 || k.indexOf("ev-") === 0) && k !== V && k !== "ev-aset"; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
function timeout(ms) { return new Promise(function (_, rej) { setTimeout(function () { rej(new Error("lambat")); }, ms); }); }
function networkFirst(req, key) {
  var net = fetch(req).then(function (r) {
    if (r && r.ok) { var cp = r.clone(); caches.open(V).then(function (c) { c.put(key || req, cp); }); }
    return r;
  });
  return Promise.race([net, timeout(5000)]).catch(function () {
    return caches.match(key || req, { ignoreSearch: true }).then(function (m) { return m || net; });
  });
}
function cacheFirst(req) {
  return caches.open("ev-aset").then(function (c) {
    return c.match(req).then(function (m) {
      if (m) return m;
      return fetch(req).then(function (r) {
        if (r && (r.ok || r.type === "opaque")) {
          c.put(req, r.clone()).catch(function () {});
          c.keys().then(function (ks) { if (ks.length > 60) c.delete(ks[0]); });
        }
        return r;
      });
    });
  });
}
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u = new URL(req.url);
  if (u.origin === location.origin) {
    if (/^\/(kelas|paket|setelan|admin|akun|guru|bank|murid|catat|dashboard|tantangan|main|pendamping)(\/|$)/.test(u.pathname) || /\/admin\.html$/.test(u.pathname)) return;
    if (req.mode === "navigate") { e.respondWith(networkFirst(req, "./")); return; }
    e.respondWith(networkFirst(req));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname) || req.destination === "image") { e.respondWith(cacheFirst(req)); return; }
});
