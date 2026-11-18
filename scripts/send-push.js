#!/usr/bin/env node
/**
 * Web Push 发送器（零依赖，仅用 node:crypto + fetch）
 *
 * 运行环境：GitHub Actions（Node 20+）。为兼容本地 Node 16/18 也内置了 fetch 回退。
 * 输入：
 *   - 环境变量 VAPID_PRIVATE_KEY（base64url，来自 Secrets）
 *   - 环境变量 VAPID_PUBLIC_KEY （base64url，可硬编码）
 *   - 环境变量 VAPID_SUBJECT    （mailto: 或 https URL）
 *   - push-subs.json（订阅列表）
 * 输出：逐个发送，打印结果；过期订阅（404/410）会被移除并写回文件
 *
 * 实现依据 RFC 8291（aes128gcm 加密）+ RFC 8292（VAPID）
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');

const SUBS_FILE = process.env.SUBS_FILE || 'push-subs.json';
const VAPID_PRIVATE = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_PUBLIC = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:noreply@example.com').trim();

const TITLE = process.env.PUSH_TITLE || 'TA 更新了小站 ❤';
const BODY = process.env.PUSH_BODY || '点开看看有什么新内容';
const URL_TO_OPEN = process.env.PUSH_URL || './';
const ONLY_WHO = (process.env.PUSH_ONLY_WHO || '').trim(); // '1'/'2'，空=全部

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function b64uDecodeStrict(s, expectLen, name) {
  const b = fromB64u(s);
  if (expectLen && b.length !== expectLen) {
    throw new Error(`${name} 长度不对：期望 ${expectLen}，实际 ${b.length}`);
  }
  return b;
}

/** 极简 fetch 回退（Node < 18 没有全局 fetch） */
function simpleFetch(url, opt) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opt.method || 'GET',
      headers: opt.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(buf.toString('utf8')),
        });
      });
    });
    req.on('error', reject);
    if (opt.body) req.write(opt.body);
    req.end();
  });
}

const doFetch = (typeof fetch === 'function') ? fetch : simpleFetch;

/** RFC 8291：用订阅公钥 + auth secret 加密 payload，返回 aes128gcm 格式 body */
function encryptPayload(payloadStr, p256dhB64u, authB64u, forcedKeys) {
  const uaPublic = b64uDecodeStrict(p256dhB64u, 65, 'p256dh');
  const authSecret = b64uDecodeStrict(authB64u, 16, 'auth');

  // 1) 生成临时 ECDH 密钥对（测试时可传入固定值）
  const ecdh = crypto.createECDH('prime256v1');
  if (forcedKeys && forcedKeys.asPrivate) {
    ecdh.setPrivateKey(fromB64u(forcedKeys.asPrivate));
  } else {
    ecdh.generateKeys();
  }
  const asPublic = ecdh.getPublicKey();               // 65 字节未压缩
  const sharedSecret = ecdh.computeSecret(uaPublic);  // 32 字节

  // 2) HKDF 派生 IKM（RFC 8291 §3.4）
  const authInfo = Buffer.concat([
    Buffer.from('WebPush: info\x00', 'utf8'),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, authInfo, 32));

  // 3) 生成 salt，再派生 CEK 与 NONCE
  const salt = (forcedKeys && forcedKeys.salt) ? fromB64u(forcedKeys.salt) : crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\x00', 'utf8'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\x00', 'utf8'), 12));

  // 4) 明文 = payload + 0x02（最后一条记录分隔符）
  const plaintext = Buffer.concat([Buffer.from(payloadStr, 'utf8'), Buffer.from([0x02])]);

  // 5) AES-128-GCM
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // 6) aes128gcm 头：salt(16) | rs(4) | idlen(1) | keyid(65) | ciphertext+tag
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ciphertext, tag]);
}

/** RFC 8292：生成 VAPID Authorization 头 */
function vapidHeader(endpoint, privateKeyB64u, publicKeyB64u, subject) {
  const audience = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // 上限 24h，取 12h 更安全
    sub: subject,
  };
  const enc = (o) => b64u(Buffer.from(JSON.stringify(o), 'utf8'));
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const pub = fromB64u(publicKeyB64u);
  const keyObj = crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: privateKeyB64u,
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: 'jwk',
  });
  // ES256 需要原始 r||s（IEEE P1363），不是 DER
  const sig = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: keyObj,
    dsaEncoding: 'ieee-p1363',
  });

  return `vapid t=${signingInput}.${b64u(sig)}, k=${publicKeyB64u}`;
}

async function sendOne(sub) {
  const endpoint = sub.endpoint;
  const payload = JSON.stringify({
    title: TITLE,
    body: BODY,
    url: URL_TO_OPEN,
    tag: 'couple-update',
  });
  const body = encryptPayload(payload, sub.keys.p256dh, sub.keys.auth);

  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': vapidHeader(endpoint, VAPID_PRIVATE, VAPID_PUBLIC, VAPID_SUBJECT),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'high',
    },
    body,
  });

  return { status: res.status, text: res.status >= 400 ? (await res.text()).slice(0, 200) : '' };
}

async function main() {
  if (!VAPID_PRIVATE || !VAPID_PUBLIC) {
    console.error('[FAIL] 缺少 VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY');
    process.exit(1);
  }
  if (!fs.existsSync(SUBS_FILE)) {
    console.log(`[SKIP] ${SUBS_FILE} 不存在，没有订阅者`);
    process.exit(0);
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
  } catch (e) {
    console.error('[FAIL] 订阅文件解析失败:', e.message);
    process.exit(1);
  }

  // originalSubs 保留完整列表：被 ONLY_WHO 排除的订阅只是「本次不发」，
  // 绝不能从文件里删掉，否则本人改一次自己的订阅就没了
  const originalSubs = Array.isArray(doc.subs) ? doc.subs.slice() : [];
  let subs = originalSubs;
  const total = subs.length;
  if (ONLY_WHO) {
    subs = subs.filter((s) => String(s.who) !== ONLY_WHO);
    console.log(`[i] 排除 who=${ONLY_WHO} 的订阅：${total} -> ${subs.length}`);
  } else {
    console.log(`[i] 待发送订阅数：${subs.length}`);
  }

  if (!subs.length) {
    console.log('[SKIP] 没有需要通知的订阅');
    process.exit(0);
  }

  const gone = [];
  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    const tag = `who=${sub.who || '?'} ${sub.device || '?'} ${String(sub.endpoint).slice(0, 48)}…`;
    try {
      const r = await sendOne(sub);
      if (r.status >= 200 && r.status < 300) {
        console.log(`  [OK]   ${r.status}  ${tag}`);
        sent++;
      } else if (r.status === 404 || r.status === 410) {
        console.log(`  [GONE] ${r.status}  ${tag}  -> 订阅已失效，移除`);
        gone.push(sub.endpoint);
        failed++;
      } else {
        console.log(`  [FAIL] ${r.status}  ${tag}  ${r.text}`);
        failed++;
      }
    } catch (e) {
      console.log(`  [ERR]  ${tag}  ${e.message}`);
      failed++;
    }
  }

  console.log();
  console.log(`[汇总] 成功 ${sent} / 失败 ${failed} / 过期 ${gone.length}`);

  // 移除失效订阅，写回文件供后续 commit
  // 基准是 originalSubs（含本次未发送的），只删真正失效的 endpoint
  if (gone.length) {
    doc.subs = originalSubs.filter((s) => !gone.includes(s.endpoint));
    fs.writeFileSync(SUBS_FILE, JSON.stringify(doc, null, 2), 'utf8');
    console.log(`[i] 已从 ${SUBS_FILE} 移除 ${gone.length} 条失效订阅，剩余 ${doc.subs.length} 条`);
  }

  // 全部失败才报错退出（部分失败不影响）
  if (sent === 0 && failed > 0) {
    console.error('[FAIL] 所有订阅都发送失败');
    process.exit(1);
  }
}

// 作为脚本直接运行时执行；被 require 时只导出函数（便于测试）
if (require.main === module) {
  main().catch((e) => {
    console.error('[FATAL]', e);
    process.exit(1);
  });
}

module.exports = { encryptPayload, vapidHeader, b64u, fromB64u };
