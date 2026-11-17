/* 情侣小站 Service Worker：离线可用 + 秒开
   策略：
   - 页面导航：网络优先（保证能拿到最新版），断网回落缓存
   - 图标/manifest 等静态资源：缓存优先，后台静默更新
   - 跨域请求（GitHub API、情话接口、照片）：完全不拦截，避免缓存脏数据 */
const VERSION = 'v1';
const CACHE = 'couple-shell-' + VERSION;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('couple-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isPage = (req, url) =>
  req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // 跨域一律走网络，不缓存 API 数据

  if (isPage(req, url)) {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const cp = r.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', cp)).catch(() => {});
          return r;
        })
        .catch(() =>
          caches.match('./index.html').then((hit) => hit || caches.match('./')).then((hit) =>
            hit || new Response('<!doctype html><meta charset="utf-8"><title>情侣小站</title><body style="font-family:sans-serif;padding:40px;text-align:center;color:#a08a92">离线中，且暂无本地缓存<br><br>请联网后重新打开</body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
          )
        )
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // 缓存命中走后台更新，下次打开即最新
        fetch(req).then((r) => { if (r && r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone())); }).catch(() => {});
        return hit;
      }
      return fetch(req).then((r) => {
        if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)).catch(() => {}); }
        return r;
      });
    })
  );
});
