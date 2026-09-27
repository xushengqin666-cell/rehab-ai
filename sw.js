// Service Worker â€” ç¦»çº¿ç­–ç•¥ï¼š
//   Â· é¡µé¢/JS/CSS ç½‘ç»œä¼˜å…ˆï¼ˆæ›´æ–°åŠæ—¶ç”Ÿæ•ˆï¼‰ï¼Œç¦»çº¿æ—¶å›žé€€ç¼“å­˜
//   Â· å¤§æ–‡ä»¶ï¼ˆwasm / æ¨¡åž‹ / vendor åº“ / å›¾æ ‡ï¼‰ç¼“å­˜ä¼˜å…ˆï¼ˆçœæµé‡ã€ç¦»çº¿å¯ç”¨ï¼‰
const CACHE = 'rehab-v2.41.0';
const PRECACHE = ['./', './index.html', './style.css', './demo.css', './app.js', './analysis.js', './demo.js', './ai.js', './i18n.js', './manifest.json', './icon-192.png', './icon-512.png'];
const CACHE_FIRST = ['./vision_bundle.mjs', './vendor/qrcode.js', './vendor/jsqr.js', './pose_landmarker_full.task',
  './demo-media/squat.gif', './demo-media/lunge.gif', './demo-media/stepup.gif', './demo-media/shoulderraise.gif',
  './demo-media/wallpushup.gif', './demo-media/biceps.gif', './demo-media/kneeext.gif', './demo-media/backext.gif',
  './demo-media/backstretch.gif', './demo-media/cheststretch.gif', './demo-media/hamstringstretch.gif', './demo-media/quadstretch.gif',
  './demo-media/grip.gif', './demo-media/fingermarch.gif',
  './demo-media/backext.gif', './demo-media/chestpress.gif', './demo-media/hipabduction.gif', './demo-media/kneecurl.gif',
  './demo-media/pelvictilt.gif', './demo-media/toestand.gif', './demo-media/uprightrow.gif', './demo-media/fingermarch2.gif',
  './demo-media/plank.jpg'];
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
  if (url.origin !== location.origin) return;   // è·¨åŸŸï¼ˆjsDelivr/Google æ¨¡åž‹é•œåƒï¼‰èµ°ç½‘ç»œ
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
