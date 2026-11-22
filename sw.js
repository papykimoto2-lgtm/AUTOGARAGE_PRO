/* Service worker minimal : réseau d'abord, cache en secours (hors ligne). */
var CACHE = 'autogarage-v14';
var SHELL = ['./', 'index.html', 'aujourdhui.js', 'cloud.js', 'sync.js', 'aide.js', 'aide.css', 'install.js', 'install.css', 'login.css', 'pagination.css', 'pagination.js', 'integrite.js', 'finance.js', 'finance.css', 'liens.js','caisse.js', 'compta.js', 'validations.js','etats.js','pilotage.js','qr.js','impression.js','verif.html', 'integrite.css', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'demo.html', 'aujourdhui.css', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; /* API Supabase, CDN : jamais en cache */
  e.respondWith(fetch(req).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
    return res;
  }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); }));
});
