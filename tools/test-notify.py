# -*- coding: utf-8 -*-
"""通知摘要回归测试

覆盖两件事：
  1. index.html 内联 JS 语法
  2. buildNotifyDigest / notifySnapshot / commitNotifySnap 的行为
  3. remind.yml 里 add='…' 的 shell 解析

跑法：python tools/test-notify.py
"""
import io, re, os, sys, json, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'index.html')
YML = os.path.join(ROOT, 'remind.yml')
BASH_CANDIDATES = [r'D:\工具\Git\bin\bash.exe', r'D:\工具\Git\usr\bin\bash.exe',
                   r'C:\Program Files\Git\bin\bash.exe', '/bin/bash', '/usr/bin/bash']

t = io.open(HTML, encoding='utf-8').read()

# ---------- 1. 语法 ----------
blocks = re.findall(r'<script>(.*?)</script>', t, re.S)
print('内联 script 块数:', len(blocks))
for i, b in enumerate(blocks):
    p = os.path.join(ROOT, '_syn%d.js' % i)
    io.open(p, 'w', encoding='utf-8').write(b)
    r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
    print('  块%d (%d 字符): %s' % (i, len(b), 'OK' if r.returncode == 0 else 'FAIL ' + r.stderr[:300]))
    os.remove(p)
    if r.returncode != 0:
        sys.exit(1)

# ---------- 2. 摘要逻辑单测 ----------
start = t.find('const NOTIFY_SNAP')
end = t.find('async function ghPut')
if start < 0 or end < 0:
    print('FAIL 找不到摘要函数（NOTIFY_SNAP / ghPut）')
    sys.exit(1)
src = t[start:end].replace('let pendingNotifySnap = null;', 'var pendingNotifySnap = null;')

harness = """
const S = { timeline: [], wishes: [], wall: [], capsules: [], voices: [], customDays: [], periods: [] };
const _ls = {};
const localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
};
""" + src + """
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
function reset() {
  Object.keys(S).forEach(k => { S[k] = []; });
  delete _ls[NOTIFY_SNAP];
  pendingNotifySnap = null;
}
function seed(snap) { _ls[NOTIFY_SNAP] = JSON.stringify(snap); }

// 1. 首次运行不误报
reset();
S.timeline = [{ id: 'a', text: '今天去逛了山姆' }];
ok('首次无基线 → 不报变更', buildNotifyDigest() === '');

// 2. 基线就位后新增时间线
reset();
S.timeline = [{ id: 'a', text: '今天去逛了山姆' }];
seed(notifySnapshot());
S.timeline.push({ id: 'b', text: '她做了红烧肉' });
let d = buildNotifyDigest();
ok('新增时间线 → 带原文', d === '新增时间线：她做了红烧肉', d);

// 3. 新增多条只报第一条示例
reset();
seed(notifySnapshot());
S.timeline.push({ id: 'b', text: '第一条' }, { id: 'c', text: '第二条' });
d = buildNotifyDigest();
ok('新增多条 → 报数量+示例', d === '新增 2 条时间线，如：第一条', d);

// 4. 胶囊新增不泄露内容（解锁前不能剧透）
reset();
seed(notifySnapshot());
S.capsules.push({ id: 'cap1', text: '我爱你，一辈子都爱你' });
d = buildNotifyDigest();
ok('胶囊新增 → 不含正文', d === '新增了 1 条胶囊' && d.indexOf('爱') < 0, d);

// 5. 语音/照片不泄露路径
reset();
seed(notifySnapshot());
S.voices.push({ id: 'v1', audio: 'voices/abc.webm', duration: 5 });
d = buildNotifyDigest();
ok('语音新增 → 不含路径', d === '新增了 1 条语音', d);

// 6. 修改已有条目
reset();
S.timeline = [{ id: 'a', text: '原标题' }];
seed(notifySnapshot());
S.timeline[0].text = '改过的标题';
d = buildNotifyDigest();
ok('修改时间线 → 报新内容', d === '更新了时间线：改过的标题', d);

// 7. 删除只报数量
reset();
S.wishes = [{ id: 'w1', text: '想去看海' }, { id: 'w2', text: '想学做饭' }];
seed(notifySnapshot());
S.wishes = [{ id: 'w2', text: '想学做饭' }];
d = buildNotifyDigest();
ok('删除心愿 → 只报数量', d === '删除了 1 条心愿', d);

// 8. 墓碑条目不参与比较
reset();
S.timeline = [{ id: 'a', text: 'x', deleted: true }];
seed(notifySnapshot());
S.timeline.push({ id: 'b', text: '正常条目' });
d = buildNotifyDigest();
ok('墓碑条目被忽略', d === '新增时间线：正常条目', d);

// 9. 单引号/换行被清洗（防注入 commit message）
reset();
seed(notifySnapshot());
S.timeline.push({ id: 'z', text: "it's\\n换行了" });
d = buildNotifyDigest();
ok('单引号被替换', d.indexOf("'") < 0, d);
ok('换行被清除', d.indexOf('\\n') < 0, d);

// 10. 只有照片也给出合理摘要
reset();
seed(notifySnapshot());
S.wall.push({ id: 'ph1', photo: 'photos/x.jpg' });
d = buildNotifyDigest();
ok('照片新增 → 计数摘要', d === '新增了 1 条照片', d);

// 11. 无任何变化
reset();
S.timeline = [{ id: 'a', text: '不变' }];
seed(notifySnapshot());
ok('无变化 → 空摘要', buildNotifyDigest() === '');

// 12. 超长文字被截断
reset();
seed(notifySnapshot());
S.timeline.push({ id: 'long', text: 'x'.repeat(200) });
d = buildNotifyDigest();
ok('摘要长度受控', d.length <= 40, 'len=' + d.length);

// 13. 提交成功后基线推进
reset();
S.timeline = [{ id: 'a', text: '一' }];
seed(notifySnapshot());
S.timeline.push({ id: 'b', text: '二' });
buildNotifyDigest();
ok('待提交前基线未动', JSON.parse(_ls[NOTIFY_SNAP]).timeline.length === 1);
commitNotifySnap();
ok('提交后基线推进', JSON.parse(_ls[NOTIFY_SNAP]).timeline.length === 2);

// 14. 【回归】首次无基线也必须能推进基线
// 真实踩过的 bug：初次运行 digest 为空时不提交基线，导致永远没基线、摘要恒为空。
// ghPut 里已改为「数据文件成功就无条件 commitNotifySnap」。
reset();
S.timeline = [{ id: 'a', text: '首装第一条' }];
ok('首装 → 摘要为空', buildNotifyDigest() === '');
ok('首装 → 快照已备好待提交', pendingNotifySnap !== null);
commitNotifySnap();
ok('首装 → 基线已写入', JSON.parse(_ls[NOTIFY_SNAP]).timeline.length === 1);
S.timeline.push({ id: 'b', text: '后来的第二条' });
d = buildNotifyDigest();
ok('首装后第二次 → 能出摘要', d === '新增时间线：后来的第二条', d);

console.log('');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) process.exit(1);
"""
p = os.path.join(ROOT, '_syn_test.js')
io.open(p, 'w', encoding='utf-8').write(harness)
r = subprocess.run(['node', p], capture_output=True, text=True, encoding='utf-8')
print('\n===== 摘要逻辑单测 =====')
print(r.stdout)
os.remove(p)
if r.returncode != 0:
    print(r.stderr[:1500])
    sys.exit(1)

# ---------- 3. workflow shell 解析 ----------
print('===== workflow 摘要解析 =====')
y = io.open(YML, encoding='utf-8').read()
print('  解析表达式存在:', bool(re.search(r"sed -n \"s/\.\*add='\\\(\[\^'\]\*\\\)'\.\*/\\1/p\"", y)))

bash = next((b for b in BASH_CANDIDATES if os.path.isfile(b)), None)
if not bash:
    print('  跳过：本机找不到 bash（需 Git Bash 或 WSL）')
    sys.exit(0)
print('  使用:', bash)

cases = [
    ("sync from=android me=1 at=2026-11-26T03:00:00Z add='新增时间线：她做了红烧肉'", '新增时间线：她做了红烧肉'),
    ("sync from=ios me=2 at=2026-11-26T03:00:00Z add='更新了心愿：想去看海'", '更新了心愿：想去看海'),
    ("sync from=android me=1 at=2026-11-26T03:00:00Z", '点开看看有什么新内容'),
]
for msg, expect in cases:
    script = ("MSG=%s\n" % json.dumps(msg, ensure_ascii=False)) + \
        "DIGEST=$(printf '%s' \"$MSG\" | head -n1 | sed -n \"s/.*add='\\([^']*\\)'.*/\\1/p\" | cut -c1-60)\n" + \
        "if [ -z \"$DIGEST\" ]; then DIGEST=\"点开看看有什么新内容\"; fi\n" + \
        "printf '%s' \"$DIGEST\"\n"
    rr = subprocess.run([bash, '-c', script], capture_output=True, text=True, encoding='utf-8')
    got = rr.stdout.strip()
    print('  %s got=%r' % ('OK  ' if got == expect else 'FAIL', got))
    if got != expect:
        print('       expect=%r stderr=%s' % (expect, rr.stderr[:200]))
        sys.exit(1)

print('\n全部通过')
