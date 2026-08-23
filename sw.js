// Service Worker — 离线策略：
//   · 页面/JS/CSS 网络优先（更新及时生效），离线时回退缓存
//   · 大文件（wasm / 模型 / vendor 库 / 图标）缓存优先（省流量、离线可用）
const CACHE = 'rehab-v2.8';
const PRECACHE = ['./', './index.html', './style.css', './app.js', './analysis.js', './ai.js', './i18n.js', './manifest.json', './icon-192.png', './icon-512.png'];
const CACHE_FIRST = ['./vision_bundle.mjs', './vendor/qrcode.js', './vendor/jsqr.js', './pose_landmarker_full.task'];
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
  if (url.origin !== location.origin) return;   // 跨域（jsDelivr/Google 模型镜像）走网络
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
