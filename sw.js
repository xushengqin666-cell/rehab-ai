// Service Worker Ã¢â‚¬â€ Ã§Â¦Â»Ã§ÂºÂ¿Ã§Â­â€“Ã§â€¢Â¥Ã¯Â¼Å¡
//   Ã‚Â· Ã©Â¡ÂµÃ©ÂÂ¢/JS/CSS Ã§Â½â€˜Ã§Â»Å“Ã¤Â¼ËœÃ¥â€¦Ë†Ã¯Â¼Ë†Ã¦â€ºÂ´Ã¦â€“Â°Ã¥ÂÅ Ã¦â€”Â¶Ã§â€Å¸Ã¦â€¢Ë†Ã¯Â¼â€°Ã¯Â¼Å’Ã§Â¦Â»Ã§ÂºÂ¿Ã¦â€”Â¶Ã¥â€ºÅ¾Ã©â‚¬â‚¬Ã§Â¼â€œÃ¥Â­Ëœ
//   Ã‚Â· Ã¥Â¤Â§Ã¦â€“â€¡Ã¤Â»Â¶Ã¯Â¼Ë†wasm / Ã¦Â¨Â¡Ã¥Å¾â€¹ / vendor Ã¥Âºâ€œ / Ã¥â€ºÂ¾Ã¦Â â€¡Ã¯Â¼â€°Ã§Â¼â€œÃ¥Â­ËœÃ¤Â¼ËœÃ¥â€¦Ë†Ã¯Â¼Ë†Ã§Å“ÂÃ¦ÂµÂÃ©â€¡ÂÃ£â‚¬ÂÃ§Â¦Â»Ã§ÂºÂ¿Ã¥ÂÂ¯Ã§â€Â¨Ã¯Â¼â€°
const CACHE = 'rehab-v2.42.0';
const PRECACHE = ['./', './index.html', './style.css', './demo.css', './app.js', './analysis.js', './demo.js', './ai.js', './i18n.js', './manifest.json', './icon-192.png', './icon-512.png'];
const CACHE_FIRST = ['./vision_bundle.mjs', './vendor/qrcode.js', './vendor/jsqr.js', './pose_landmarker_full.task',
  './demo-media/squat.gif', './demo-media/lunge.gif', './demo-media/stepup.gif', './demo-media/shoulderraise.gif',
  './demo-media/wallpushup.gif', './demo-media/biceps.gif', './demo-media/kneeext.gif', './demo-media/backext.gif',
  './demo-media/backstretch.gif', './demo-media/cheststretch.gif', './demo-media/hamstringstretch.gif', './demo-media/quadstretch.gif',
  './demo-media/grip.gif', './demo-media/fingermarch.gif',
  './demo-media/backext.gif', './demo-media/chestpress.gif', './demo-media/hipabduction.gif', './demo-media/kneecurl.gif',
  './demo-media/pelvictilt.gif', './demo-media/toestand.gif', './demo-media/uprightrow.gif', './demo-media/fingermarch2.gif',
  './demo-media/plank.jpg', './demo-media/bridge.jpg', './demo-media/bridge2.jpg'];
const scopePath = new URL(self.registration.scope).pathname;
const relPath = (url) => (url.pathname.startsWith(scopePath) ? '/' + url.pathname.slice(scopePath.length) : url.pathname);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // Ã¨Â·Â¨Ã¥Å¸Å¸Ã¯Â¼Ë†jsDelivr/Google Ã¦Â¨Â¡Ã¥Å¾â€¹Ã©â€¢Å“Ã¥Æ’ÂÃ¯Â¼â€°Ã¨ÂµÂ°Ã§Â½â€˜Ã§Â»Å“
  const rel = relPath(url);
  const cacheFirst = CACHE_FIRST.includes(rel) || rel.startsWith('/wasm/');
  if (cacheFirst) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }))
    );
  } else {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
