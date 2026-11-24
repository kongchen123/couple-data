#!/usr/bin/env node
/**
 * 校验 notes.js 的 Markdown 渲染器
 * 1) 语法检查（vm 编译）
 * 2) 用真实资料跑一遍渲染，检查表格/标题/列表/粗体的产出
 * 3) 检查 HTML 标签是否配平、有无未转义的 < >
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const NOTES_JS = path.join(ROOT, 'notes.js');
const PACK_JS = path.join(ROOT, 'exam-notes.js');

// md 源统计：作为《实际值》的基准，避免把数字写死后每次加篇章都要改测试
const SRC_DIR = path.join(ROOT, '软考资料');
const mdFiles = fs.readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.md'));
const mdFileCount = mdFiles.length;
const mdTableCount = mdFiles.reduce((n, f) => {
  const t = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  // 表格分隔行 |---|:--:| 每个表格恰好一行（“外面有竖线 + 内部只有 -:空格”），
  // 不会误伤普通数据行
  return n + (t.match(/^\s*\|[-:\s|]+\|\s*$/gm) || []).length;
}, 0);

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; bad.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

// ---- 1. 编译检查 ----
console.log('=== 1. 语法检查 ===');
const src = fs.readFileSync(NOTES_JS, 'utf8');
try { new vm.Script(src, { filename: 'notes.js' }); ok('notes.js 可编译', true); }
catch (e) { ok('notes.js 可编译', false, e.message); }

const packSrc = fs.readFileSync(PACK_JS, 'utf8');
try { new vm.Script(packSrc, { filename: 'exam-notes.js' }); ok('exam-notes.js 可编译', true); }
catch (e) { ok('exam-notes.js 可编译', false, e.message); }

// ---- 2. 在沙箱里跑 ----
console.log('\n=== 2. 加载数据 + 渲染 ===');
const sandbox = { console, document: undefined, window: undefined };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(packSrc, sandbox, { filename: 'exam-notes.js' });
// const/let 是词法声明，不挂到 globalThis，要用表达式取
const get = (expr) => vm.runInContext(expr, sandbox);
const EXAM_NOTES = get('EXAM_NOTES');
ok('EXAM_NOTES 已定义', Array.isArray(EXAM_NOTES), '类型: ' + typeof EXAM_NOTES);
ok('篇数 = md 源文件数', EXAM_NOTES.length === mdFileCount, '包装: ' + EXAM_NOTES.length + ' / md 源: ' + mdFileCount);

// 加载渲染器（跳过 UI 部分，只取纯函数）
vm.runInContext(src, sandbox, { filename: 'notes.js' });
const ntRender = get('ntRender');
const ntInline = get('ntInline');
ok('ntRender 为函数', typeof ntRender === 'function');
ok('ntInline 为函数', typeof ntInline === 'function');

// 行内渲染
console.log('\n=== 3. 行内语法 ===');
ok('粗体', ntInline('**粗体**') === '<b>粗体</b>', ntInline('**粗体**'));
ok('行内代码', /<code>WV<\/code>/.test(ntInline('`WV`')), ntInline('`WV`'));
ok('代码内不被当粗体', /<code>\*\*x\*\*<\/code>/.test(ntInline('`**x**`')), ntInline('`**x**`'));
ok('转义尖括号', ntInline('<script>').indexOf('&lt;script&gt;') >= 0, ntInline('<script>'));
ok('链接', /<a href="https:\/\/a\.b"/.test(ntInline('[文字](https://a.b)')));

// 块级渲染
console.log('\n=== 4. 块级语法 ===');
const tTb = ntRender('| A | B |\n| --- | --- |\n| 1 | 2 |', true);
ok('表格生成 table', /<table class="nt-tb">/.test(tTb));
ok('表格有 thead/tbody', /<thead>/.test(tTb) && /<tbody>/.test(tTb));
ok('表格单元格数正确', (tTb.match(/<td/g) || []).length === 2, 'td数=' + (tTb.match(/<td/g) || []).length);

const tH = ntRender('## 一、标题\n### 8.1 小节', true);
ok('H2 转 h3', /<h3 class="nt-h2">一、标题<\/h3>/.test(tH), tH);
ok('H3 转 h4', /<h4 class="nt-h3">8\.1 小节<\/h4>/.test(tH));

const tQ = ntRender('> 引用行\n> 第二行', true);
ok('引用', /<div class="nt-quote">引用行<br>第二行<\/div>/.test(tQ), tQ);

const tL = ntRender('- 甲\n- 乙\n  - 子项', true);
ok('无序列表', /<ul class="nt-list">/.test(tL));
ok('嵌套子列表', /nt-sub/.test(tL));

const tO = ntRender('1. 第一条\n2. 第二条', true);
ok('有序列表', /<ol class="nt-list">/.test(tO), tO.slice(0, 120));

const tC = ntRender('```\ncode **not bold**\n```', true);
ok('代码块', /<pre class="nt-pre"><code>/.test(tC));
ok('代码块内不解析粗体', tC.indexOf('<b>') < 0, tC);

const tSkip = ntRender('# 标题\n正文', true);
ok('skipFirstH1 生效', tSkip.indexOf('标题') < 0, tSkip);
const tKeep = ntRender('# 标题\n正文', false);
ok('skipFirstH1=false 保留 H1', /<h3 class="nt-h2">标题<\/h3>/.test(tKeep), tKeep);

const tDet = ntRender('<details>\n<summary>答案</summary>\n内容\n</details>', true);
ok('details 直通', /<details>/.test(tDet) && /<\/details>/.test(tDet), tDet);

// ---- 5. 真实资料全量渲染 ----
console.log('\n=== 5. 真实资料全量渲染（' + EXAM_NOTES.length + ' 篇）===');
let totalTb = 0, totalH = 0, totalLi = 0, unbal = [], suspicious = [];
EXAM_NOTES.forEach(n => {
  const html = ntRender(n.md, true);
  const tb = (html.match(/<table class="nt-tb"/g) || []).length;
  const hs = (html.match(/<h[345] class="nt-h/g) || []).length;
  const li = (html.match(/<li>/g) || []).length;
  totalTb += tb; totalH += hs; totalLi += li;

  // 标签配平
  const chk = (tag) => {
    const o = (html.match(new RegExp('<' + tag + '[ >]', 'g')) || []).length;
    const c = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    if (o !== c) unbal.push(n.id + ' <' + tag + '> ' + o + '/' + c);
  };
  ['table', 'thead', 'tbody', 'tr', 'ul', 'ol', 'pre', 'div', 'p'].forEach(chk);

  // 残留的 md 标记（说明有语法没被处理）
  if (/^\s*\|/m.test(html)) suspicious.push(n.id + ' 残留 | 开头行');
  if (/\*\*/.test(html.replace(/<code>[\s\S]*?<\/code>/g, ''))) suspicious.push(n.id + ' 残留 **');

  console.log('  ' + (n.id + '        ').slice(0, 9) + n.title.slice(0, 20).padEnd(22) +
    'table=' + ('  ' + tb).slice(-2) + '  h=' + ('  ' + hs).slice(-2) + '  li=' + ('  ' + li).slice(-3) +
    '  ' + (html.length / 1024).toFixed(1) + 'KB');
});

ok('表格总数 = md 源表格数', totalTb === mdTableCount, '渲染: ' + totalTb + ' / md 源: ' + mdTableCount);
// 目录锚点：每个 H2/H3 都应带 id，且不与 md 源表格数冲突
ok('标题全部带目录锚点', !/<h[34] class="nt-h[234]"(?! id=)/.test(
  EXAM_NOTES.map(n => ntRender(n.md, true, [])).join('')), '有标题缺 id');
ok('无标签不配平', unbal.length === 0, unbal.join('; '));
ok('无残留 md 标记', suspicious.length === 0, suspicious.join('; '));
ok('标题总数 > 100', totalH > 100, '实际: ' + totalH);
ok('列表项总数 > 200', totalLi > 200, '实际: ' + totalLi);

// ---- 6. 特殊字符 / 编码 ----
console.log('\n=== 6. 编码与特殊字符 ===');
const allMd = EXAM_NOTES.map(n => n.md).join('');
ok('无 U+FFFD 替换字符', allMd.indexOf('\ufffd') < 0);
ok('无 U+2028/2029 裸字符', !/[\u2028\u2029]/.test(allMd));
ok('中文内容正常', /项目管理|整合|进度/.test(allMd));

const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(allMd) || /[✅❌⚠🔴🟡🟢📌📖]/.test(allMd);
ok('表情符号保留', hasEmoji);

console.log('\n' + '='.repeat(52));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (bad.length) { console.log('\n失败项:'); bad.forEach(b => console.log('  - ' + b)); }
process.exit(fail ? 1 : 0);
