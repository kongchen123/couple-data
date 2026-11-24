'use strict';
/* ==========================================================================
   软考资料阅读器（notes.js）
   --------------------------------------------------------------------------
   数据来自 exam-notes.js（由 tools/pack-notes.py 自动打包，勿手改）。
   本文件只负责「渲染 + 阅读 UI」，不写进 S，不参与情侣同步。

   入口：软考高项 → 章节速记
   ========================================================================== */

/* ---------------- Markdown 渲染 ---------------- */
/* 只实现资料里真实用到的语法：标题 / 表格 / 列表 / 引用 / 代码块 / 粗体 /
   行内代码 / 链接 / 分隔线 / <details> 折叠。
   顺序原则：先把行内代码抽成占位符再转义，避免 code 里的 ** 被误当粗体。 */

const ntEsc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ntInline(s) {
  const codes = [];
  let t = String(s == null ? '' : s);
  // 保护行内代码
  t = t.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return '\u0000C' + (codes.length - 1) + '\u0000';
  });
  t = ntEsc(t);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 还原行内代码（内容单独转义，不参与上面的标记替换）
  t = t.replace(/\u0000C(\d+)\u0000/g, (m, i) => '<code>' + ntEsc(codes[+i]) + '</code>');
  return t;
}

/* 表格分隔行：| --- | :--: | --: | */
const ntIsSep = (l) => /^\|[\s:|-]+\|$/.test(l.trim()) && l.indexOf('-') >= 0;

function ntSplitRow(l) {
  let s = l.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(x => x.trim());
}

/* 把 md 渲染成 HTML。skipFirstH1=true 时跳过首个 H1（详情页标题栏已有）
   tocOut 传入数组时，顺带收集 H2/H3 作为目录项 {lvl, text, id} */
function ntRender(md, skipFirstH1, tocOut) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let para = [];
  let skippedH1 = !skipFirstH1;

  const flushPara = () => {
    if (!para.length) return;
    out.push('<p class="nt-p">' + para.map(ntInline).join('<br>') + '</p>');
    para = [];
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    const trim = line.trim();

    // 空行：结束段落
    if (!trim) { flushPara(); i++; continue; }

    // 围栏代码块
    if (/^```/.test(trim)) {
      flushPara();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // 跳过结束围栏
      out.push('<pre class="nt-pre"><code>' + ntEsc(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // <details> / </details> / <summary>：直通，内部后续行照常解析
    if (/^<\/?details/.test(trim) || /^<\/?summary/.test(trim)) {
      flushPara();
      out.push(trim);
      i++;
      continue;
    }

    // 标题
    const hm = /^(#{1,6})\s+(.*)$/.exec(trim);
    if (hm) {
      flushPara();
      const lvl = hm[1].length;
      if (lvl === 1 && !skippedH1) { skippedH1 = true; i++; continue; }
      const tag = lvl <= 2 ? 'h3' : (lvl === 3 ? 'h4' : 'h5');
      const cls = lvl <= 2 ? 'nt-h2' : (lvl === 3 ? 'nt-h3' : 'nt-h4');
      /* 目录锚点按出现顺序编号：中文 id 需要转义，顺序号更稳且不会重复 */
      let aid = '';
      if (tocOut && lvl <= 3) {
        aid = 'nt-h-' + tocOut.length;
        tocOut.push({ lvl: lvl, text: ntPlain(hm[2]), id: aid });
      }
      out.push('<' + tag + ' class="' + cls + '"' + (aid ? ' id="' + aid + '"' : '') + '>' +
        ntInline(hm[2]) + '</' + tag + '>');
      i++;
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trim)) {
      flushPara();
      out.push('<hr class="nt-hr">');
      i++;
      continue;
    }

    // 表格：当前行以 | 开头且下一行是分隔行
    if (trim.startsWith('|') && i + 1 < lines.length && ntIsSep(lines[i + 1])) {
      flushPara();
      const head = ntSplitRow(trim);
      const sep = ntSplitRow(lines[i + 1]);
      const align = sep.map(c => {
        const l = c.startsWith(':'), r = c.endsWith(':');
        return (l && r) ? 'center' : (r ? 'right' : (l ? 'left' : ''));
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(ntSplitRow(lines[i].trim()));
        i++;
      }
      // 按列数给表格设最小宽度：窄屏下宁可横向滚动，也不能把 5 列挤成竖条
      const minW = head.length >= 5 ? 500 : (head.length === 4 ? 420 : (head.length === 3 ? 340 : 0));
      let h = '<div class="nt-tbwrap"><table class="nt-tb"' + (minW ? ' style="min-width:' + minW + 'px"' : '') + '><thead><tr>';
      head.forEach((c, k) => {
        const a = align[k] ? ' style="text-align:' + align[k] + '"' : '';
        h += '<th' + a + '>' + ntInline(c) + '</th>';
      });
      h += '</tr></thead><tbody>';
      rows.forEach(r => {
        h += '<tr>';
        head.forEach((_, k) => {
          const a = align[k] ? ' style="text-align:' + align[k] + '"' : '';
          h += '<td' + a + '>' + ntInline(r[k] == null ? '' : r[k]) + '</td>';
        });
        h += '</tr>';
      });
      h += '</tbody></table></div>';
      out.push(h);
      continue;
    }

    // 引用
    if (trim.startsWith('>')) {
      flushPara();
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push('<div class="nt-quote">' + buf.map(ntInline).join('<br>') + '</div>');
      continue;
    }

    // 列表（支持一层缩进嵌套）
    const lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (lm) {
      flushPara();
      const ordered = /\d/.test(lm[2]);
      const baseIndent = lm[1].length;
      const items = []; // {depth, html}
      while (i < lines.length) {
        const cur = lines[i];
        const m2 = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(cur);
        if (m2) {
          const depth = m2[1].length > baseIndent + 1 ? 1 : 0;
          items.push({ depth, html: ntInline(m2[3]) });
          i++;
          continue;
        }
        // 续行（缩进的普通行，接在上一条后面）
        if (cur.trim() && /^\s{2,}\S/.test(cur) && items.length) {
          items[items.length - 1].html += '<br>' + ntInline(cur.trim());
          i++;
          continue;
        }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      let h = '<' + tag + ' class="nt-list">';
      let open = false;
      items.forEach(it => {
        if (it.depth === 1 && !open) { h += '<' + tag + ' class="nt-list nt-sub">'; open = true; }
        if (it.depth === 0 && open) { h += '</' + tag + '>'; open = false; }
        h += '<li>' + it.html + '</li>';
      });
      if (open) h += '</' + tag + '>';
      h += '</' + tag + '>';
      out.push(h);
      continue;
    }

    // 普通段落行
    para.push(trim);
    i++;
  }

  flushPara();
  return out.join('\n');
}

/* ---------------- 阅读 UI ---------------- */
const NOTES = () => (typeof EXAM_NOTES !== 'undefined' ? EXAM_NOTES : []);
const ntById = (id) => NOTES().find(n => n.id === id) || null;
let ntKw = '';

function ntHtmlList() {
  const back = '<button class="exam-back" onclick="examBack()">‹ 返回</button>';
  let h = '<div class="exam-head">' + back +
    '<span class="exam-count">' + NOTES().length + ' 篇</span></div>';
  h += '<div class="exam-search"><input type="text" id="ntSearch" placeholder="搜章节 / 关键词…" ' +
    'value="' + ntEsc(ntKw) + '" oninput="ntInput(this.value)"></div>';
  h += '<div id="ntList"></div>';
  return h;
}

/* 搜索结果片段用纯文本：去掉 md 标记，否则会看到裸的 ** 与反引号、表格竖线 */
const ntPlain = (s) => String(s == null ? '' : s)
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^>\s?/gm, '')
  // 表格：分隔行整行丢弃，数据行的竖线换成空格
  .replace(/^\|[\s:|-]+\|$/gm, '')
  .replace(/^\s*\|/gm, '')
  .replace(/\|/g, ' ')
  .replace(/^-{3,}$/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

function ntRenderList() {
  const box = $('ntList');
  if (!box) return;
  const kw = ntKw.trim().toLowerCase();
  const list = NOTES().filter(n => !kw ||
    (n.title + n.sub + n.md).toLowerCase().indexOf(kw) >= 0);
  if (!list.length) {
    box.innerHTML = '<div class="empty"><i class="ico">🔍</i>没有匹配的章节</div>';
    return;
  }
  box.innerHTML = list.map(n => {
    let hint = '';
    if (kw) {
      // 命中位置前后各截一点，让搜索有「看到了什么」的依据
      const plain = ntPlain(n.md);
      const p = plain.toLowerCase().indexOf(kw);
      if (p >= 0) {
        const s = Math.max(0, p - 16);
        hint = plain.slice(s, p + kw.length + 24).trim();
      }
    }
    return '<button class="nt-item" onclick="ntOpen(\'' + n.id + '\')">' +
      '<div class="t">' + ntEsc(n.title) +
      (n.tag ? '<span class="nt-tag">' + ntEsc(n.tag) + '</span>' : '') + '</div>' +
      '<div class="s">' + ntInline(n.sub || '') + '</div>' +
      (hint ? '<div class="hint">…' + ntEsc(hint) + '…</div>' : '') +
      '</button>';
  }).join('');
}

function ntInput(v) { ntKw = v; ntRenderList(); }

let ntToc = [];
let ntCurId = '';

function ntOpen(id) {
  const n = ntById(id);
  if (!n) { toast('章节不存在'); return; }
  ntCurId = id;
  ntToc = [];
  const html = ntRender(n.md, true, ntToc);
  examPanelShow(n.title, '<div id="ntDoc">' + html + '</div>' +
    '<div class="nt-foot">—— 完 ——</div>');
  ntSyncTocBtn();
}

/* ---------- 目录：面板头部的 ☰ 按钮 + 底部抽屉 ---------- */
/* 按钮写在 index.html 的 examPanel 头部（默认 hidden），这里只负责显隐：
   只有当前渲染的是章节文档（#ntDoc 存在）且收集到目录项时才露出。
   examPanelShow 末尾会调这个函数，所以 ITTO / 知识点详情会自动收起目录键 */
function ntSyncTocBtn() {
  const btn = $('ntTocBtn');
  if (!btn) return;
  btn.hidden = !(document.getElementById('ntDoc') && ntToc.length);
}

function ntTocOpen() {
  if (!ntToc.length) return;
  const list = $('ntTocList');
  if (!list) return;
  /* 打开时把当前读到的位置高亮出来，否则 14 条目录看不出读到哪了 */
  const cur = ntCurrentAnchor();
  list.innerHTML = ntToc.map(t =>
    '<button class="nt-toc-item lv' + t.lvl + (t.id === cur ? ' cur' : '') + '"' +
    ' onclick="ntTocGo(\'' + t.id + '\')">' + ntEsc(t.text) + '</button>'
  ).join('');
  $('ntTocMask').classList.add('show');
  $('ntTocPanel').classList.add('show');
  ovPush('ntToc');
  /* 高亮项滚进可视区 */
  const hit = list.querySelector('.nt-toc-item.cur');
  if (hit) list.scrollTop = Math.max(0, hit.offsetTop - list.clientHeight / 2);
}

function ntTocClose() {
  const m = $('ntTocMask'), p = $('ntTocPanel');
  if (m) m.classList.remove('show');
  if (p) p.classList.remove('show');
  ovPop('ntToc');
}

/* 当前可视区顶部附近的那个标题（用于目录高亮） */
function ntCurrentAnchor() {
  const body = $('examPanelBody');
  if (!body || !ntToc.length) return '';
  const top = body.getBoundingClientRect().top + 12;
  let cur = '';
  for (const t of ntToc) {
    const el = document.getElementById(t.id);
    if (!el) continue;
    if (el.getBoundingClientRect().top <= top) cur = t.id;
    else break;
  }
  return cur || ntToc[0].id;
}

function ntTocGo(anchorId) {
  const body = $('examPanelBody');
  const el = document.getElementById(anchorId);
  if (!body || !el) { ntTocClose(); return; }
  /* 坐标必须在抽屉关闭前算好；且用直接赋值不用 smooth：
     关闭抽屉会走 ovPop → 还原焦点，focus 会打断平滑滚动，导致停在原处 */
  const y = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  ntTocClose();
  requestAnimationFrame(() => {
    body.scrollTop = Math.max(0, y - 8);
    /* focus 可能在 rAF 之后才发生（ovPop 里延时 60ms），补一次确保落点准确 */
    setTimeout(() => { body.scrollTop = Math.max(0, y - 8); }, 80);
  });
}

/* 关闭面板时顺带把目录抽屉收起来，否则 drawer 会悬在下一页上 */
function ntResetToc() {
  ntToc = [];
  ntCurId = '';
  const m = $('ntTocMask'), p = $('ntTocPanel');
  if (m) m.classList.remove('show');
  if (p) p.classList.remove('show');
  ntSyncTocBtn();
}
