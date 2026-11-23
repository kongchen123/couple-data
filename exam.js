'use strict';
/* ================= 软考高项（exam.js） =================
   独立模块，只依赖主页面已有的全局工具（$ / esc / toast / openDatePicker / ovPush / ovPop）。
   内容在 exam-data.js，逻辑在这里；两者都不写进 S，不参与情侣同步。
   ------------------------------------------------------------
   入口：更多 → 软考高项（go('exam') → examEnter()）
   页面：知识点 / ITTO 过程表 / 计算题 / 刷题（下一版）
   详情：统一走 #examPanel 全屏面板，注册在 ov 栈里，返回键/Esc 能关。
   ========================================================= */

const EXAM_CFG_KEY = 'coupleExamCfg';
let examCfg = (() => { try { const c = JSON.parse(localStorage.getItem(EXAM_CFG_KEY)); return (c && typeof c === 'object') ? c : {}; } catch (e) { return {}; } })();
let examView = 'hub';
let examKpKw = '';
let examQuiz = null;
let examCalc = null;
/* 已掌握标记：{ kp01: 1 }，存本机 examCfg，不进情侣同步 */
let examKnown = (() => { const k = examCfg.known; return (k && typeof k === 'object') ? k : {}; })();
const examIsKnown = (id) => !!examKnown[id];
function examToggleKnown(id) {
  if (!id) return;
  if (examKnown[id]) delete examKnown[id]; else examKnown[id] = 1;
  examCfg.known = examKnown;
  examSaveCfg();
}
const examKnownCount = () => Object.keys(examKnown).filter(id => examKpById(id)).length;

const examSaveCfg = () => { try { localStorage.setItem(EXAM_CFG_KEY, JSON.stringify(examCfg)); } catch (e) { /* 忽略 */ } };
const examShuffle = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = x[i]; x[i] = x[j]; x[j] = t; } return x; };
const examPick = (a) => a[Math.floor(Math.random() * a.length)];
const examHasItto = (p) => !!(p && p.inputs && p.tools && p.outputs && p.inputs.length && p.outputs.length);
const examIttoById = (id) => EXAM_ITTO.find(p => p.id === id) || null;
const examKpById = (id) => EXAM_KP.find(k => k.id === id) || null;
const examIttoDetailCount = () => EXAM_ITTO.filter(examHasItto).length;

/* 通用到几乎每个过程都有的输出，出题时会弱化（避免“这项也对”的歧义） */
const EXAM_GENERIC_OUT = ['变更请求', '项目管理计划更新', '项目文件更新', '组织过程资产更新', '事业环境因素更新', '工作绩效信息', '工作绩效数据', '工作绩效报告', '问题日志', '经验教训登记册'];
const examIsGenericOut = (x) => EXAM_GENERIC_OUT.indexOf(x) >= 0;

function examDaysLeft() {
  if (!examCfg.date) return null;
  const d = new Date(examCfg.date + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return Math.round((d - today0()) / 86400000);
}

/* ---------------- 页面：首页 ---------------- */
function examHtmlHub() {
  const days = examDaysLeft();
  const date = examCfg.date || '';
  let dayTxt = '—';
  if (days != null) dayTxt = days > 0 ? String(days) : (days === 0 ? '今' : '过');
  const sub = days == null ? '设置考试日期，开始倒计时'
    : days > 0 ? '距离考试还有 ' + days + ' 天'
    : days === 0 ? '就是今天，稳住'
    : '考试日期已过，改一下日期';
  return `<div class="exam-hero">
    <div class="t">🎓 软考高项 · 信息系统项目管理师</div>
    <div class="d">${dayTxt}${days != null && days > 0 ? '<small>天</small>' : ''}</div>
    <div class="sub">${sub}</div>
    <div class="exam-date-row">
      <input type="date" id="examDate" value="${esc(date)}" readonly onclick="openDatePicker('examDate')" onchange="examSetDate(this.value)">
      <span>考试日期</span>
    </div>
  </div>
  <div class="exam-tiles">
    <button class="exam-tile" onclick="examGo('kp')"><span class="ico">📚</span><b>知识点</b><span>${EXAM_KP.length} 条高频考点</span></button>
    <button class="exam-tile" onclick="examGo('itto')"><span class="ico">🧩</span><b>ITTO</b><span>${examIttoDetailCount()}/${EXAM_ITTO.length} 个过程明细</span></button>
    <button class="exam-tile" onclick="examGo('calc')"><span class="ico">🧮</span><b>计算题</b><span>挣值分析 · 随机出题</span></button>
    <button class="exam-tile" onclick="examGo('bank')"><span class="ico">📝</span><b>刷题</b><span>ITTO 自测 · 随机 3 题</span></button>
  </div>
  <p class="exam-note">内容还在校对：ITTO 先录了高频过程，知识点后续按教材补全；刷题和更多计算题型下一版。</p>`;
}

function examHead(title, right) {
  /* 主标题已由全局 pageTitle 显示，这里不再重复写一遍，只保留“‹ 返回”和右侧计数。
     hub 页不画返回（全局 backBtn 已能回到「更多」），避免点了没反应。 */
  const back = examView === 'hub' ? '' : '<button class="exam-back" onclick="examBack()">‹ 返回</button>';
  return `<div class="exam-head">${back}<span class="exam-count">${esc(right || '')}</span></div>`;
}

/* ---------------- 知识点 ---------------- */
function examHtmlKp() {
  return examHead('知识点', examKnownCount() + '/' + EXAM_KP.length + ' 已掌握') +
    `<div class="exam-search"><input type="text" id="examKpSearch" placeholder="搜知识点 / 关键词…" value="${esc(examKpKw)}" oninput="examKpInput(this.value)"></div>
     <div id="examKpList"></div>`;
}

function examRenderKpList() {
  const box = $('examKpList');
  if (!box) return;
  /* 计数在这里统一刷新：标记/取消/搜索都走这个函数，头部不会与列表脱节 */
  const head = document.querySelector('#page-exam .exam-count');
  if (head) head.textContent = examKnownCount() + '/' + EXAM_KP.length + ' 已掌握';
  const kw = examKpKw.trim().toLowerCase();
  const list = EXAM_KP.filter(k => !kw || (k.area + k.title + k.body + (k.memo || '')).toLowerCase().indexOf(kw) >= 0);
  if (!list.length) { box.innerHTML = '<div class="empty">没有匹配的知识点</div>'; return; }
  const areaOrder = (a) => { const i = EXAM_AREAS.indexOf(a); return i < 0 ? 99 : i; };
  const areas = [...new Set(list.map(k => k.area))].sort((a, b) => areaOrder(a) - areaOrder(b));
  box.innerHTML = areas.map(a => `<div class="exam-kp-area">${esc(a)}</div>` + list.filter(k => k.area === a).map(k =>
    `<button class="exam-kp${examIsKnown(k.id) ? ' known' : ''}" onclick="examOpenKp('${k.id}')"><div class="t">${examIsKnown(k.id) ? '<span class="exam-kp-done">✓</span>' : ''}${esc(k.title)}${k.hot ? '<span class="exam-hot">高频</span>' : ''}</div><div class="b">${esc(k.body)}</div></button>`
  ).join('')).join('');
}

function examKpInput(v) { examKpKw = v; examRenderKpList(); }

function examOpenKp(id) {
  const k = examKpById(id);
  if (!k) return;
  const known = examIsKnown(k.id);
  examPanelShow(k.title, `<div class="exam-meta">${esc(k.area)} · 考点</div>
    <p class="exam-kp-body">${esc(k.body)}</p>
    ${k.memo ? `<div class="exam-feedback"><b>记忆点</b><br>${esc(k.memo)}</div>` : ''}
    <div class="btn-row"><button class="btn small${known ? ' ghost' : ''}" onclick="examKpToggle('${k.id}')">${known ? '取消已掌握' : '✓ 标记已掌握'}</button></div>`);
}

/**
 * 面板内切换掌握状态：只刷新面板按钮和底层列表，不关闭面板
 * （头部计数由 examRenderKpList 统一刷新）
 */
function examKpToggle(id) {
  examToggleKnown(id);
  const k = examKpById(id);
  if (!k) return;
  const known = examIsKnown(id);
  examPanelShow(k.title, `<div class="exam-meta">${esc(k.area)} · 考点</div>
    <p class="exam-kp-body">${esc(k.body)}</p>
    ${k.memo ? `<div class="exam-feedback"><b>记忆点</b><br>${esc(k.memo)}</div>` : ''}
    <div class="btn-row"><button class="btn small${known ? ' ghost' : ''}" onclick="examKpToggle('${id}')">${known ? '取消已掌握' : '✓ 标记已掌握'}</button></div>`);
  examRenderKpList();
}

/* ---------------- ITTO 过程表 ---------------- */
function examHtmlItto() {
  let h = examHead('ITTO 过程表', examIttoDetailCount() + '/' + EXAM_ITTO.length + ' 有明细');
  h += '<div class="exam-grid"><div></div>' + EXAM_GROUPS.map(g => `<div class="gh">${esc(g)}</div>`).join('');
  EXAM_AREAS.forEach(a => {
    h += `<div class="ah">${esc(a)}</div>`;
    EXAM_GROUPS.forEach(g => {
      const ps = EXAM_ITTO.filter(p => p.area === a && p.group === g);
      if (!ps.length) { h += '<div class="exam-cell dim"></div>'; return; }
      const hot = ps.some(p => p.hot);
      if (ps.length === 1) {
        h += `<button class="exam-cell${hot ? ' hot' : ''}" onclick="examOpenItto('${ps[0].id}')">${esc(ps[0].name)}</button>`;
        return;
      }
      h += `<div class="exam-cell${hot ? ' hot' : ''}">` + ps.map(p => `<button onclick="examOpenItto('${p.id}')">${esc(p.name)}</button>`).join('') + '</div>';
    });
  });
  h += '</div><div class="exam-legend"><span><i></i>高频过程</span><span>点格子看输入 / 工具 / 输出</span></div>';
  return h;
}

function examIttoBlock(label, arr) {
  return `<div class="exam-itto-block"><h4>${esc(label)}</h4><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
}

function examOpenItto(id) {
  const p = examIttoById(id);
  if (!p) return;
  let html = `<div class="exam-meta">${esc(p.area)} · ${esc(p.group)}</div>`;
  if (!examHasItto(p)) {
    html += '<p class="exam-kp-body">这个过程的 ITTO 明细还没录入，下一版按教材补全。</p>';
  } else {
    html += examIttoBlock('输入', p.inputs) + examIttoBlock('工具与技术', p.tools) + examIttoBlock('输出', p.outputs);
    html += `<div class="btn-row"><button class="btn small ghost" onclick="examIttoBlur(this)">遮住自测</button><button class="btn small" onclick="examQuizStart('${p.id}')">来 3 道题</button></div>`;
  }
  examPanelShow(p.name, html);
}

function examIttoBlur(btn) {
  const blocks = [...document.querySelectorAll('#examPanel .exam-itto-block')];
  if (!blocks.length) return;
  const hide = !blocks[0].classList.contains('hide');
  blocks.forEach(b => b.classList.toggle('hide', hide));
  btn.textContent = hide ? '显示' : '遮住自测';
}

/* ---------------- ITTO 自动出题 ---------------- */
/* A 型：以下哪项是「X」的输出？  B 型：哪个过程的输出包含「Y」？ */
function examMakeOutQ(pool, force) {
  const p = force || examPick(pool);
  const outs = p.outputs.filter(x => !examIsGenericOut(x));
  if (!outs.length) return null;
  const correct = examPick(outs);
  /* 干扰项优先取同知识领域 → 同过程组 → 全池。
     两个必须条件：① 不是本过程的输出；② 不是「变更请求」这类通用项。
     否则会出现“四个选项里三个都是通用项”的题，用户靠“挑不一样的那个”就能作弊。 */
  const others = [];
  const collect = (sameScope) => {
    pool.forEach(o => {
      if (o.id === p.id || !sameScope(o)) return;
      o.outputs.forEach(x => {
        if (x === correct || examIsGenericOut(x)) return;
        if (p.outputs.indexOf(x) >= 0 || others.indexOf(x) >= 0) return;
        others.push(x);
      });
    });
  };
  collect(o => o.area === p.area);
  if (others.length < 3) collect(o => o.group === p.group);
  if (others.length < 3) collect(() => true);
  if (others.length < 3) return null;
  const opts = examShuffle([correct, ...examShuffle(others).slice(0, 3)]);
  return {
    stem: '以下哪项是「' + p.name + '」的输出？',
    opts: opts,
    answer: opts.indexOf(correct),
    explain: '「' + p.name + '」的输出：' + p.outputs.join('、') + '。'
  };
}

function examMakeProcQ(pool) {
  const map = new Map();
  pool.forEach(p => p.outputs.filter(x => !examIsGenericOut(x)).forEach(x => {
    if (!map.has(x)) map.set(x, []);
    const arr = map.get(x);
    if (!arr.some(q => q.id === p.id)) arr.push(p);
  }));
  const uniq = [...map.keys()].filter(x => map.get(x).length === 1);
  if (!uniq.length) return null;
  const out = examPick(uniq);
  const owner = map.get(out)[0];
  const others = examShuffle(pool.filter(p => p.id !== owner.id)).slice(0, 3);
  if (others.length < 3) return null;
  const opts = examShuffle([owner, ...others]);
  return {
    stem: '以下哪个过程的输出包含「' + out + '」？',
    opts: opts.map(p => p.name),
    answer: opts.findIndex(p => p.id === owner.id),
    explain: '「' + out + '」是「' + owner.name + '」的输出。'
  };
}

function examMakeQ() {
  const pool = EXAM_ITTO.filter(examHasItto);
  for (let i = 0; i < 40; i++) {
    const q = Math.random() < 0.55 ? examMakeOutQ(pool) : examMakeProcQ(pool);
    if (q) return q;
  }
  return null;
}

function examQuizStart(focusId) {
  const pool = EXAM_ITTO.filter(examHasItto);
  const qs = [];
  const focus = examIttoById(focusId);
  if (focus && examHasItto(focus)) { const q = examMakeOutQ(pool, focus); if (q) qs.push(q); }
  let guard = 0;
  while (qs.length < 3 && guard++ < 100) {
    const q = examMakeQ();
    if (q) qs.push(q);
  }
  if (!qs.length) { toast('题目还没准备好，稍后再试'); return; }
  examQuiz = { qs: qs, i: 0, score: 0, picked: null };
  examRenderQuiz();
}

function examRenderQuiz() {
  if (!examQuiz) return;
  const q = examQuiz.qs[examQuiz.i];
  const total = examQuiz.qs.length;
  let html = `<div class="exam-meta">ITTO 自测 · 第 ${examQuiz.i + 1}/${total} 题</div><div class="exam-quiz-q">${esc(q.stem)}</div>`;
  q.opts.forEach((o, idx) => {
    let cls = 'exam-opt';
    if (examQuiz.picked != null) {
      if (idx === q.answer) cls += ' right';
      else if (idx === examQuiz.picked) cls += ' wrong';
    }
    html += `<button class="${cls}" ${examQuiz.picked != null ? 'disabled' : ''} onclick="examQuizAnswer(${idx})">${String.fromCharCode(65 + idx)}. ${esc(o)}</button>`;
  });
  if (examQuiz.picked != null) {
    const ok = examQuiz.picked === q.answer;
    html += `<div class="exam-feedback">${ok ? '✅ 答对了' : '❌ 答错了，正确答案是 ' + String.fromCharCode(65 + q.answer)}<br>${esc(q.explain)}</div>`;
    html += `<button class="btn small" onclick="examQuizNext()">${examQuiz.i + 1 >= total ? '看结果' : '下一题'}</button>`;
  }
  examPanelShow('ITTO 自测', html);
}

function examQuizAnswer(idx) {
  if (!examQuiz || examQuiz.picked != null) return;
  examQuiz.picked = idx;
  if (idx === examQuiz.qs[examQuiz.i].answer) examQuiz.score++;
  examRenderQuiz();
}

function examQuizNext() {
  if (!examQuiz) return;
  examQuiz.picked = null;
  examQuiz.i++;
  if (examQuiz.i >= examQuiz.qs.length) {
    const total = examQuiz.qs.length, score = examQuiz.score;
    examQuiz = null;
    examPanelShow('ITTO 自测', `<div class="exam-quiz-q">本轮 ${score}/${total}</div>
      <p class="exam-kp-body">${score === total ? '全对，稳。' : '错的那几条回过程表再看一眼。'}</p>
      <div class="btn-row"><button class="btn small" onclick="examQuizStart()">再来一组</button><button class="btn small ghost" onclick="examPanelClose()">回过程表</button></div>`);
    return;
  }
  examRenderQuiz();
}

/* ---------------- 计算题：挣值 ---------------- */
function examNewCalcData() {
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  let pv, ev, ac, guard = 0;
  do {
    pv = rnd(120, 260); ev = rnd(80, 280); ac = rnd(80, 280);
    guard++;
  } while ((ev === pv || ev === ac) && guard < 50);
  const type = examPick(['sv', 'cv', 'spi', 'cpi']);
  const val = type === 'sv' ? ev - pv : type === 'cv' ? ev - ac : type === 'spi' ? ev / pv : ev / ac;
  return { pv: pv, ev: ev, ac: ac, type: type, val: val };
}

function examCalcLabel(type) {
  return { sv: '进度偏差 SV', cv: '成本偏差 CV', spi: '进度绩效指数 SPI', cpi: '成本绩效指数 CPI' }[type] || type;
}

function examCalcHtml() {
  const c = examCalc;
  const isIdx = c.type === 'spi' || c.type === 'cpi';
  return `<div class="exam-meta">挣值分析 · 随机题</div>
    <p class="exam-calc-q">某项目 PV = ${c.pv} 万元，EV = ${c.ev} 万元，AC = ${c.ac} 万元。<br>求 <b>${examCalcLabel(c.type)}</b>${isIdx ? '（保留两位小数）' : '（万元）'}。</p>
    <div class="exam-calc-row">
      <input type="number" id="examCalcInput" inputmode="decimal" placeholder="${isIdx ? '如 0.93' : '填数字'}" onkeydown="if(event.key==='Enter')examCalcCheck()">
      <button class="btn small" onclick="examCalcCheck()">提交</button>
    </div>
    <div id="examCalcFeedback"></div>
    <div class="btn-row"><button class="btn small ghost" onclick="examCalcNew()">换一题</button></div>`;
}

function examCalcNew() {
  examCalc = examNewCalcData();
  const box = $('examCalcBox');
  if (box) box.innerHTML = examCalcHtml();
}

function examCalcCheck() {
  if (!examCalc) return;
  const ipt = $('examCalcInput');
  if (!ipt) return;
  const raw = (ipt.value || '').trim();
  if (!raw) { toast('先填一个数'); return; }
  const v = Number(raw);
  if (!isFinite(v)) { toast('填数字就行'); return; }
  const c = examCalc;
  const isIdx = c.type === 'spi' || c.type === 'cpi';
  const ok = isIdx ? Math.abs(v - c.val) <= 0.011 : Math.round(v) === Math.round(c.val);
  let formula, judge, answer;
  if (c.type === 'sv') {
    answer = c.ev - c.pv;
    formula = `SV = EV − PV = ${c.ev} − ${c.pv} = ${answer}`;
    judge = answer < 0 ? 'SV < 0，进度落后' : (answer > 0 ? 'SV > 0，进度提前' : 'SV = 0，进度符合计划');
  } else if (c.type === 'cv') {
    answer = c.ev - c.ac;
    formula = `CV = EV − AC = ${c.ev} − ${c.ac} = ${answer}`;
    judge = answer < 0 ? 'CV < 0，成本超支' : (answer > 0 ? 'CV > 0，成本节约' : 'CV = 0，成本符合预算');
  } else if (c.type === 'spi') {
    answer = c.ev / c.pv;
    formula = `SPI = EV / PV = ${c.ev} / ${c.pv} = ${answer.toFixed(2)}`;
    judge = answer < 1 ? 'SPI < 1，进度落后' : (answer > 1 ? 'SPI > 1，进度提前' : 'SPI = 1，进度符合计划');
  } else {
    answer = c.ev / c.ac;
    formula = `CPI = EV / AC = ${c.ev} / ${c.ac} = ${answer.toFixed(2)}`;
    judge = answer < 1 ? 'CPI < 1，成本超支' : (answer > 1 ? 'CPI > 1，成本节约' : 'CPI = 1，成本符合预算');
  }
  const shown = isIdx ? answer.toFixed(2) : answer + ' 万元';
  $('examCalcFeedback').innerHTML = `<div class="exam-feedback">${ok ? '✅ 对了' : '❌ 不对，正确值是 ' + shown}<div class="exam-steps">${formula}<br>${judge}</div></div>`;
}

/* ---------------- 刷题 ---------------- */
function examHtmlBank() {
  const pool = EXAM_ITTO.filter(examHasItto);
  const totalOut = (() => {
    const set = new Set();
    pool.forEach(p => p.outputs.filter(x => !examIsGenericOut(x)).forEach(x => set.add(x)));
    return set.size;
  })();
  let h = examHead('刷题', pool.length + ' 个过程 / ' + totalOut + ' 个考点');
  h += `<div class="card">
    <h2>🧠 ITTO 自测</h2>
    <p class="exam-kp-body">从已录入的 ${pool.length} 个过程里随机出题：
    「某过程的输出是什么」和「哪个过程的输出包含某项」。答错会给完整输出列表。</p>
    <div class="btn-row"><button class="btn small" onclick="examQuizStart()">来 3 道题</button></div>
  </div>`;
  h += `<div class="card"><div class="empty"><i class="ico">📝</i>章节题 / 历年真题待导入<br><span class="exam-note-inline">下一版支持 JSON 导入</span></div></div>`;
  return h;
}

/* ---------------- 渲染 / 导航 ---------------- */
/* 子页标题交给全局 pageTitle 承载（与语音/经期/设置一致），页面内不再重复画一份 */
const EXAM_VIEW_TITLES = { hub: '软考高项', kp: '知识点', itto: 'ITTO 过程表', calc: '计算题', bank: '刷题' };
function examSyncTitle() {
  const t = $('pageTitle');
  if (t) t.textContent = EXAM_VIEW_TITLES[examView] || '软考高项';
}

function examRender() {
  const root = $('examRoot');
  if (!root) return;
  examSyncTitle();
  if (examView === 'kp') { root.innerHTML = examHtmlKp(); examRenderKpList(); return; }
  if (examView === 'itto') { root.innerHTML = examHtmlItto(); return; }
  if (examView === 'calc') { root.innerHTML = examHead('计算题', '挣值 · 第 1 类') + '<div id="examCalcBox"></div><p class="exam-note">下一版：三点估算、沟通渠道、决策树、网络图（关键路径/总时差）。</p>'; examCalcNew(); return; }
  if (examView === 'bank') { root.innerHTML = examHtmlBank(); return; }
  root.innerHTML = examHtmlHub();
}

function examEnter() { examRender(); }
function examGo(v) { examView = v; examRender(); }
function examBack() { examView = 'hub'; examRender(); }
function examSetDate(v) { examCfg.date = v || ''; examSaveCfg(); examRender(); }

/* ---------------- 全屏面板 ---------------- */
function examPanelShow(title, html) {
  $('examPanelTitle').textContent = title || '软考高项';
  $('examPanelBody').innerHTML = html;
  $('examPanelBody').scrollTop = 0;
  $('examPanel').classList.add('show');
  ovPush('examDetail');
}
function examPanelClose() {
  const p = $('examPanel');
  if (p) p.classList.remove('show');
  ovPop('examDetail');
}

/* 深链 #exam 时，主脚本先切了页面，这里补渲染（defer 脚本晚于主脚本执行） */
(() => {
  const active = document.querySelector('.page.active');
  if (active && active.id === 'page-exam') examRender();
})();
