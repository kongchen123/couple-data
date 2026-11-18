#!/usr/bin/env node
/**
 * 前端通知逻辑测试
 *
 * 不做 DOM 渲染，只验证 index.html / sw.js 里的实现是否自洽：
 *   - VAPID 公钥格式与一致性
 *   - 私钥未泄漏
 *   - 关键 API 调用齐全
 *   - urlB64ToUint8Array 的真实转换结果
 *   - 语法正确
 *
 * 用法：node test-frontend.js
 */
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const sender = fs.readFileSync('scripts/send-push.js', 'utf8');
const keys = JSON.parse(fs.readFileSync('vapid-keys.json', 'utf8'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { console.log('  [PASS] ' + name); pass++; }
  else { console.log('  [FAIL] ' + name + (extra ? '  → ' + extra : '')); fail++; failures.push(name); }
}

function syntaxOk(content) {
  fs.writeFileSync('__syntax_tmp.js', content);
  try {
    execFileSync('node', ['--check', '__syntax_tmp.js'], { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  } finally {
    try { fs.unlinkSync('__syntax_tmp.js'); } catch (_) {}
  }
}

console.log('='.repeat(72));
console.log('前端通知逻辑测试');
console.log('='.repeat(72));
console.log('Node:', process.version);

/* ---------- 1. 语法 ---------- */
console.log('\n--- 1) 语法 ---');
const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let allOk = true;
blocks.forEach((b) => { if (!syntaxOk(b)) allOk = false; });
check(`index.html 的 ${blocks.length} 个 script 块语法正确`, allOk);
check('sw.js 语法正确', syntaxOk(sw));
check('scripts/send-push.js 语法正确', syntaxOk(sender));

/* ---------- 2. VAPID 公钥 ---------- */
console.log('\n--- 2) VAPID 公钥 ---');
const m = html.match(/const VAPID_PUBLIC_KEY = '([^']+)'/);
check('index.html 中定义了 VAPID_PUBLIC_KEY', !!m);
if (m) {
  const pub = m[1];
  check('公钥与 vapid-keys.json 一致', pub === keys.publicKey);

  const buf = Buffer.from(pub.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  check('公钥解码为 65 字节', buf.length === 65, '实际 ' + buf.length);
  check('公钥首字节为 0x04（未压缩格式）', buf[0] === 0x04);

  // base64url 不应含 + / =
  check('公钥是 base64url 格式（无 + / =）', !/[+/=]/.test(pub));
}

/* ---------- 3. 私钥不泄漏 ---------- */
console.log('\n--- 3) 私钥保密 ---');
check('私钥未出现在 index.html', !html.includes(keys.privateKey));
check('私钥未出现在 sw.js', !sw.includes(keys.privateKey));
check('私钥未出现在 send-push.js', !sender.includes(keys.privateKey));

// 反向检查：确认真的在检查（公钥应该出现，否则检查无效）
check('公钥确实出现在 index.html（证明检查有效）', html.includes(keys.publicKey));

/* ---------- 4. 前端订阅 API ---------- */
console.log('\n--- 4) 前端订阅 API ---');
check('调用 pushManager.subscribe', html.includes('pushManager.subscribe'));
check('userVisibleOnly: true', html.includes('userVisibleOnly: true'));
check('传 applicationServerKey', html.includes('applicationServerKey'));
check('Notification.requestPermission', html.includes('Notification.requestPermission'));
check('pushManager.getSubscription（避免重复订阅）', html.includes('pushManager.getSubscription'));
check('unsubscribe（退订）', html.includes('.unsubscribe()'));
check('serviceWorker.ready（等 SW 就绪）', html.includes('serviceWorker.ready'));

/* ---------- 5. iOS 特判 ---------- */
console.log('\n--- 5) iOS 特判 ---');
check('检测 navigator.standalone', html.includes('navigator.standalone'));
check("检测 display-mode: 'standalone'", html.includes("(display-mode: standalone)"));
check('非 standalone 时阻止订阅并提示', /isStandalone\(\)[\s\S]{0,200}添加到主屏幕/.test(html));
check('检测权限被拒绝状态', html.includes("perm === 'denied'") || html.includes("'denied'"));

/* ---------- 6. 安卓走 ntfy ---------- */
console.log('\n--- 6) 安卓分支 ---');
check('存在 isAndroid 分支', html.includes("isAndroid()") || html.includes('isAndroid()'));
check('安卓显示 ntfy 文案', html.includes('ntfy'));
check('安卓隐藏通知按钮', /isAndroid\(\)[\s\S]{0,600}btn\.style\.display\s*=\s*'none'/.test(html)
  || html.includes("使用 ntfy 接收通知"));

/* ---------- 7. 订阅存储 ---------- */
console.log('\n--- 7) 订阅存储 ---');
check("订阅路径为 push-subs.json", html.includes("'push-subs.json'"));
check('用 ghGet 读取订阅', html.includes('ghGet(') && html.includes('SUBS_PATH'));
check('用 ghPut 写入订阅', html.includes('ghPut(SUBS_PATH'));
check('按 endpoint 去重', html.includes('endpoint === sub.endpoint'));
check('列表上限控制', /list\.length\s*>\s*10/.test(html));

/* ---------- 8. Service Worker ---------- */
console.log('\n--- 8) Service Worker ---');
check("有 push 事件监听", sw.includes("addEventListener('push'"));
check('push 中调用 showNotification', /addEventListener\('push'[\s\S]{0,1200}showNotification/.test(sw));
check('showNotification 与 push 在同一个同步块（iOS 要求）',
  /addEventListener\('push'[\s\S]{0,600}waitUntil\([\s\S]{0,120}showNotification/.test(sw));
check("有 notificationclick 监听", sw.includes("addEventListener('notificationclick'"));
check('点击时优先聚焦已有窗口', sw.includes('clients.matchAll') && /focus\(\)/.test(sw));
check('无窗口时 openWindow', sw.includes('openWindow'));
check('缓存版本已升级到 v2', /const VERSION = 'v2'/.test(sw));
check('跨域请求不拦截（避免缓存脏数据）', sw.includes("url.origin !== self.location.origin"));

/* ---------- 9. urlB64ToUint8Array 实际转换 ---------- */
console.log('\n--- 9) urlB64ToUint8Array 行为 ---');
const fnMatch = html.match(/function urlB64ToUint8Array\(base64String\)\s*\{[\s\S]*?\n\}/);
check('找到 urlB64ToUint8Array 实现', !!fnMatch);
if (fnMatch) {
  try {
    const atobPoly = (s) => Buffer.from(s, 'base64').toString('binary');
    // 保留函数名（去掉名字会变成非法的匿名函数声明）
    const fn = new Function('atob', fnMatch[0] + '; return urlB64ToUint8Array;')(atobPoly);

    const out = fn(keys.publicKey);
    const expect = Buffer.from(keys.publicKey.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    check('转换结果长度为 65', out.length === 65, '实际 ' + out.length);
    check('转换结果与权威解码一致', Buffer.from(out).equals(expect));
    check('转换结果是 Uint8Array', out instanceof Uint8Array);

    // 各种长度余数（测试 padding 逻辑）
    for (const n of [1, 2, 3, 4, 5]) {
      const raw = crypto.randomBytes(n);
      const b64 = raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const r = fn(b64);
      if (Buffer.from(r).equals(raw)) {
        check(`padding 正确（输入 ${n} 字节）`, true);
      } else {
        check(`padding 正确（输入 ${n} 字节）`, false, '输出不匹配');
      }
    }
  } catch (e) {
    check('urlB64ToUint8Array 可执行', false, e.message);
  }
}

/* ---------- 10. 仓库指向 ---------- */
console.log('\n--- 10) 仓库配置 ---');
const dm = html.match(/const DEFAULT_GH = \{[^}]*repo: '([^']+)'/);
check('DEFAULT_GH.repo 指向私有仓库', dm && dm[1] === 'couple-data-private', dm ? dm[1] : '未找到');

console.log('\n' + '='.repeat(72));
console.log(`结果：通过 ${pass} / 失败 ${fail}`);
if (fail) {
  console.log('\n失败用例：');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(72));
process.exit(fail === 0 ? 0 : 1);
