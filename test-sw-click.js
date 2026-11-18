/* sw.js 通知点击逻辑测试
 *
 * 背景：iOS 上点通知默认打开 Safari 而不是主屏 Web App。
 * 根因是 openWindow 收到「绝对 URL」时，WebKit 会把它当作外部链接
 * 路由给默认浏览器；只有 scope 内的相对路径才可能唤醒主屏 App。
 *
 * 本测试验证 toScopeRelative 的归一化行为，以及 notificationclick
 * 的处理顺序（先 navigate 后 focus）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) {
    pass++;
    console.log('  [PASS] ' + name);
  } else {
    fail++;
    failures.push(name + (extra ? ' :: ' + extra : ''));
    console.log('  [FAIL] ' + name + (extra ? ' :: ' + extra : ''));
  }
}

function eq(actual, expected, name) {
  ok(actual === expected, name, 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected));
}

// 用最小 shim 加载 sw.js，捕获注册的监听器
function loadSW(scope) {
  const listeners = {};
  const sandbox = {
    console,
    URL,
    Promise,
    self: {
      location: new URL(scope),
      registration: { scope, showNotification: async () => {} },
      addEventListener: (t, h) => { listeners[t] = h; },
      clients: { matchAll: async () => [], openWindow: async () => {} },
      skipWaiting: async () => {},
    },
    caches: {
      open: async () => ({ add: async () => {}, put: async () => {} }),
      keys: async () => [],
      match: async () => null,
      delete: async () => {},
    },
    fetch: async () => ({}),
    Request: class {},
    Response: class {},
    Headers: class {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { listeners, sandbox };
}

const SCOPE = 'https://kongchen123.github.io/couple-data/';

console.log('=== 1. sw.js 可加载 ===');
const { listeners, sandbox } = loadSW(SCOPE);
ok(typeof listeners.push === 'function', '注册了 push 监听');
ok(typeof listeners.notificationclick === 'function', '注册了 notificationclick 监听');
ok(typeof listeners.install === 'function', '注册了 install 监听');
ok(typeof listeners.fetch === 'function', '注册了 fetch 监听');

// 取出 toScopeRelative
const toScopeRelative = vm.runInContext('toScopeRelative', sandbox);
ok(typeof toScopeRelative === 'function', 'toScopeRelative 已定义');

console.log('\n=== 2. 绝对 URL → 相对路径（本次修复核心）===');
// 这是导致「打开 Safari」的直接原因：旧代码把绝对 URL 交给 openWindow
eq(toScopeRelative('https://kongchen123.github.io/couple-data/'), './',
  '站点根绝对 URL → ./');
eq(toScopeRelative('https://kongchen123.github.io/couple-data/index.html'), './index.html',
  'index.html 绝对 URL → ./index.html');
eq(toScopeRelative('https://kongchen123.github.io/couple-data/?a=1'), './?a=1',
  '带 query 的绝对 URL 保留 query');
eq(toScopeRelative('https://kongchen123.github.io/couple-data/#capsule'), './#capsule',
  '带 hash 的绝对 URL 保留 hash');

console.log('\n=== 3. 相对路径原样保留 ===');
eq(toScopeRelative('./'), './', "'./' 保持不变");
eq(toScopeRelative(''), './', '空字符串 → ./');
eq(toScopeRelative(null), './', 'null → ./');
eq(toScopeRelative(undefined), './', 'undefined → ./');
eq(toScopeRelative('index.html'), './index.html', '裸文件名 → ./index.html');
eq(toScopeRelative('./index.html'), './index.html', "'./index.html' 保持不变");

console.log('\n=== 4. 越界 URL 必须回落到 ./ ===');
eq(toScopeRelative('https://evil.example.com/x'), './', '跨域 URL → ./');
eq(toScopeRelative('https://kongchen123.github.io/other-app/'), './',
  '同域但 scope 外的路径 → ./');
eq(toScopeRelative('https://kongchen123.github.io/'), './',
  '同域根路径（scope 外）→ ./');
eq(toScopeRelative('javascript:alert(1)'), './', 'javascript: 伪协议 → ./');

console.log('\n=== 5. 历史被误写进 tag 的绝对 URL 也能纠正 ===');
// 旧版本曾把 URL 塞进 tag 作为 workaround，这里验证仍能正确处理
eq(toScopeRelative('https://kongchen123.github.io/couple-data/index.html'), './index.html',
  'tag 中的绝对 URL 被纠正为相对路径');

console.log('\n=== 6. 旧版 VERSION 已升级（确保客户端拿到新 SW）===');
const verMatch = SRC.match(/const VERSION = '([^']+)'/);
ok(!!verMatch, 'VERSION 常量存在');
ok(verMatch && verMatch[1] !== 'v2', 'VERSION 已从 v2 升级', 'got=' + (verMatch && verMatch[1]));

console.log('\n=== 7. notificationclick 调用顺序：先 navigate 后 focus ===');
const clickBody = SRC.slice(SRC.indexOf("addEventListener('notificationclick'"));
const idxNavigate = clickBody.indexOf('await c.navigate');
const idxFocus = clickBody.indexOf('await c.focus');
ok(idxNavigate > -1, '存在 navigate 调用');
ok(idxFocus > -1, '存在 focus 调用');
ok(idxNavigate < idxFocus, 'navigate 在 focus 之前（iOS 上顺序反了会丢失导航）',
  'navigate@' + idxNavigate + ' focus@' + idxFocus);

console.log('\n=== 8. preventDefault 已调用 ===');
ok(clickBody.indexOf('e.preventDefault') > -1,
  'notificationclick 中调用了 preventDefault（阻止 iOS 自行处理点击）');

console.log('\n=== 9. 点击时三级兜底取 URL ===');
ok(clickBody.indexOf('notification.data') > -1, '优先用 notification.data');
ok(clickBody.indexOf('notification.tag') > -1, 'data 丢失时回落到 tag');
ok(clickBody.indexOf("'./'") > -1, '最终回落到 ./');

console.log('\n=== 10. push 事件仍立即展示通知（iOS 硬性要求）===');
const pushBody = SRC.slice(SRC.indexOf("addEventListener('push'"), SRC.indexOf("addEventListener('notificationclick'"));
ok(pushBody.indexOf('showNotification') > -1, 'push 中调用 showNotification');
ok(pushBody.indexOf('await') === -1, 'push 中无 await（必须同步展示，否则 iOS 撤销权限）');

console.log('\n=== 11. 集成：模拟点击流程 ===');
(async () => {
  // 模拟：PWA 已有一个窗口，点通知应 navigate 到目标并 focus
  const calls = [];
  const fakeClient = {
    url: SCOPE + 'index.html',
    navigate: async (u) => { calls.push('navigate:' + u); },
    focus: async () => { calls.push('focus'); },
  };
  const sb = {
    console,
    URL,
    Promise,
    self: {
      location: new URL(SCOPE),
      registration: { scope: SCOPE, showNotification: async () => {} },
      addEventListener: (t, h) => { sb._l = sb._l || {}; sb._l[t] = h; },
      clients: {
        matchAll: async () => [fakeClient],
        openWindow: async (u) => { calls.push('openWindow:' + u); },
      },
      skipWaiting: async () => {},
    },
    caches: { open: async () => ({ add: async () => {}, put: async () => {} }), keys: async () => [], match: async () => null, delete: async () => {} },
    fetch: async () => ({}),
    Request: class {},
    Response: class {},
    Headers: class {},
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(SRC, sb);

  let waited = null;
  const ev = {
    notification: { close: () => calls.push('close'), data: { url: './index.html' }, tag: 'couple-update' },
    preventDefault: () => calls.push('preventDefault'),
    waitUntil: (p) => { waited = p; },
  };
  sb._l.notificationclick(ev);
  if (waited) await waited;

  ok(calls.indexOf('preventDefault') > -1, '集成：调用了 preventDefault');
  ok(calls.indexOf('navigate:./index.html') > -1, '集成：navigate 到相对路径',
    JSON.stringify(calls));
  ok(calls.indexOf('openWindow:./index.html') === -1, '集成：有已有窗口时不调 openWindow');

  // 关键：绝不能把绝对 URL 交给 navigate/openWindow
  const badCall = calls.find((c) => c.indexOf('https://') > -1);
  ok(!badCall, '集成：没有任何调用携带绝对 URL（这正是打开 Safari 的原因）',
    badCall || '');

  console.log('\n=== 12. 集成：无已开窗口时用相对路径 openWindow ===');
  const calls2 = [];
  const sb2 = {
    console, URL, Promise,
    self: {
      location: new URL(SCOPE),
      registration: { scope: SCOPE, showNotification: async () => {} },
      addEventListener: (t, h) => { sb2._l = sb2._l || {}; sb2._l[t] = h; },
      clients: { matchAll: async () => [], openWindow: async (u) => { calls2.push('openWindow:' + u); } },
      skipWaiting: async () => {},
    },
    caches: { open: async () => ({ add: async () => {}, put: async () => {} }), keys: async () => [], match: async () => null, delete: async () => {} },
    fetch: async () => ({}), Request: class {}, Response: class {}, Headers: class {},
  };
  sb2.globalThis = sb2;
  vm.createContext(sb2);
  vm.runInContext(SRC, sb2);

  let w2 = null;
  sb2._l.notificationclick({
    notification: { close: () => {}, data: { url: './' }, tag: 't' },
    preventDefault: () => {},
    waitUntil: (p) => { w2 = p; },
  });
  if (w2) await w2;
  ok(calls2.length === 1, '集成：无窗口时调用一次 openWindow', JSON.stringify(calls2));
  ok(calls2[0] === 'openWindow:./', '集成：openWindow 收到相对路径 ./',
    JSON.stringify(calls2));

  console.log('\n' + '='.repeat(56));
  console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项');
  if (fail) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(56));
  process.exit(fail ? 1 : 0);
})();
