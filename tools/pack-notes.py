# -*- coding: utf-8 -*-
"""把 软考资料/*.md 打包成 exam-notes.js

目的：前端零网络请求读取（不 fetch、不受 GitHub API 60次/小时限流），
与 exam-data.js 同样以 <script> 引入，sw.js 缓存后完全离线可用。

用法： python tools/pack-notes.py
输出： exam-notes.js
"""
import io
import os
import re
import json
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '软考资料')
OUT = os.path.join(ROOT, 'exam-notes.js')


def pick_title(lines, fname):
    """从 H1 提取短标题：'# 项目整合管理 · 重点知识点' -> '项目整合管理'"""
    for l in lines:
        if l.startswith('# '):
            t = l[2:].strip()
            # 去掉 '· 重点知识点' 这类后缀
            if '·' in t:
                t = t.split('·')[0].strip()
            return t
    return os.path.splitext(fname)[0]


def pick_sub(lines):
    """第一个 '> ' 引用行作为副标题（分值/教材定位）"""
    for l in lines:
        if l.startswith('> '):
            return l[2:].strip()
    return ''


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.md')))
    if not files:
        raise SystemExit('软考资料/ 下没有 md 文件')

    notes = []
    total_bytes = 0
    for f in files:
        name = os.path.basename(f)
        with io.open(f, encoding='utf-8') as fh:
            md = fh.read()
        total_bytes += len(md.encode('utf-8'))
        lines = md.split('\n')

        if name.lower().startswith('readme'):
            nid = 'readme'
            title = '备考总览'
            tag = '总览'
        elif re.match(r'00[-_]', name):
            # 学习计划：排在所有章节最前。标题本身就是“学习计划”，不再重复打标签
            nid = 'plan'
            title = pick_title(lines, name)
            tag = ''
        else:
            m = re.match(r'(\d+)[-_]', name)
            nid = (m.group(1) if m else os.path.splitext(name)[0])
            title = pick_title(lines, name)
            tag = '第' + nid + '章' if nid.isdigit() else ''

        sub = pick_sub(lines)
        notes.append({
            'id': nid,
            'title': title,
            'sub': sub,
            'tag': tag,
            'md': md,
        })

    # 安全字符检查：U+2028/U+2029 在老引擎的字符串字面量里会报错，统一转义
    def safe_js_str(s):
        out = json.dumps(s, ensure_ascii=False)
        return out.replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')

    parts = []
    for n in notes:
        parts.append(
            '  { id: %s, title: %s, sub: %s, tag: %s,\n    md: %s }'
            % (safe_js_str(n['id']), safe_js_str(n['title']),
               safe_js_str(n['sub']), safe_js_str(n['tag']),
               safe_js_str(n['md']))
        )

    js = (
        '/* 软考资料（exam-notes.js）—— 自动生成，勿手改\n'
        '   来源：软考资料/*.md，由 tools/pack-notes.py 打包\n'
        '   重新生成： python tools/pack-notes.py\n'
        '   只读内容，不写进 S，不参与情侣同步 */\n'
        "'use strict';\n"
        'const EXAM_NOTES = [\n' + ',\n'.join(parts) + '\n];\n'
        'const EXAM_NOTES_VERSION = %s;\n' % safe_js_str('n%d' % len(notes))
    )

    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(js)

    print('[OK] 打包 %d 篇 -> %s' % (len(notes), OUT))
    print('     md 原文合计 %.1f KB，输出 %.1f KB'
          % (total_bytes / 1024.0, len(js.encode('utf-8')) / 1024.0))
    for n in notes:
        print('     %-8s %-22s %6.1f KB   %s'
              % (n['id'], n['title'], len(n['md'].encode('utf-8')) / 1024.0, n['sub'][:46]))


if __name__ == '__main__':
    main()
