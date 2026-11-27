/* 情侣小站 Service Worker：离线可用 + 秒开 + Web Push
   策略：
   - 页面导航：网络优先（保证能拿到最新版），断网回落缓存
   - 图标/manifest 等静态资源：缓存优先，后台静默更新
   - 跨域请求（GitHub API、情话接口、照片）：完全不拦截，避免缓存脏数据
   - push 事件：显示通知（iOS 要求必须立即 showNotification，否则收回推送权限）
   - notificationclick：优先聚焦已打开的同源窗口，否则新开 */
// 改 index.html 时务必同步改这里：否则老设备会继续跑缓存里的旧页面，
// 表象是「数据不见了」（新旧版存储键不同），极易被误判成数据损坏。
const VERSION = 'v28';
const CACHE = 'couple-shell-' + VERSION;
// 软考模块（exam-data / exam-notes / notes / exam 共约 291 KB）不入预缓存：
// 它们由 index.html 的 ensureExamLoaded() 在进入「软考高项」时按需注入，
// 但仍走本 SW 的 fetch 分支，首次加载后会进缓存，离线依然可用。
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

/* ================= Web Push ================= */
// iOS 要求：收到 push 必须立即展示通知，否则 Safari 会撤销该站点的推送权限。
// 因此这里同步拿到数据就 showNotification，不做任何异步等待。
// 把任意 URL 归一化成「相对 scope 的路径」。
// iOS 上给 openWindow 传绝对 URL 会被当成外部链接路由到 Safari，
// 传 scope 内的相对路径才有机会唤醒主屏 Web App。
function toScopeRelative(raw) {
  const fallback = './';
  if (!raw) return fallback;
  try {
    const scope = self.registration.scope; // https://host/couple-data/
    const base = new URL(scope);
    const u = new URL(raw, scope);
    if (u.origin !== base.origin) return fallback;
    if (u.pathname.indexOf(base.pathname) !== 0) return fallback;
    const rest = u.pathname.slice(base.pathname.length) + u.search + u.hash;
    return rest ? './' + rest : fallback;
  } catch (_) {
    return fallback;
  }
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  const title = d.title || 'TA 更新了小站 ❤';
  const body = d.body || '点开看看有什么新内容';
  const target = toScopeRelative(d.url);
  const opts = {
    body,
    icon: './icons/icon-192.png',
    // iOS 上 notification.data 偶发丢失，tag 反而可靠；
    // 同时 tag 相同会覆盖旧通知，正好只保留最新一条。
    tag: d.tag || 'couple-update',
    renotify: true,
    data: {
      url: target,
      // 兜底：万一只剩 tag 可用，从 tag 里也能取回目标地址
      urlFromTag: target,
    },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  // iOS 上不调 preventDefault 的话，系统会用自己的方式处理点击
  // （往往直接丢给 Safari），导致主屏 Web App 收不到这次导航。
  if (e.preventDefault) e.preventDefault();

  // iOS 上 notification.data 可能拿不到，三级兜底
  const data = e.notification.data || {};
  const target = toScopeRelative(
    data.url ||
    (e.notification.tag && e.notification.tag.indexOf('./') === 0 ? e.notification.tag : null) ||
    './'
  );

  e.waitUntil(
    (async () => {
      const scope = self.registration.scope;
      let all = [];
      try {
        all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      } catch (_) { all = []; }

      // 优先复用已在运行的同源窗口（主屏 Web App 或已开的标签页）
      for (const c of all) {
        if (c.url.indexOf(scope) !== 0 && c.url.indexOf(self.location.origin) !== 0) continue;
        try {
          // 顺序很关键：先 navigate 再 focus。
          // iOS 上先 focus 会让后续 navigate 丢失，这是已知的 WebKit 行为。
          if (c.navigate && target !== './') await c.navigate(target);
          if ('focus' in c) await c.focus();
          return;
        } catch (_) { /* 换下一个 client 继续试 */ }
      }

      // 没有已运行窗口：用相对路径请求打开。
      // scope 内的相对路径才有机会被 iOS 路由进主屏 Web App；
      // 绝对 URL 会被当成外部链接交给默认浏览器。
      if (self.clients.openWindow) {
        try { await self.clients.openWindow(target); } catch (_) {
          try { await self.clients.openWindow('./'); } catch (_) {}
        }
      }
    })()
  );
});

// iOS 在部分情况下会先发 pushsubscriptionchange，这里仅记录，具体重订阅由页面下次打开时补
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(Promise.resolve());
});
